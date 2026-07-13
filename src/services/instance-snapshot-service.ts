/**
 * Instance disk/media snapshot + restore (Bitsby8 Story 3.4, FR-18).
 *
 * A snapshot captures the machine DEFINITION (the instance's profile ref) plus a
 * copy of each bound drive's disk state — the instance's copy-on-write splinter
 * where it has written, else the base mount — as a restorable unit. Execution
 * (CPU) state is explicitly NOT captured (out of scope).
 *
 * Restore writes the captured disk images back onto the target instance's
 * splinter files and re-records them, then restarts the instance so its
 * DriveSession re-attaches the restored splinters (see drive-session's
 * persistent re-attach path). A running instance is stopped and restarted.
 */

import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Dependencies } from '../types';
import { ServiceError } from './service-error';
import { InstanceSnapshotRecord } from '../database';
import { getMountRegistry } from '../mount-registry';
import { SPLINTER_DIRNAME } from '../drive-session';
import { createLogger } from '../logger';

const log = createLogger('instance-snapshot');

const SNAPSHOT_DIRNAME = '.instance-snapshots';

export interface SnapshotDiskInfo {
  drive: number;
  filename: string; // base image filename this drive was bound to
}

export interface InstanceSnapshotDoc {
  id: string;
  instanceId: string;
  profileRef: string;
  label: string | null;
  disks: SnapshotDiskInfo[];
  createdAt: string;
}

interface DiskManifestEntry {
  drive: number;
  base_filename: string;
  file: string; // relative file name within the snapshot dir
}

function instanceManager(deps: Dependencies) {
  if (!deps.instanceManager) throw new ServiceError('Virtual machine instances are not available', 409);
  return deps.instanceManager;
}

function disksDir(deps: Dependencies): string {
  const dir = deps.config?.disksDir;
  if (!dir) throw new ServiceError('Disk directory is not configured', 500);
  return dir;
}

const safeClientId = (clientId: string) => clientId.replace(/[^a-zA-Z0-9_-]/g, '_');
const snapshotDir = (deps: Dependencies, id: string) => path.join(disksDir(deps), SNAPSHOT_DIRNAME, id);
const splinterPath = (deps: Dependencies, clientId: string, drive: number) =>
  path.join(disksDir(deps), SPLINTER_DIRNAME, safeClientId(clientId), `drive${drive}.img`);

function toDoc(rec: InstanceSnapshotRecord): InstanceSnapshotDoc {
  const disks = (JSON.parse(rec.disks) as DiskManifestEntry[]).map((d) => ({
    drive: d.drive,
    filename: d.base_filename,
  }));
  return {
    id: rec.id,
    instanceId: rec.instance_id,
    profileRef: rec.profile_ref,
    label: rec.label,
    disks,
    createdAt: rec.created_at,
  };
}

/**
 * Snapshot a running or stopped instance's disk/media state. Captures each
 * bound drive's current backing file (splinter where written, else base).
 */
export async function snapshotInstance(
  deps: Dependencies,
  instanceId: string,
  label?: string,
): Promise<InstanceSnapshotDoc> {
  const inst = instanceManager(deps).get(instanceId); // 404 if unknown
  const mounts = getMountRegistry().all();
  if (mounts.size === 0) {
    throw new ServiceError('Instance has no bound disks to snapshot', 409);
  }

  const id = randomUUID();
  const dir = snapshotDir(deps, id);
  await fs.mkdir(dir, { recursive: true });

  const manifest: DiskManifestEntry[] = [];
  try {
    for (const [drive, entry] of [...mounts.entries()].sort((a, b) => a[0] - b[0])) {
      // Prefer the instance's own splinter (its writes); fall back to the base.
      const splinter = await deps.database.getClientSplinter(inst.clientId, drive);
      let source = entry.filename;
      if (splinter && (await fs.access(splinter.path).then(() => true).catch(() => false))) {
        source = splinter.path;
      }
      const file = `drive${drive}.img`;
      await fs.copyFile(source, path.join(dir, file));
      manifest.push({ drive, base_filename: path.basename(entry.filename), file });
    }
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    throw new ServiceError(`Failed to snapshot instance disks: ${(err as Error).message}`, 500);
  }

  await deps.database.insertInstanceSnapshot({
    id,
    instance_id: instanceId,
    profile_ref: inst.profileRef,
    label: label ?? null,
    disks: JSON.stringify(manifest),
  });
  log.info({ id, instanceId, drives: manifest.map((m) => m.drive) }, 'instance disk snapshot taken');
  const rec = await deps.database.getInstanceSnapshot(id);
  return toDoc(rec!);
}

export async function listInstanceSnapshots(
  deps: Dependencies,
  instanceId?: string,
): Promise<InstanceSnapshotDoc[]> {
  return (await deps.database.listInstanceSnapshots(instanceId)).map(toDoc);
}

export async function getInstanceSnapshot(deps: Dependencies, id: string): Promise<InstanceSnapshotDoc> {
  const rec = await deps.database.getInstanceSnapshot(id);
  if (!rec) throw new ServiceError(`Instance snapshot not found: ${id}`, 404);
  return toDoc(rec);
}

/**
 * Restore a snapshot onto its instance (or an explicit target): stop it, write
 * the captured disk images onto the target's splinter files, re-record them,
 * then restart so the machine reads the restored disks. Reproduces the disk
 * state; the machine reboots (execution state was never captured).
 */
export async function restoreInstanceSnapshot(
  deps: Dependencies,
  snapshotId: string,
  targetInstanceId?: string,
): Promise<{ instanceId: string; restored: number[] }> {
  const rec = await deps.database.getInstanceSnapshot(snapshotId);
  if (!rec) throw new ServiceError(`Instance snapshot not found: ${snapshotId}`, 404);
  const instanceId = targetInstanceId ?? rec.instance_id;
  const inst = instanceManager(deps).get(instanceId); // 404 if the instance is gone
  const manifest = JSON.parse(rec.disks) as DiskManifestEntry[];
  const dir = snapshotDir(deps, snapshotId);

  const wasRunning = inst.status === 'running';
  if (wasRunning) await instanceManager(deps).stop(instanceId); // close handles

  const restored: number[] = [];
  for (const d of manifest) {
    const src = path.join(dir, d.file);
    if (!(await fs.access(src).then(() => true).catch(() => false))) continue;
    const dest = splinterPath(deps, inst.clientId, d.drive);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
    // Record the splinter so the DriveSession re-attaches it on start (its
    // reuse check requires a matching base_filename + an existing file).
    await deps.database.upsertClientSplinter(inst.clientId, d.drive, d.base_filename, dest, true);
    restored.push(d.drive);
  }

  if (wasRunning) await instanceManager(deps).start(instanceId);
  log.info({ snapshotId, instanceId, restored }, 'instance disk snapshot restored');
  return { instanceId, restored };
}

export async function deleteInstanceSnapshot(deps: Dependencies, id: string): Promise<void> {
  const rec = await deps.database.getInstanceSnapshot(id);
  if (!rec) return;
  await fs.rm(snapshotDir(deps, id), { recursive: true, force: true }).catch(() => {});
  await deps.database.deleteInstanceSnapshot(id);
}
