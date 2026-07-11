/**
 * Tests for the per-client splinter keep service: hot-swap commit (with the
 * live-master-write guard), save-as-snapshot, and save-as-new-disk. Uses a real
 * temp DB + disks dir with a recorded splinter row and a fake driveManager /
 * connectionManager that stand in for the operator + session layers.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Database } from '../src/database';
import {
  commitClientSplinter,
  saveClientSplinterSnapshot,
  saveClientSplinterAsDisk,
} from '../src/services/splinter-service';
import { getMountRegistry } from '../src/mount-registry';
import { getClientMountRegistry } from '../src/client-mount-registry';

const LEN = 128;
const CLIENT = 'altair-lab-1';

async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-splinter-'));
  const disksDir = path.join(dir, 'disks');
  await fs.mkdir(path.join(disksDir, '.splinter', CLIENT), { recursive: true });
  const master = path.join(disksDir, 'game.dsk');
  await fs.writeFile(master, Buffer.alloc(LEN * 2, 0x11));
  const splinter = path.join(disksDir, '.splinter', CLIENT, 'drive0.img');
  await fs.writeFile(splinter, Buffer.alloc(LEN * 2, 0xab));

  const database = new Database(path.join(dir, 'test.db'));
  await database.initialize();
  await database.upsertClientSplinter(CLIENT, 0, 'game.dsk', splinter, true);

  // Fake operator drives. Each state: { mounted, filename, readonly, transient }.
  const states: Record<number, any> = {};
  const reloadCalls: number[] = [];
  const failReload = new Set<number>();
  const driveManager = {
    getDriveState: (i: number) => states[i] ?? { mounted: false, readonly: false, transient: false, filename: null },
    reloadDrive: async (i: number) => {
      if (failReload.has(i)) throw new Error(`reload failed on ${i}`);
      const st = states[i];
      if (st && st.mounted) { reloadCalls.push(i); return true; }
      return false;
    },
  };
  const synced: string[] = [];
  const deps: any = {
    config: { disksDir },
    database,
    driveManager,
    writeMaster: 'serial',
    multiClientServing: false,
    diskServingEnabled: false,
    server: null,
    serverTask: null,
    io: { emit: () => { /* broadcastStatus sink */ } },
    serialManager: { isOpen: () => false, getDevice: () => null, getBaudRate: () => 0 },
    connectionManager: { list: () => [], syncAll: async () => { synced.push('*'); } },
  };
  return { dir, master, splinter, deps, states, reloadCalls, failReload, synced };
}

describe('splinter-service', () => {
  // Registries are singletons — clear anything a test set on them.
  afterEach(() => {
    getMountRegistry().clear(0);
    getClientMountRegistry().clearClient('altair-master');
  });

  test('commit copies the splinter onto the master (offline, nothing mounted)', async () => {
    const { dir, master, deps, synced } = await setup();
    const res = await commitClientSplinter(deps, CLIENT, 0);
    expect(res).toMatchObject({ clientId: CLIENT, drive: 0, filename: 'game.dsk', hotSwapped: true, reloadedDrives: [] });
    expect(await fs.readFile(master)).toEqual(Buffer.alloc(LEN * 2, 0xab));
    expect(synced).toContain('*'); // sessions resynced
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('commit is ALLOWED when the base is mounted read-only+transient, and hot-reloads that drive', async () => {
    const { dir, master, deps, states, reloadCalls } = await setup();
    states[1] = { mounted: true, filename: master, readonly: true, transient: true };
    const res = await commitClientSplinter(deps, CLIENT, 0);
    expect(res.reloadedDrives).toEqual([1]);
    expect(reloadCalls).toEqual([1]);
    expect(await fs.readFile(master)).toEqual(Buffer.alloc(LEN * 2, 0xab));
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('commit is REFUSED when the base is mounted read-write on an operator drive', async () => {
    const { dir, master, deps, states } = await setup();
    states[1] = { mounted: true, filename: master, readonly: false, transient: false };
    await expect(commitClientSplinter(deps, CLIENT, 0)).rejects.toMatchObject({ statusCode: 409 });
    // Master untouched.
    expect(await fs.readFile(master)).toEqual(Buffer.alloc(LEN * 2, 0x11));
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('commit is REFUSED when a connected master-write client holds the base', async () => {
    const { dir, master, deps } = await setup();
    deps.writeMaster = 'altair-master';
    deps.connectionManager.list = () => [{ id: 'c1', clientId: 'altair-master', connectedAt: 1 }];
    getMountRegistry().set(0, master, false); // global mount of the base
    await expect(commitClientSplinter(deps, CLIENT, 0)).rejects.toMatchObject({ statusCode: 409 });
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('commit hot-reloads the base on every operator drive holding it', async () => {
    const { dir, master, deps, states, reloadCalls } = await setup();
    states[0] = { mounted: true, filename: master, readonly: true, transient: false };
    states[2] = { mounted: true, filename: master, readonly: true, transient: false };
    const res = await commitClientSplinter(deps, CLIENT, 0);
    expect(res.reloadedDrives.sort()).toEqual([0, 2]);
    expect(reloadCalls.sort()).toEqual([0, 2]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('commit still succeeds when one drive fails to reload', async () => {
    const { dir, master, deps, states, failReload } = await setup();
    states[0] = { mounted: true, filename: master, readonly: true, transient: false };
    states[2] = { mounted: true, filename: master, readonly: true, transient: false };
    failReload.add(2);
    const res = await commitClientSplinter(deps, CLIENT, 0);
    expect(res.hotSwapped).toBe(true);
    expect(res.reloadedDrives).toEqual([0]); // 2 threw and was swallowed
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('commit rejects a client/drive with no splinter', async () => {
    const { dir, deps } = await setup();
    await expect(commitClientSplinter(deps, CLIENT, 1)).rejects.toMatchObject({ statusCode: 404 });
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('commit reports a missing splinter file', async () => {
    const { dir, splinter, deps } = await setup();
    await fs.unlink(splinter);
    await expect(commitClientSplinter(deps, CLIENT, 0)).rejects.toMatchObject({ statusCode: 404 });
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('save-as-snapshot persists the splinter as a snapshot of the master', async () => {
    const { dir, deps } = await setup();
    const snap = await saveClientSplinterSnapshot(deps, CLIENT, 0, 'keep me');
    expect(snap.disk_filename).toBe('game.dsk');
    expect(snap.label).toBe('keep me');
    expect(snap.size_bytes).toBe(LEN * 2);
    expect(await deps.database.listSnapshotsForDisk('game.dsk')).toHaveLength(1);
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('save-as-new-disk writes a new named image, defaulting the extension, leaving the base untouched', async () => {
    const { dir, master, deps } = await setup();
    const res = await saveClientSplinterAsDisk(deps, CLIENT, 0, 'game-edited');
    expect(res.filename).toBe('game-edited.dsk');
    expect(await fs.readFile(path.join(deps.config.disksDir, 'game-edited.dsk'))).toEqual(Buffer.alloc(LEN * 2, 0xab));
    expect(await fs.readFile(master)).toEqual(Buffer.alloc(LEN * 2, 0x11)); // base untouched
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('save-as-new-disk suffixes on collision', async () => {
    const { dir, deps } = await setup();
    await fs.writeFile(path.join(deps.config.disksDir, 'game-edited.dsk'), Buffer.alloc(4, 0));
    const res = await saveClientSplinterAsDisk(deps, CLIENT, 0, 'game-edited.dsk');
    expect(res.filename).toBe('game-edited-2.dsk');
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('save-as-new-disk rejects an invalid name and a bad extension', async () => {
    const { dir, deps } = await setup();
    await expect(saveClientSplinterAsDisk(deps, CLIENT, 0, '../evil')).rejects.toMatchObject({ statusCode: 400 });
    await expect(saveClientSplinterAsDisk(deps, CLIENT, 0, 'game.txt')).rejects.toMatchObject({ statusCode: 400 });
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('invalid drive id is rejected', async () => {
    const { dir, deps } = await setup();
    await expect(commitClientSplinter(deps, CLIENT, 99)).rejects.toMatchObject({ statusCode: 400 });
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('invalid client id is rejected', async () => {
    const { dir, deps } = await setup();
    await expect(commitClientSplinter(deps, '../evil', 0)).rejects.toMatchObject({ statusCode: 400 });
    await fs.rm(dir, { recursive: true, force: true });
  });
});
