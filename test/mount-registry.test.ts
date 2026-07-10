/**
 * Tests for MountRegistry (the operator mount table) and DriveManager keeping
 * it in lockstep as the sole writer. Uses real files (no fs mock).
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { MountRegistry } from '../src/mount-registry';
import { DriveManager } from '../src/drive';

describe('MountRegistry (unit)', () => {
  test('set records an entry and bumps epoch; get/isMounted reflect it', () => {
    const r = new MountRegistry();
    expect(r.isMounted(0)).toBe(false);
    r.set(0, '/disks/a.dsk', false);
    const e1 = r.get(0)!;
    expect(e1.filename).toBe('/disks/a.dsk');
    expect(e1.readonly).toBe(false);
    expect(e1.epoch).toBeGreaterThan(0);

    r.set(0, '/disks/b.dsk', true);
    expect(r.get(0)!.filename).toBe('/disks/b.dsk');
    expect(r.get(0)!.epoch).toBeGreaterThan(e1.epoch);
  });

  test('setReadonly only bumps epoch on an actual change', () => {
    const r = new MountRegistry();
    r.set(1, '/disks/a.dsk', false);
    const e = r.get(1)!.epoch;
    r.setReadonly(1, false); // no change
    expect(r.get(1)!.epoch).toBe(e);
    r.setReadonly(1, true); // change
    expect(r.get(1)!.readonly).toBe(true);
    expect(r.get(1)!.epoch).toBeGreaterThan(e);
  });

  test('setReadonly is a no-op when the drive is not mounted', () => {
    const r = new MountRegistry();
    r.setReadonly(2, true);
    expect(r.get(2)).toBeNull();
  });

  test('clear removes the entry', () => {
    const r = new MountRegistry();
    r.set(3, '/disks/a.dsk', false);
    r.clear(3);
    expect(r.isMounted(3)).toBe(false);
  });
});

describe('DriveManager keeps the registry in sync', () => {
  async function makeDisk(): Promise<{ dir: string; file: string }> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-reg-'));
    const file = path.join(dir, 'disk.dsk');
    await fs.writeFile(file, Buffer.alloc(512, 0));
    return { dir, file };
  }

  test('mount populates, writeProtect flips readonly, unmount clears', async () => {
    const { dir, file } = await makeDisk();
    const dm = new DriveManager();
    const reg = new MountRegistry();
    dm.setMountRegistry(reg);

    await dm.mountDrive(0, file);
    expect(reg.get(0)).toMatchObject({ filename: file, readonly: false });
    const mountEpoch = reg.get(0)!.epoch;

    await dm.writeProtect(0, true);
    expect(reg.get(0)!.readonly).toBe(true);
    expect(reg.get(0)!.epoch).toBeGreaterThan(mountEpoch);

    await dm.unmountDrive(0);
    expect(reg.isMounted(0)).toBe(false);

    await dm.cleanup();
    await fs.rm(dir, { recursive: true, force: true });
  });
});
