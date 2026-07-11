/**
 * Tests for DriveSession — the per-connection copy-on-write engine used for
 * non-master clients. Real files (no fs mock). The critical property is
 * isolation: each session's writes land on its own splinter, the master stays
 * pristine, and sessions never see each other's writes.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { MountRegistry } from '../src/mount-registry';
import { DriveSession } from '../src/drive-session';

const LEN = 128;

async function setup(): Promise<{ dir: string; master: string; registry: MountRegistry; original: Buffer }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-sess-'));
  const disks = path.join(dir, 'disks');
  await fs.mkdir(disks, { recursive: true });
  const master = path.join(disks, 'game.dsk');
  const original = Buffer.alloc(LEN * 4, 0x11);
  await fs.writeFile(master, original);
  const registry = new MountRegistry();
  registry.set(0, master, false);
  return { dir, master, registry, original };
}

describe('DriveSession copy-on-write', () => {
  test('sync opens mounted drives read-only; reads come from the master', async () => {
    const { dir, master, registry, original } = await setup();
    const s = new DriveSession({ clientId: 'a', registry });
    await s.sync();

    expect(s.isMounted(0)).toBe(true);
    expect(s.getScratchPath(0)).toBeNull();
    const read = await s.readTrack(0, 0, LEN);
    expect(read.equals(original.subarray(0, LEN))).toBe(true);

    await s.dispose();
    await fs.rm(dir, { recursive: true, force: true });
    void master;
  });

  test('first write forks a splinter; master stays pristine, read reflects the write', async () => {
    const { dir, master, registry, original } = await setup();
    const s = new DriveSession({ clientId: 'a', registry });
    await s.sync();

    const payload = Buffer.alloc(LEN, 0xab);
    await s.writeTrack(0, 0, LEN, payload);

    expect(s.getScratchPath(0)).toBeTruthy();
    expect(s.getDriveState(0)!.dirty).toBe(true);
    // Read-back from the session reflects the write.
    expect((await s.readTrack(0, 0, LEN)).equals(payload)).toBe(true);
    // Master on disk untouched.
    expect((await fs.readFile(master)).equals(original)).toBe(true);

    await s.dispose();
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('two sessions over one master are isolated from each other', async () => {
    const { dir, master, registry, original } = await setup();
    const a = new DriveSession({ clientId: 'a', registry });
    const b = new DriveSession({ clientId: 'b', registry });
    await a.sync();
    await b.sync();

    await a.writeTrack(0, 0, LEN, Buffer.alloc(LEN, 0xaa));

    // b still sees the pristine master, not a's write.
    expect((await b.readTrack(0, 0, LEN)).equals(original.subarray(0, LEN))).toBe(true);

    await b.writeTrack(0, 0, LEN, Buffer.alloc(LEN, 0xbb));
    // a still sees its own write, not b's.
    expect((await a.readTrack(0, 0, LEN)).equals(Buffer.alloc(LEN, 0xaa))).toBe(true);
    // master remains pristine.
    expect((await fs.readFile(master)).equals(original)).toBe(true);

    await a.dispose();
    await b.dispose();
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('dispose discards splinters', async () => {
    const { dir, registry } = await setup();
    const s = new DriveSession({ clientId: 'a', registry });
    await s.sync();
    await s.writeTrack(0, 0, LEN, Buffer.alloc(LEN, 0x1));
    const splinter = s.getScratchPath(0)!;

    await s.dispose();
    await expect(fs.access(splinter)).rejects.toBeTruthy();

    await fs.rm(dir, { recursive: true, force: true });
  });

  test('writesMaster session writes the base image directly (no splinter)', async () => {
    const { dir, master, registry, original } = await setup();
    const s = new DriveSession({ clientId: 'primary', registry, writesMaster: true });
    await s.sync();

    expect(s.getDriveState(0)!.transient).toBe(false);
    const payload = Buffer.alloc(LEN, 0xcd);
    await s.writeTrack(0, 0, LEN, payload);

    // No splinter; the write landed on the master itself.
    expect(s.getScratchPath(0)).toBeNull();
    const masterBytes = await fs.readFile(master);
    expect(masterBytes.subarray(0, LEN).equals(payload)).toBe(true);
    expect(masterBytes.subarray(LEN).equals(original.subarray(LEN))).toBe(true);

    await s.dispose();
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('sync drops a drive the operator unmounted', async () => {
    const { dir, registry } = await setup();
    const s = new DriveSession({ clientId: 'a', registry });
    await s.sync();
    expect(s.isMounted(0)).toBe(true);

    registry.clear(0);
    await s.sync();
    expect(s.isMounted(0)).toBe(false);

    await s.dispose();
    await fs.rm(dir, { recursive: true, force: true });
  });
});
