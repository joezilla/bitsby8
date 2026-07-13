/**
 * Per-profile startup disk mounts (Bitsby8).
 *
 * Which disk image (if any) each drive gets when a machine is launched from a
 * profile. Keyed by profile NAME so the disk set follows the machine lineage
 * across saved versions — profiles stay content-addressed, so disks live in the
 * `profile_disks` side table, never in profile content. Applied at launch as
 * per-instance mount overrides (see instance-manager), overlaying the operator's
 * global mounts: profile disks win on the drives they specify; unspecified drives
 * still inherit the global mount.
 *
 * Shared by the REST routes; mirrors client-service's per-drive override shape.
 */

import { Dependencies } from '../types';
import { safeResolvePath } from '../utils/safe-path';
import { ServiceError } from './service-error';

/** Drive slots a profile can bind, matching the operator's four drive bays. */
export const PROFILE_BAYS = 4;

export interface ProfileDiskBinding {
  drive: number;
  filename: string;
  readonly: boolean;
}

function assertDrive(drive: number): void {
  if (isNaN(drive) || drive < 0 || drive >= PROFILE_BAYS) {
    throw new ServiceError('Invalid drive', 400);
  }
}

/**
 * Resolve a profile reference to the name that keys its disk set. A stored
 * profile ref is `name@version` (or a bare name); presets/inline machines have
 * no persistent name, so they carry no startup-disk config.
 */
export function profileNameOf(ref: string): string | null {
  if (!ref || ref.startsWith('preset:') || ref === 'inline') return null;
  const name = ref.split('@')[0];
  return name || null;
}

function requireName(ref: string): string {
  const name = profileNameOf(ref);
  if (!name) throw new ServiceError('Startup disks apply only to stored profiles', 400);
  return name;
}

/** A profile's startup disk bindings, sorted by drive. */
export async function listProfileDisks(deps: Dependencies, ref: string): Promise<ProfileDiskBinding[]> {
  const name = requireName(ref);
  const rows = await deps.database.listProfileDisks(name);
  return rows.map((r) => ({ drive: r.drive, filename: r.filename, readonly: r.readonly === 1 }));
}

/** Bind a disk image to one of a profile's drives. Validates the image exists. */
export async function setProfileDisk(
  deps: Dependencies,
  ref: string,
  drive: number,
  filename: string,
  readonly: boolean,
): Promise<void> {
  const name = requireName(ref);
  assertDrive(drive);
  if (!filename || typeof filename !== 'string' || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    throw new ServiceError('Invalid filename', 400);
  }
  const full = safeResolvePath(deps.config.disksDir, filename);
  if (!full) throw new ServiceError('Disk image not found', 404);
  await deps.database.setProfileDisk(name, drive, filename, readonly);
}

/** Clear a profile's binding on one drive. */
export async function clearProfileDisk(deps: Dependencies, ref: string, drive: number): Promise<void> {
  const name = requireName(ref);
  assertDrive(drive);
  await deps.database.deleteProfileDisk(name, drive);
}
