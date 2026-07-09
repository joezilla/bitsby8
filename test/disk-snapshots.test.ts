/**
 * Tests for src/services/disk-snapshots.ts
 *
 * Uses a real temp directory and a real better-sqlite3 database rather than
 * mocking fs — the byte-for-byte copy/rollback and the metadata cascade are
 * exactly the properties that would silently regress under a mock.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Database } from '../src/database';
import {
  SnapshotError,
  createSnapshot,
  listSnapshots,
  rollbackSnapshot,
  deleteSnapshot,
  deleteSnapshotsForDisk,
  renameSnapshotsForDisk,
  snapshotFromScratch,
} from '../src/services/disk-snapshots';
import type { Dependencies } from '../src/types';

const DISK = 'test.dsk';

interface Harness {
  deps: Dependencies;
  disksDir: string;
  db: Database;
  /** Pretend the disk is mounted on the given drive (or unmount with null). */
  setMounted: (drive: number | null) => void;
}

async function makeHarness(diskContents: Buffer): Promise<Harness> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-snap-'));
  const disksDir = path.join(root, 'disks');
  await fs.mkdir(disksDir, { recursive: true });
  await fs.writeFile(path.join(disksDir, DISK), diskContents);

  const db = new Database(path.join(root, 'test.db'));
  await db.initialize();

  let mountedDrive: number | null = null;
  const driveManager = {
    getDriveState(i: number) {
      if (mountedDrive === i) {
        return { mounted: true, filename: path.join(disksDir, DISK) };
      }
      return { mounted: false, filename: null };
    },
  };

  const deps = {
    config: { disksDir },
    database: db,
    driveManager,
  } as unknown as Dependencies;

  return { deps, disksDir, db, setMounted: (d) => { mountedDrive = d; } };
}

describe('disk snapshots', () => {
  test('create records label + size and stores a blob; list returns it', async () => {
    const h = await makeHarness(Buffer.from('ORIGINAL'));
    const snap = await createSnapshot(h.deps, DISK, 'before format');

    expect(snap.disk_filename).toBe(DISK);
    expect(snap.label).toBe('before format');
    expect(snap.size_bytes).toBe('ORIGINAL'.length);
    expect(snap.created_at).toBeTruthy();

    // Blob exists under the hidden snapshots dir.
    const blob = path.join(h.disksDir, '.snapshots', `${snap.id}.snap`);
    await expect(fs.access(blob)).resolves.toBeUndefined();

    const list = await listSnapshots(h.deps, DISK);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(snap.id);
  });

  test('create fails with 404 for a missing disk image', async () => {
    const h = await makeHarness(Buffer.from('X'));
    await expect(createSnapshot(h.deps, 'nope.dsk')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  test('create rejects path-traversal filenames', async () => {
    const h = await makeHarness(Buffer.from('X'));
    await expect(createSnapshot(h.deps, '../escape.dsk')).rejects.toBeInstanceOf(SnapshotError);
  });

  test('rollback restores the original bytes after the disk changed', async () => {
    const h = await makeHarness(Buffer.from('ORIGINAL'));
    const snap = await createSnapshot(h.deps, DISK);

    // Mutate the live disk.
    await fs.writeFile(path.join(h.disksDir, DISK), Buffer.from('MODIFIED-LONGER'));

    await rollbackSnapshot(h.deps, DISK, snap.id);

    const restored = await fs.readFile(path.join(h.disksDir, DISK));
    expect(restored.toString()).toBe('ORIGINAL');
  });

  test('rollback is refused while the disk is mounted', async () => {
    const h = await makeHarness(Buffer.from('ORIGINAL'));
    const snap = await createSnapshot(h.deps, DISK);
    h.setMounted(0);

    await expect(rollbackSnapshot(h.deps, DISK, snap.id)).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  test('rollback fails for an unknown snapshot id', async () => {
    const h = await makeHarness(Buffer.from('ORIGINAL'));
    await expect(rollbackSnapshot(h.deps, DISK, 'deadbeef')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  test('delete removes the blob and the row', async () => {
    const h = await makeHarness(Buffer.from('ORIGINAL'));
    const snap = await createSnapshot(h.deps, DISK);
    const blob = path.join(h.disksDir, '.snapshots', `${snap.id}.snap`);

    await deleteSnapshot(h.deps, DISK, snap.id);

    await expect(fs.access(blob)).rejects.toBeTruthy();
    expect(await listSnapshots(h.deps, DISK)).toHaveLength(0);
  });

  test('deleteSnapshotsForDisk clears every snapshot + blob (delete cascade)', async () => {
    const h = await makeHarness(Buffer.from('ORIGINAL'));
    const a = await createSnapshot(h.deps, DISK, 'a');
    const b = await createSnapshot(h.deps, DISK, 'b');

    await deleteSnapshotsForDisk(h.deps, DISK);

    expect(await listSnapshots(h.deps, DISK)).toHaveLength(0);
    for (const id of [a.id, b.id]) {
      const blob = path.join(h.disksDir, '.snapshots', `${id}.snap`);
      await expect(fs.access(blob)).rejects.toBeTruthy();
    }
  });

  test('snapshotFromScratch records a snapshot from an arbitrary source file', async () => {
    const h = await makeHarness(Buffer.from('ORIGINAL'));
    const scratch = path.join(h.disksDir, 'scratch.bin');
    await fs.writeFile(scratch, Buffer.from('SCRATCH-STATE'));

    const snap = await snapshotFromScratch(h.deps, DISK, scratch, 'session save');
    expect(snap.disk_filename).toBe(DISK);
    expect(snap.label).toBe('session save');
    expect(snap.size_bytes).toBe('SCRATCH-STATE'.length);

    const blob = await fs.readFile(path.join(h.disksDir, '.snapshots', `${snap.id}.snap`));
    expect(blob.toString()).toBe('SCRATCH-STATE');
    expect(await listSnapshots(h.deps, DISK)).toHaveLength(1);
  });

  test('renameSnapshotsForDisk repoints snapshots to the new filename (rename cascade)', async () => {
    const h = await makeHarness(Buffer.from('ORIGINAL'));
    await createSnapshot(h.deps, DISK, 'keep me');

    await renameSnapshotsForDisk(h.deps, DISK, 'renamed.dsk');

    expect(await listSnapshots(h.deps, DISK)).toHaveLength(0);
    const moved = await listSnapshots(h.deps, 'renamed.dsk');
    expect(moved).toHaveLength(1);
    expect(moved[0].label).toBe('keep me');
  });
});
