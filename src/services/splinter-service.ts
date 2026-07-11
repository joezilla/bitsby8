/**
 * Persistent per-client splinter "keep" actions — the multi-client analogue of
 * transient-service. A splinter is a client's private copy-on-write fork of a
 * shared master image (see drive-session.ts), recorded in the `client_splinters`
 * table at a stable path. These operate on that on-disk file via its DB row, so
 * they work whether or not the client is currently connected.
 *
 * Three operator-chosen actions:
 *   - commit the splinter back onto its master image (hot-swap in place), or
 *   - save the splinter as a snapshot of its master, or
 *   - save the splinter as a brand-new named disk image (non-destructive).
 *
 * Commit reframes "overwrite a mounted image" as a hot base-swap: after the
 * atomic replace, every open handle is reloaded (operator drives via
 * DriveManager.reloadDrive + the swap window, client sessions via
 * connectionManager.syncAll). Splinters re-attach by base *name*, so every
 * client keeps its own writes; only readers of the base pick up the new bytes.
 * The one unsafe case — the base held read-write by a live master-write path —
 * is refused, since its in-flight write to the old inode would be orphaned.
 */

import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { Dependencies } from '../types';
import { ClientSplinter, SnapshotRecord } from '../database';
import { snapshotFromScratch } from './disk-snapshots';
import { broadcastStatus } from './disk-serving';
import { safeResolvePath } from '../utils/safe-path';
import { getMountRegistry } from '../mount-registry';
import { getClientMountRegistry } from '../client-mount-registry';
import { MAX_DRIVES } from '../protocol';
import { CLIENT_BAYS } from './client-service';
import { ServiceError } from './service-error';

const VALID_EXTENSIONS = ['.dsk', '.img', '.ima'];

function assertClientId(id: string): void {
  if (!id || id.includes('/') || id.includes('\\') || id.includes('..')) {
    throw new ServiceError('Invalid client id', 400);
  }
}

/**
 * Resolve a client's persistent splinter for a drive, or throw. Guards the id
 * and drive, requires a recorded splinter row, and confirms the file is still
 * present on disk.
 */
async function requireSplinter(deps: Dependencies, clientId: string, drive: number): Promise<ClientSplinter> {
  assertClientId(clientId);
  if (isNaN(drive) || drive < 0 || drive >= CLIENT_BAYS) {
    throw new ServiceError('Invalid drive', 400);
  }
  const row = await deps.database.getClientSplinter(clientId, drive);
  if (!row) {
    throw new ServiceError(`No splinter for client ${clientId} on drive ${drive}`, 404);
  }
  try {
    await fs.access(row.path);
  } catch {
    throw new ServiceError('Splinter data missing', 404);
  }
  return row;
}

/**
 * True (with the offending holder) when `base` (a basename) is held read-write
 * by a live master-write path — either an operator DriveManager drive mounted
 * RW & non-transient on that base, or a connected client whose clientId equals
 * deps.writeMaster whose effective mount resolves to that base. In those cases
 * an open RW fd would be clobbered by the in-place overwrite, so commit is
 * refused. Reconstructed from registries only, without touching DriveSession
 * internals (mirrors DriveSession.resolveEffective). Returns false when safe.
 */
function baseWritableByLiveMaster(deps: Dependencies, base: string): number | string | false {
  // Operator drives (DriveManager): RW & not transient => a real writer on the base.
  for (let i = 0; i < MAX_DRIVES; i++) {
    const st = deps.driveManager.getDriveState(i);
    if (st && st.mounted && st.filename && path.basename(st.filename) === base && !st.readonly && !st.transient) {
      return i;
    }
  }
  // Master-write guest session: writesMaster opens the base O_RDWR directly.
  const master = deps.writeMaster;
  if (master && master !== 'none' && master !== 'serial') {
    const connected = deps.connectionManager?.list() ?? [];
    const masterConnected = connected.some((c) => c.clientId === master);
    if (masterConnected) {
      const clientReg = getClientMountRegistry();
      const globalReg = getMountRegistry();
      for (let d = 0; d < CLIENT_BAYS; d++) {
        const eff = clientReg.get(master, d) ?? globalReg.get(d);
        if (eff && path.basename(eff.filename) === base) {
          return master;
        }
      }
    }
  }
  return false;
}

/**
 * After the base bytes were replaced in place, force every open handle to
 * reopen: reload each operator drive holding `base` (swap window + epoch bump),
 * then resync every per-connection session (they re-attach splinters by base
 * name, so private writes survive), then broadcast status. Per-drive reload
 * errors are swallowed so one bad slot can't abort the rest — the commit itself
 * has already landed. Returns the drives actually reloaded.
 */
async function hotReloadBase(deps: Dependencies, base: string): Promise<number[]> {
  const reloaded: number[] = [];
  for (let i = 0; i < MAX_DRIVES; i++) {
    const st = deps.driveManager.getDriveState(i);
    if (st && st.mounted && st.filename && path.basename(st.filename) === base) {
      try {
        if (await deps.driveManager.reloadDrive(i)) reloaded.push(i);
      } catch {
        /* leave the slot as mountDrive left it; the commit already succeeded */
      }
    }
  }
  await deps.connectionManager?.syncAll();
  broadcastStatus(deps);
  return reloaded;
}

/**
 * Commit a client's splinter back onto its master image (hot-swap in place).
 * Refused only when the base is held read-write by a live master-write path.
 * The client's splinter is left intact (it keeps writing to its fork).
 */
export async function commitClientSplinter(
  deps: Dependencies,
  clientId: string,
  drive: number,
): Promise<{ clientId: string; drive: number; filename: string; hotSwapped: boolean; reloadedDrives: number[] }> {
  const row = await requireSplinter(deps, clientId, drive);
  const base = row.base_filename;

  const heldBy = baseWritableByLiveMaster(deps, base);
  if (heldBy !== false) {
    const who = typeof heldBy === 'number' ? `operator drive ${heldBy}` : `master-write client ${heldBy}`;
    throw new ServiceError(
      `Cannot commit: ${base} is held read-write by ${who}. Detach it (or set it read-only), or use "Save as new disk".`,
      409,
    );
  }

  const master = safeResolvePath(deps.config.disksDir, base);
  if (!master) {
    throw new ServiceError('Master image not found', 404);
  }

  // Atomic overwrite FIRST, then reload open handles. Reloading before the
  // rename would reopen the OLD bytes and let the swap window expire before the
  // new bytes land.
  const tmp = `${master}.commit.tmp`;
  try {
    await fs.copyFile(row.path, tmp);
    await fs.rename(tmp, master);
  } catch (err) {
    await fs.unlink(tmp).catch(() => { /* best-effort cleanup */ });
    throw err;
  }

  const reloadedDrives = await hotReloadBase(deps, base);
  return { clientId, drive, filename: base, hotSwapped: true, reloadedDrives };
}

/** Save a client's splinter as a snapshot of its master image. */
export async function saveClientSplinterSnapshot(
  deps: Dependencies,
  clientId: string,
  drive: number,
  label = '',
): Promise<SnapshotRecord> {
  const row = await requireSplinter(deps, clientId, drive);
  return snapshotFromScratch(deps, row.base_filename, row.path, label);
}

/**
 * Save a client's splinter as a brand-new named disk image in the library.
 * Non-destructive: never mounts and never touches the live base. Validates the
 * name like the create/clone routes and suffixes on collision (`-2`, `-3`, …).
 */
export async function saveClientSplinterAsDisk(
  deps: Dependencies,
  clientId: string,
  drive: number,
  newName: string,
): Promise<{ clientId: string; drive: number; filename: string }> {
  const row = await requireSplinter(deps, clientId, drive);

  if (!newName || typeof newName !== 'string' || !/^[a-zA-Z0-9_\-. ]+$/.test(newName)
      || newName.includes('..') || newName.includes('/') || newName.includes('\\')) {
    throw new ServiceError('Invalid filename. Only letters, numbers, spaces, underscores, hyphens, and periods allowed.', 400);
  }
  // Default the extension from the base image if the operator didn't supply one.
  const suppliedExt = path.extname(newName);
  const ext = suppliedExt || path.extname(row.base_filename) || '.dsk';
  if (!VALID_EXTENSIONS.includes(ext.toLowerCase())) {
    throw new ServiceError('Invalid extension. Must be .dsk, .img, or .ima', 400);
  }
  const stem = path.basename(newName, suppliedExt);
  let candidate = `${stem}${ext}`;
  let full = path.join(deps.config.disksDir, candidate);
  let n = 1;
  while (existsSync(full)) {
    n++;
    candidate = `${stem}-${n}${ext}`;
    full = path.join(deps.config.disksDir, candidate);
  }
  await fs.copyFile(row.path, full);
  return { clientId, drive, filename: candidate };
}
