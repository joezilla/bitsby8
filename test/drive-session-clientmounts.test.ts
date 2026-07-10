/**
 * Tests for DriveSession resolving per-client drive-bay overrides:
 * a client override wins over the global mount, unset drives inherit global,
 * and editing/clearing an override re-opens the drive (and discards a now-stale
 * splinter). Real files, no fs mock.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { MountRegistry } from '../src/mount-registry';
import { ClientMountRegistry } from '../src/client-mount-registry';
import { DriveSession } from '../src/drive-session';
import { Database } from '../src/database';

const LEN = 128;

async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-dscm-'));
  const disks = path.join(dir, 'disks');
  await fs.mkdir(disks, { recursive: true });
  const global0 = path.join(disks, 'global.dsk');
  await fs.writeFile(global0, Buffer.alloc(LEN * 2, 0x11));
  const over = path.join(disks, 'override.dsk');
  await fs.writeFile(over, Buffer.alloc(LEN * 2, 0x22));
  const over2 = path.join(disks, 'override2.dsk');
  await fs.writeFile(over2, Buffer.alloc(LEN * 2, 0x33));
  const registry = new MountRegistry();
  registry.set(0, global0, false);
  const clientMounts = new ClientMountRegistry();
  const db = new Database(path.join(dir, 'test.db'));
  await db.initialize();
  return { dir, disks, global0, over, over2, registry, clientMounts, db };
}

describe('DriveSession per-client mount resolution', () => {
  test('client override wins over the global mount', async () => {
    const { dir, over, registry, clientMounts } = await setup();
    clientMounts.set('a', 0, over, false);

    const s = new DriveSession({ clientId: 'a', registry, clientMounts });
    await s.sync();
    // Reads come from the override image (0x22), not the global (0x11).
    expect((await s.readTrack(0, 0, LEN)).equals(Buffer.alloc(LEN, 0x22))).toBe(true);

    await s.dispose();
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('a drive with no override inherits the global mount', async () => {
    const { dir, registry, clientMounts } = await setup();
    const s = new DriveSession({ clientId: 'a', registry, clientMounts });
    await s.sync();
    expect((await s.readTrack(0, 0, LEN)).equals(Buffer.alloc(LEN, 0x11))).toBe(true);
    await s.dispose();
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('another client without the override still sees global', async () => {
    const { dir, over, registry, clientMounts } = await setup();
    clientMounts.set('a', 0, over, false);
    const b = new DriveSession({ clientId: 'b', registry, clientMounts });
    await b.sync();
    expect((await b.readTrack(0, 0, LEN)).equals(Buffer.alloc(LEN, 0x11))).toBe(true);
    await b.dispose();
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('editing the override re-syncs and discards the stale splinter', async () => {
    const { dir, over, over2, registry, clientMounts, db } = await setup();
    clientMounts.set('a', 0, over, false);

    const s = new DriveSession({ clientId: 'a', registry, clientMounts, database: db });
    await s.sync();
    await s.writeTrack(0, 0, LEN, Buffer.alloc(LEN, 0xaa)); // forks a splinter of `over`
    const splinter = s.getScratchPath(0)!;
    expect(await db.getClientSplinter('a', 0)).not.toBeNull();

    // Operator points this client's drive 0 at a different image.
    clientMounts.set('a', 0, over2, false);
    await s.sync();

    // Re-opened on the new base: no splinter yet, reads come from override2 (0x33).
    expect(s.getScratchPath(0)).toBeNull();
    expect((await s.readTrack(0, 0, LEN)).equals(Buffer.alloc(LEN, 0x33))).toBe(true);
    await expect(fs.access(splinter)).rejects.toBeTruthy();
    expect(await db.getClientSplinter('a', 0)).toBeNull();

    await s.dispose();
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('clearing the override falls back to the global mount', async () => {
    const { dir, over, registry, clientMounts } = await setup();
    clientMounts.set('a', 0, over, false);
    const s = new DriveSession({ clientId: 'a', registry, clientMounts });
    await s.sync();
    expect((await s.readTrack(0, 0, LEN)).equals(Buffer.alloc(LEN, 0x22))).toBe(true);

    clientMounts.clear('a', 0);
    await s.sync();
    expect((await s.readTrack(0, 0, LEN)).equals(Buffer.alloc(LEN, 0x11))).toBe(true);

    await s.dispose();
    await fs.rm(dir, { recursive: true, force: true });
  });
});
