/**
 * MountRegistry — the authoritative, operator-facing record of what image is
 * mounted on each drive and whether it's read-only. This is the "mounted disk
 * that remains" in the multi-device model: a single global mount table that
 * many per-connection drive views read from.
 *
 * Today the singleton DriveManager still performs all I/O; it also keeps this
 * registry in lockstep (it is the sole writer). The registry has no consumers
 * that change behavior yet — it is the seam the upcoming per-connection
 * DriveSession layer will open its own file handles against.
 *
 * Each entry carries a monotonic `epoch` that bumps on every (re)mount or
 * read-only change for that drive, so a live session can detect that the base
 * image under it changed and re-open / invalidate its cache.
 */

export interface MountEntry {
  /** Absolute path of the mounted master image (what a session opens). */
  filename: string;
  readonly: boolean;
  /** Monotonic version, bumped on every change to this drive's mount. */
  epoch: number;
}

export class MountRegistry {
  private mounts = new Map<number, MountEntry>();
  private epochCounter = 0;

  /** Record (or replace) the mount on a drive. Bumps the drive's epoch. */
  set(drive: number, filename: string, readonly: boolean): void {
    this.mounts.set(drive, { filename, readonly, epoch: ++this.epochCounter });
  }

  /** Update the read-only flag of an existing mount. No-op if not mounted. */
  setReadonly(drive: number, readonly: boolean): void {
    const cur = this.mounts.get(drive);
    if (!cur || cur.readonly === readonly) return;
    this.mounts.set(drive, { ...cur, readonly, epoch: ++this.epochCounter });
  }

  /** Remove a drive's mount. */
  clear(drive: number): void {
    this.mounts.delete(drive);
  }

  get(drive: number): MountEntry | null {
    return this.mounts.get(drive) ?? null;
  }

  isMounted(drive: number): boolean {
    return this.mounts.has(drive);
  }

  /** Snapshot copy of the whole table. */
  all(): Map<number, MountEntry> {
    return new Map(this.mounts);
  }
}

let mountRegistryInstance: MountRegistry | null = null;

export function getMountRegistry(): MountRegistry {
  if (!mountRegistryInstance) {
    mountRegistryInstance = new MountRegistry();
  }
  return mountRegistryInstance;
}
