/**
 * Persistence tests for DriveSession: an identified client's splinter survives
 * a disconnect and re-attaches on a new session (server-restart equivalent),
 * and is discarded when the base image under it changes.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { MountRegistry } from '../src/mount-registry';
import { DriveSession } from '../src/drive-session';
import { Database } from '../src/database';

const LEN = 128;

async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-persist-'));
  const disks = path.join(dir, 'disks');
  await fs.mkdir(disks, { recursive: true });
  const master = path.join(disks, 'game.dsk');
  await fs.writeFile(master, Buffer.alloc(LEN * 4, 0x11));
  const master2 = path.join(disks, 'other.dsk');
  await fs.writeFile(master2, Buffer.alloc(LEN * 4, 0x22));
  const registry = new MountRegistry();
  registry.set(0, master, false);
  const db = new Database(path.join(dir, 'test.db'));
  await db.initialize();
  return { dir, disks, master, master2, registry, db };
}

describe('DriveSession persistent splinters', () => {
  test('identified client: splinter persists on disconnect and re-attaches', async () => {
    const { dir, disks, registry, db } = await setup();
    const payload = Buffer.alloc(LEN, 0xab);

    // First session writes, then disposes (disconnect).
    const s1 = new DriveSession({ clientId: 'altair-1', registry, database: db });
    await s1.sync();
    await s1.writeTrack(0, 0, LEN, payload);
    const splinter = s1.getScratchPath(0)!;
    expect(splinter.includes('.splinter')).toBe(true);
    expect(splinter.includes('altair-1')).toBe(true);
    await s1.dispose();

    // Splinter file and DB row survive the disconnect.
    await expect(fs.access(splinter)).resolves.toBeUndefined();
    expect(await db.getClientSplinter('altair-1', 0)).not.toBeNull();

    // A new session for the same client re-attaches and sees the prior write.
    const s2 = new DriveSession({ clientId: 'altair-1', registry, database: db });
    await s2.sync();
    expect(s2.getScratchPath(0)).toBe(splinter);
    expect(s2.getDriveState(0)!.dirty).toBe(true);
    expect((await s2.readTrack(0, 0, LEN)).equals(payload)).toBe(true);
    await s2.dispose();

    void disks;
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('anonymous client (no id): splinter is ephemeral, discarded on disconnect', async () => {
    const { dir, registry, db } = await setup();
    const s = new DriveSession({ clientId: null, registry, database: db });
    await s.sync();
    await s.writeTrack(0, 0, LEN, Buffer.alloc(LEN, 0x1));
    const splinter = s.getScratchPath(0)!;
    expect(splinter.includes('.transient')).toBe(true);
    await s.dispose();
    await expect(fs.access(splinter)).rejects.toBeTruthy();
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('base swap under a client discards the stale splinter', async () => {
    const { dir, master2, registry, db } = await setup();
    const s1 = new DriveSession({ clientId: 'altair-1', registry, database: db });
    await s1.sync();
    await s1.writeTrack(0, 0, LEN, Buffer.alloc(LEN, 0xab));
    const oldSplinter = s1.getScratchPath(0)!;
    await s1.dispose();

    // Operator mounts a DIFFERENT image on drive 0.
    registry.set(0, master2, false);

    const s2 = new DriveSession({ clientId: 'altair-1', registry, database: db });
    await s2.sync();
    // Stale splinter dropped; session now reads the new master (0x22), no fork yet.
    expect(s2.getScratchPath(0)).toBeNull();
    expect((await s2.readTrack(0, 0, LEN)).equals(Buffer.alloc(LEN, 0x22))).toBe(true);
    await expect(fs.access(oldSplinter)).rejects.toBeTruthy();
    expect(await db.getClientSplinter('altair-1', 0)).toBeNull();
    await s2.dispose();

    await fs.rm(dir, { recursive: true, force: true });
  });
});
