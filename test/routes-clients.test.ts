/**
 * Route tests for /api/clients — listing (known + connected), name, per-drive
 * override set/clear (with image validation + live re-sync), and forget.
 * Uses a real temp DB + disks dir and a fake connectionManager.
 */

import express from 'express';
import request from 'supertest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Database } from '../src/database';
import { registerClientRoutes } from '../src/routes/clients';
import { getClientMountRegistry } from '../src/client-mount-registry';
import { getMountRegistry } from '../src/mount-registry';

async function buildApp() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-rc-'));
  const disksDir = path.join(dir, 'disks');
  await fs.mkdir(disksDir, { recursive: true });
  await fs.writeFile(path.join(disksDir, 'game.dsk'), Buffer.alloc(64, 0));

  const database = new Database(path.join(dir, 'test.db'));
  await database.initialize();

  const synced: string[] = [];
  // Mutable operator-drive mount table for the commit guard / hot-reload.
  const mounted: Record<number, { filename: string; readonly: boolean; transient: boolean }> = {};
  const deps: any = {
    config: { disksDir },
    database,
    writeMaster: 'serial',
    multiClientServing: false,
    diskServingEnabled: false,
    server: null,
    serverTask: null,
    io: { emit: () => { /* broadcastStatus sink */ } },
    serialManager: { isOpen: () => false, getDevice: () => null, getBaudRate: () => 0 },
    driveManager: {
      getDriveState: (i: number) =>
        mounted[i]
          ? { mounted: true, filename: mounted[i].filename, readonly: mounted[i].readonly, transient: mounted[i].transient }
          : { mounted: false, readonly: false, transient: false, filename: null },
      reloadDrive: async (_i: number) => true,
    },
    connectionManager: {
      list: () => [{ id: 'conn1', clientId: 'altair-1', transport: 'websocket', connectedAt: 1000 }],
      syncClient: async (id: string) => { synced.push(id); },
      syncAll: async () => { synced.push('*'); },
    },
  };

  const app = express();
  app.use(express.json());
  const router = express.Router();
  registerClientRoutes(router, deps);
  app.use(router);
  return { app, deps, dir, disksDir, synced, mounted };
}

/** Seed a persistent splinter (DB row + on-disk file) for a client/drive. */
async function seedSplinter(deps: any, disksDir: string, clientId: string, drive: number, base: string): Promise<string> {
  const p = path.join(disksDir, '.splinter', clientId, `drive${drive}.img`);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, Buffer.alloc(64, 0xab));
  await deps.database.upsertClientSplinter(clientId, drive, base, p, true);
  return p;
}

describe('client routes', () => {
  // Global mount registry is a singleton — clear the bay under test each run.
  afterEach(() => { getMountRegistry().clear(0); getClientMountRegistry().clearClient('altair-1'); getClientMountRegistry().clearClient('offline-1'); });

  test('GET lists connected + known clients with effective drives', async () => {
    const { app, deps } = await buildApp(); const database = deps.database;
    await database.setClientLabel('offline-1', 'Bench Unit');
    getMountRegistry().set(0, '/disks/global.dsk', false);

    const res = await request(app).get('/api/clients');
    expect(res.status).toBe(200);
    const ids = res.body.clients.map((c: any) => c.clientId).sort();
    expect(ids).toEqual(['altair-1', 'offline-1']);

    const live = res.body.clients.find((c: any) => c.clientId === 'altair-1');
    expect(live.connected).toBe(true);
    expect(live.drives[0]).toMatchObject({ drive: 0, filename: 'global.dsk', source: 'global' });

    const offline = res.body.clients.find((c: any) => c.clientId === 'offline-1');
    expect(offline.connected).toBe(false);
    expect(offline.name).toBe('Bench Unit');
  });

  test('PUT drive override validates the image, persists, and re-syncs', async () => {
    const { app, deps, synced } = await buildApp(); const database = deps.database;
    const res = await request(app).put('/api/clients/altair-1/drives/0').send({ filename: 'game.dsk', readonly: true });
    expect(res.status).toBe(200);
    expect((await database.getClientMount('altair-1', 0))).toMatchObject({ filename: 'game.dsk', readonly: 1 });
    expect(getClientMountRegistry().get('altair-1', 0)).not.toBeNull();
    expect(synced).toContain('altair-1');
  });

  test('PUT override with a missing image is 404', async () => {
    const { app } = await buildApp();
    const res = await request(app).put('/api/clients/altair-1/drives/0').send({ filename: 'nope.dsk' });
    expect(res.status).toBe(404);
  });

  test('GET marks a per-drive override as source=override', async () => {
    const { app } = await buildApp();
    await request(app).put('/api/clients/altair-1/drives/1').send({ filename: 'game.dsk' });
    const res = await request(app).get('/api/clients');
    const c = res.body.clients.find((x: any) => x.clientId === 'altair-1');
    expect(c.drives[1]).toMatchObject({ drive: 1, filename: 'game.dsk', source: 'override' });
  });

  test('DELETE drive override clears it', async () => {
    const { app, deps } = await buildApp(); const database = deps.database;
    await request(app).put('/api/clients/altair-1/drives/0').send({ filename: 'game.dsk' });
    const res = await request(app).delete('/api/clients/altair-1/drives/0');
    expect(res.status).toBe(200);
    expect(await database.getClientMount('altair-1', 0)).toBeNull();
    expect(getClientMountRegistry().get('altair-1', 0)).toBeNull();
  });

  test('PUT name sets a friendly label', async () => {
    const { app, deps } = await buildApp(); const database = deps.database;
    const res = await request(app).put('/api/clients/altair-1/name').send({ name: 'Lab Altair' });
    expect(res.status).toBe(200);
    expect((await database.getClientLabel('altair-1'))!.name).toBe('Lab Altair');
  });

  test('DELETE client forgets overrides + label', async () => {
    const { app, deps } = await buildApp(); const database = deps.database;
    await request(app).put('/api/clients/altair-1/drives/0').send({ filename: 'game.dsk' });
    await request(app).put('/api/clients/altair-1/name').send({ name: 'X' });
    const res = await request(app).delete('/api/clients/altair-1');
    expect(res.status).toBe(200);
    expect(await database.listClientMounts('altair-1')).toHaveLength(0);
    expect(await database.getClientLabel('altair-1')).toBeNull();
  });

  test('POST splinter/commit is 404 when the client has no splinter', async () => {
    const { app } = await buildApp();
    const res = await request(app).post('/api/clients/altair-1/drives/0/splinter/commit');
    expect(res.status).toBe(404);
  });

  test('POST splinter/commit hot-swaps and reports the new fields', async () => {
    const { app, deps, disksDir } = await buildApp();
    await fs.writeFile(path.join(disksDir, 'game.dsk'), Buffer.alloc(64, 0x11));
    await seedSplinter(deps, disksDir, 'altair-1', 0, 'game.dsk');
    const res = await request(app).post('/api/clients/altair-1/drives/0/splinter/commit');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, filename: 'game.dsk', hotSwapped: true });
    expect(res.body.reloadedDrives).toEqual([]);
    // Master now holds the splinter bytes.
    expect(await fs.readFile(path.join(disksDir, 'game.dsk'))).toEqual(Buffer.alloc(64, 0xab));
  });

  test('POST splinter/commit is 409 when the base is mounted read-write', async () => {
    const { app, deps, disksDir, mounted } = await buildApp();
    await seedSplinter(deps, disksDir, 'altair-1', 0, 'game.dsk');
    mounted[0] = { filename: path.join(disksDir, 'game.dsk'), readonly: false, transient: false };
    const res = await request(app).post('/api/clients/altair-1/drives/0/splinter/commit');
    expect(res.status).toBe(409);
  });

  test('POST splinter/save-snapshot saves a snapshot of the master', async () => {
    const { app, deps, disksDir } = await buildApp();
    await seedSplinter(deps, disksDir, 'altair-1', 0, 'game.dsk');
    const res = await request(app)
      .post('/api/clients/altair-1/drives/0/splinter/save-snapshot')
      .send({ label: 'client save' });
    expect(res.status).toBe(200);
    expect(res.body.snapshot).toMatchObject({ disk_filename: 'game.dsk', label: 'client save' });
    expect(await deps.database.listSnapshotsForDisk('game.dsk')).toHaveLength(1);
  });

  test('POST splinter/save-as-disk writes a new image (with collision suffix)', async () => {
    const { app, deps, disksDir } = await buildApp();
    await seedSplinter(deps, disksDir, 'altair-1', 0, 'game.dsk');
    const first = await request(app)
      .post('/api/clients/altair-1/drives/0/splinter/save-as-disk')
      .send({ name: 'game-edited' });
    expect(first.status).toBe(200);
    expect(first.body.filename).toBe('game-edited.dsk');
    const second = await request(app)
      .post('/api/clients/altair-1/drives/0/splinter/save-as-disk')
      .send({ name: 'game-edited' });
    expect(second.body.filename).toBe('game-edited-2.dsk');
  });

  test('POST splinter/save-as-disk rejects a bad name (400) and missing splinter (404)', async () => {
    const { app, deps, disksDir } = await buildApp();
    await seedSplinter(deps, disksDir, 'altair-1', 0, 'game.dsk');
    const bad = await request(app)
      .post('/api/clients/altair-1/drives/0/splinter/save-as-disk')
      .send({ name: '../evil' });
    expect(bad.status).toBe(400);
    const none = await request(app)
      .post('/api/clients/altair-1/drives/1/splinter/save-as-disk')
      .send({ name: 'ok' });
    expect(none.status).toBe(404);
  });
});
