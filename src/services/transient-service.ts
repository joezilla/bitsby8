/**
 * Transient copy-on-write "keep" actions — shared by the REST drive routes and
 * the MCP tools. Commit a transient drive's scratch back onto its master, or
 * save the scratch as a snapshot, with the same guards either way.
 */

import * as path from 'path';
import { Dependencies } from '../types';
import { MAX_DRIVES } from '../protocol';
import { snapshotFromScratch } from './disk-snapshots';
import { SnapshotRecord } from '../database';
import { ServiceError } from './service-error';

function requireTransient(deps: Dependencies, driveId: number) {
  if (isNaN(driveId) || driveId < 0 || driveId >= MAX_DRIVES) {
    throw new ServiceError('Invalid drive ID', 400);
  }
  const state = deps.driveManager.getDriveState(driveId);
  if (!state || !state.transient || !state.filename) {
    throw new ServiceError(`Drive ${driveId} is not transient-backed`, 400);
  }
  return state;
}

/**
 * Commit a transient drive's scratch back onto its master image. Refuses when
 * the same master is mounted on another drive (the commit would clobber it).
 */
export async function commitTransientDrive(deps: Dependencies, driveId: number): Promise<{ drive: number; filename: string }> {
  const state = requireTransient(deps, driveId);
  const master = path.basename(state.filename!);

  for (let i = 0; i < MAX_DRIVES; i++) {
    if (i === driveId) continue;
    const other = deps.driveManager.getDriveState(i);
    if (other && other.mounted && other.filename && path.basename(other.filename) === master) {
      throw new ServiceError(`Cannot commit: ${master} is also mounted on drive ${i}`, 409);
    }
  }

  await deps.driveManager.commitTransient(driveId);
  return { drive: driveId, filename: master };
}

/** Save a transient drive's scratch as a snapshot of its master image. */
export async function saveTransientSnapshot(deps: Dependencies, driveId: number, label = ''): Promise<SnapshotRecord> {
  const state = requireTransient(deps, driveId);
  if (!state.scratchPath) {
    throw new ServiceError(`Drive ${driveId} is not transient-backed`, 400);
  }
  return snapshotFromScratch(deps, path.basename(state.filename!), state.scratchPath, label);
}
