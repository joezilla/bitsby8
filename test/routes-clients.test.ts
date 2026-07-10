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
  const deps: any = {
    config: { disksDir },
    database,
    writeMaster: 'serial',
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
  return { app, deps, dir, disksDir, synced };
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
});
