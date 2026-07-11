/**
 * Disk snapshot service — the single source of truth for creating, listing,
 * restoring, and deleting point-in-time copies of a disk image. Shared by the
 * REST routes (src/routes/snapshots.ts) and the MCP tools (src/mcp-server.ts).
 *
 * A snapshot is a full-file copy of the disk image (images are small, ≤10 MB)
 * stored as `{disksDir}/.snapshots/<id>.snap`, with metadata rows in SQLite.
 * The `.snapshots` dir is hidden from the non-recursive image listing, so
 * snapshots never appear in the disk library.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { randomBytes } from 'crypto';
import { Dependencies } from '../types';
import { SnapshotRecord } from '../database';
import { safeResolvePath } from '../utils/safe-path';
import { isDiskMounted } from '../utils/drive-status';
import { createLogger } from '../logger';

const log = createLogger('disk-snapshots');

const SNAPSHOT_DIRNAME = '.snapshots';

/**
 * Error carrying an HTTP status code so route handlers can map service
 * failures to the right response without string-matching.
 */
export class SnapshotError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** Reject path-traversal and empty filenames. */
function assertSafeFilename(filename: string): void {
  if (!filename) {
    throw new SnapshotError('Filename is required', 400);
  }
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    throw new SnapshotError('Invalid filename', 400);
  }
}

function snapshotDir(deps: Dependencies): string {
  return path.join(deps.config.disksDir, SNAPSHOT_DIRNAME);
}

function snapshotBlobPath(deps: Dependencies, id: string): string {
  return path.join(snapshotDir(deps), `${id}.snap`);
}

/**
 * Resolve the disk image path, throwing 404 if it does not exist. Also guards
 * the filename. Returns the absolute, symlink-safe path.
 */
function resolveDiskOr404(deps: Dependencies, filename: string): string {
  assertSafeFilename(filename);
  const full = safeResolvePath(deps.config.disksDir, filename);
  if (!full) {
    throw new SnapshotError('Disk image not found', 404);
  }
  return full;
}

/**
 * Copy `sourcePath` into the snapshot store and record it as a snapshot of
 * `diskFilename`. Shared by createSnapshot (source = the master image) and
 * snapshotFromScratch (source = a transient scratch file).
 */
async function persistSnapshot(
  deps: Dependencies,
  diskFilename: string,
  sourcePath: string,
  label: string,
): Promise<SnapshotRecord> {
  await fs.mkdir(snapshotDir(deps), { recursive: true });
  const id = randomBytes(16).toString('hex');
  const blobPath = snapshotBlobPath(deps, id);

  await fs.copyFile(sourcePath, blobPath);
  const { size } = await fs.stat(blobPath);

  await deps.database.insertSnapshot(id, diskFilename, label.trim(), size);
  const record = await deps.database.getSnapshot(id);
  if (!record) {
    // Should be unreachable — the row was just inserted.
    throw new SnapshotError('Failed to persist snapshot', 500);
  }
  return record;
}

/**
 * Create a snapshot of a disk image. Allowed while the disk is mounted — the
 * drive syncs after every track write, so the copy is consistent enough.
 */
export async function createSnapshot(
  deps: Dependencies,
  filename: string,
  label = '',
): Promise<SnapshotRecord> {
  const sourcePath = resolveDiskOr404(deps, filename);
  const record = await persistSnapshot(deps, filename, sourcePath, label);
  log.info({ id: record.id, disk: filename, size: record.size_bytes, label: record.label }, 'Snapshot created');
  return record;
}

/**
 * Save an arbitrary source file (a transient scratch copy) as a snapshot of
 * `diskFilename`. Lets an operator keep a transient drive's working state.
 */
export async function snapshotFromScratch(
  deps: Dependencies,
  diskFilename: string,
  scratchPath: string,
  label = '',
): Promise<SnapshotRecord> {
  assertSafeFilename(diskFilename);
  const record = await persistSnapshot(deps, diskFilename, scratchPath, label);
  log.info({ id: record.id, disk: diskFilename, size: record.size_bytes, label: record.label }, 'Snapshot created from transient scratch');
  return record;
}

/** List snapshots for a disk image, newest first. */
export async function listSnapshots(
  deps: Dependencies,
  filename: string,
): Promise<SnapshotRecord[]> {
  assertSafeFilename(filename);
  return deps.database.listSnapshotsForDisk(filename);
}

/**
 * Roll a disk image back to a snapshot. Refused while the disk is mounted on
 * any drive — overwriting a file with an open fd would corrupt live I/O.
 */
export async function rollbackSnapshot(
  deps: Dependencies,
  filename: string,
  snapshotId: string,
): Promise<void> {
  const diskPath = resolveDiskOr404(deps, filename);

  const mountedDrive = isDiskMounted(deps, filename);
  if (mountedDrive !== false) {
    throw new SnapshotError(`Cannot roll back: image is mounted on drive ${mountedDrive}`, 409);
  }

  const snapshot = await deps.database.getSnapshot(snapshotId);
  if (!snapshot || snapshot.disk_filename !== filename) {
    throw new SnapshotError('Snapshot not found', 404);
  }

  const blobPath = snapshotBlobPath(deps, snapshotId);
  try {
    await fs.access(blobPath);
  } catch {
    throw new SnapshotError('Snapshot data missing', 404);
  }

  // Atomic overwrite: copy to a temp beside the image, then rename over it so
  // a crash mid-copy can't leave a truncated disk image.
  const tmpPath = `${diskPath}.rollback.tmp`;
  try {
    await fs.copyFile(blobPath, tmpPath);
    await fs.rename(tmpPath, diskPath);
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => { /* best-effort cleanup */ });
    throw err;
  }
  log.info({ id: snapshotId, disk: filename }, 'Rolled back to snapshot');
}

/** Delete a single snapshot (blob + metadata). */
export async function deleteSnapshot(
  deps: Dependencies,
  filename: string,
  snapshotId: string,
): Promise<void> {
  assertSafeFilename(filename);
  const snapshot = await deps.database.getSnapshot(snapshotId);
  if (!snapshot || snapshot.disk_filename !== filename) {
    throw new SnapshotError('Snapshot not found', 404);
  }
  await fs.unlink(snapshotBlobPath(deps, snapshotId)).catch(() => { /* blob may already be gone */ });
  await deps.database.deleteSnapshotRow(snapshotId);
  log.info({ id: snapshotId, disk: filename }, 'Snapshot deleted');
}

/**
 * Remove every snapshot belonging to a disk image (blobs + rows). Called when
 * the disk image itself is deleted so snapshots don't orphan.
 */
export async function deleteSnapshotsForDisk(deps: Dependencies, filename: string): Promise<void> {
  const ids = await deps.database.deleteSnapshotsForDisk(filename);
  await Promise.all(
    ids.map((id) => fs.unlink(snapshotBlobPath(deps, id)).catch(() => { /* best-effort */ })),
  );
  if (ids.length > 0) {
    log.info({ disk: filename, count: ids.length }, 'Deleted snapshots for removed disk');
  }
}

/**
 * Repoint a disk's snapshots to a new filename after the disk image is renamed.
 * Blobs are id-named, so this is a metadata-only update.
 */
export async function renameSnapshotsForDisk(
  deps: Dependencies,
  oldFilename: string,
  newFilename: string,
): Promise<void> {
  await deps.database.renameSnapshotsDisk(oldFilename, newFilename);
}
