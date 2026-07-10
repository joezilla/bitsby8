/**
 * Integration tests for DriveManager copy-on-write ("transient") backing.
 *
 * These use REAL files (no fs mock) so the byte-level redirect — writes hit a
 * scratch copy, the master stays pristine — is actually exercised. Kept in a
 * separate file from drive.test.ts, which mocks fs/promises module-wide.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { DriveManager, TRANSIENT_DIRNAME } from '../src/drive';

const LEN = 128; // bytes per track for the test

async function makeMaster(): Promise<{ dir: string; master: string; original: Buffer }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-transient-'));
  const master = path.join(dir, 'master.dsk');
  const original = Buffer.alloc(LEN * 4, 0x11); // 4 tracks of 0x11
  await fs.writeFile(master, original);
  return { dir, master, original };
}

describe('DriveManager transient (copy-on-write) backing', () => {
  test('read-only + transient policy: writes hit scratch, master stays pristine', async () => {
    const { dir, master, original } = await makeMaster();
    const dm = new DriveManager();
    dm.setTransientPolicyResolver(() => true);

    await dm.writeProtect(0, true); // mark read-only before mounting
    await dm.mountDrive(0, master);

    const st = dm.getDriveState(0)!;
    expect(st.readonly).toBe(true);
    expect(st.transient).toBe(true);
    expect(st.scratchPath).toBeTruthy();
    expect(st.filename).toBe(master); // filename stays the master
    expect(st.dirty).toBe(false);
    // Scratch lives under the hidden transient dir.
    expect(st.scratchPath!.includes(TRANSIENT_DIRNAME)).toBe(true);

    // Write a track — should succeed despite the drive being read-only.
    const payload = Buffer.alloc(LEN, 0xab);
    const written = await dm.writeTrack(0, 0, LEN, payload);
    expect(written).toBe(LEN);
    expect(dm.getDriveState(0)!.dirty).toBe(true);

    // The write landed on the scratch...
    const scratchBytes = await fs.readFile(st.scratchPath!);
    expect(scratchBytes.subarray(0, LEN).equals(payload)).toBe(true);
    // ...and a read reflects it (copy-on-write read-back).
    const readBack = await dm.readTrack(0, 0, LEN);
    expect(readBack.equals(payload)).toBe(true);

    // ...but the master on disk is untouched.
    const masterBytes = await fs.readFile(master);
    expect(masterBytes.equals(original)).toBe(true);

    await dm.cleanup();
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('unmount discards the scratch', async () => {
    const { dir, master } = await makeMaster();
    const dm = new DriveManager();
    dm.setTransientPolicyResolver(() => true);
    await dm.writeProtect(0, true);
    await dm.mountDrive(0, master);
    const scratch = dm.getDriveState(0)!.scratchPath!;

    await dm.unmountDrive(0);

    await expect(fs.access(scratch)).rejects.toBeTruthy();
    const st = dm.getDriveState(0)!;
    expect(st.transient).toBe(false);
    expect(st.scratchPath).toBeNull();

    await fs.rm(dir, { recursive: true, force: true });
  });

  test("policy 'error' (resolver false): writes to a read-only drive still fail", async () => {
    const { dir, master } = await makeMaster();
    const dm = new DriveManager();
    dm.setTransientPolicyResolver(() => false);
    await dm.writeProtect(0, true);
    await dm.mountDrive(0, master);

    expect(dm.getDriveState(0)!.transient).toBe(false);
    await expect(dm.writeTrack(0, 0, LEN, Buffer.alloc(LEN, 0x1))).rejects.toThrow(/read-only/i);

    await dm.cleanup();
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('commitTransient writes the scratch back onto the master', async () => {
    const { dir, master, original } = await makeMaster();
    const dm = new DriveManager();
    dm.setTransientPolicyResolver(() => true);
    await dm.writeProtect(0, true);
    await dm.mountDrive(0, master);

    const payload = Buffer.alloc(LEN, 0xcd);
    await dm.writeTrack(0, 0, LEN, payload);

    // Before commit the master is unchanged.
    expect((await fs.readFile(master)).equals(original)).toBe(true);

    await dm.commitTransient(0);

    // After commit the master reflects the scratch; drive stays transient/clean.
    const masterBytes = await fs.readFile(master);
    expect(masterBytes.subarray(0, LEN).equals(payload)).toBe(true);
    expect(dm.getDriveState(0)!.transient).toBe(true);
    expect(dm.getDriveState(0)!.dirty).toBe(false);

    await dm.cleanup();
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('reloadDrive reopens the handle and stamps the swap window', async () => {
    const { dir, master } = await makeMaster();
    const dm = new DriveManager();

    // Plain read-write mount, read the original bytes (no swap window yet).
    await dm.mountDrive(0, master);
    expect((await dm.readTrack(0, 0, LEN)).equals(Buffer.alloc(LEN, 0x11))).toBe(true);
    expect(dm.isInSwapWindow(0)).toBe(false);

    // Replace the base file atomically (new inode), as a commit does, then reload.
    const tmp = `${master}.tmp`;
    await fs.writeFile(tmp, Buffer.alloc(LEN * 4, 0x77));
    await fs.rename(tmp, master);
    const reloaded = await dm.reloadDrive(0);

    // Reopened and the FDC-invalidation swap window is now active (reads NOT_READY
    // until it lapses, so the guest re-fetches from the new bytes).
    expect(reloaded).toBe(true);
    expect(dm.getDriveState(0)!.mounted).toBe(true);
    expect(dm.isInSwapWindow(0)).toBe(true);
    await expect(dm.readTrack(0, 0, LEN)).rejects.toThrow(/swap window/i);

    await dm.cleanup();
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('reloadDrive on an RO+transient drive re-cuts the scratch from the new base', async () => {
    const { dir, master } = await makeMaster();
    const dm = new DriveManager();
    dm.setTransientPolicyResolver(() => true);
    await dm.writeProtect(0, true);
    await dm.mountDrive(0, master);
    const firstScratch = dm.getDriveState(0)!.scratchPath!;

    // Replace the base bytes, then reload — a fresh scratch is cut from the new base.
    const tmp = `${master}.tmp`;
    await fs.writeFile(tmp, Buffer.alloc(LEN * 4, 0x55));
    await fs.rename(tmp, master);
    await dm.reloadDrive(0);

    const st = dm.getDriveState(0)!;
    expect(st.transient).toBe(true);
    expect(st.scratchPath).not.toBe(firstScratch); // fresh scratch
    // The new scratch was copied from the NEW base bytes (read the file directly,
    // since the swap window would block a track read right after reload).
    expect((await fs.readFile(st.scratchPath!)).equals(Buffer.alloc(LEN * 4, 0x55))).toBe(true);
    await expect(fs.access(firstScratch)).rejects.toBeTruthy(); // old scratch discarded

    await dm.cleanup();
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('toggling read-only off then on re-decides transient backing', async () => {
    const { dir, master } = await makeMaster();
    const dm = new DriveManager();
    dm.setTransientPolicyResolver(() => true);

    // Mount read-write: no transient.
    await dm.mountDrive(0, master);
    expect(dm.getDriveState(0)!.transient).toBe(false);

    // Toggle to read-only: transient scratch appears.
    await dm.writeProtect(0, true);
    const st = dm.getDriveState(0)!;
    expect(st.transient).toBe(true);
    expect(st.scratchPath).toBeTruthy();
    const scratch = st.scratchPath!;

    // Toggle back to read-write: scratch is dropped, master opened directly.
    await dm.writeProtect(0, false);
    expect(dm.getDriveState(0)!.transient).toBe(false);
    await expect(fs.access(scratch)).rejects.toBeTruthy();

    await dm.cleanup();
    await fs.rm(dir, { recursive: true, force: true });
  });
});
