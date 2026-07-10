/**
 * Tests for the shared transient-keep service (commit / save-as-snapshot),
 * including the guards. Uses a real temp DB + disks dir and a fake driveManager
 * exposing per-drive transient state.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Database } from '../src/database';
import { commitTransientDrive, saveTransientSnapshot } from '../src/services/transient-service';
import { ServiceError } from '../src/services/service-error';

const LEN = 128;

async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-ts-'));
  const disksDir = path.join(dir, 'disks');
  await fs.mkdir(disksDir, { recursive: true });
  const master = path.join(disksDir, 'game.dsk');
  await fs.writeFile(master, Buffer.alloc(LEN * 2, 0x11));
  const scratch = path.join(disksDir, 'scratch.bin');
  await fs.writeFile(scratch, Buffer.alloc(LEN * 2, 0xab));

  const database = new Database(path.join(dir, 'test.db'));
  await database.initialize();

  // Fake driveManager: drive 0 is transient-backed by `scratch` over `master`.
  const states: Record<number, any> = {
    0: { mounted: true, transient: true, filename: master, scratchPath: scratch },
  };
  let committed = false;
  const driveManager = {
    getDriveState: (i: number) => states[i] ?? { mounted: false, transient: false, filename: null },
    commitTransient: async (_i: number) => { committed = true; },
  };
  const deps: any = { config: { disksDir }, database, driveManager };
  return { dir, master, scratch, deps, states, wasCommitted: () => committed };
}

describe('transient-service', () => {
  test('commit calls driveManager.commitTransient and reports the master', async () => {
    const { dir, deps, wasCommitted } = await setup();
    const res = await commitTransientDrive(deps, 0);
    expect(res).toEqual({ drive: 0, filename: 'game.dsk' });
    expect(wasCommitted()).toBe(true);
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('commit is refused when the master is mounted on another drive', async () => {
    const { dir, deps, states, master } = await setup();
    states[1] = { mounted: true, transient: false, filename: master };
    await expect(commitTransientDrive(deps, 0)).rejects.toMatchObject({ statusCode: 409 });
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('commit rejects a non-transient drive', async () => {
    const { dir, deps } = await setup();
    await expect(commitTransientDrive(deps, 2)).rejects.toBeInstanceOf(ServiceError);
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('save-as-snapshot persists the scratch as a snapshot of the master', async () => {
    const { dir, deps } = await setup();
    const snap = await saveTransientSnapshot(deps, 0, 'keep me');
    expect(snap.disk_filename).toBe('game.dsk');
    expect(snap.label).toBe('keep me');
    expect(snap.size_bytes).toBe(LEN * 2);
    expect(await deps.database.listSnapshotsForDisk('game.dsk')).toHaveLength(1);
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('invalid drive id is rejected', async () => {
    const { dir, deps } = await setup();
    await expect(commitTransientDrive(deps, 99)).rejects.toMatchObject({ statusCode: 400 });
    await fs.rm(dir, { recursive: true, force: true });
  });
});
