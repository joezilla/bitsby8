/**
 * DriveSession — a per-connection, copy-on-write view of the operator-mounted
 * disks, used for NON-master clients when multi-client serving is enabled.
 *
 * Each session reads the shared master image (opened read-only) and, on the
 * first write to a drive, forks a private "splinter" copy and redirects all
 * further I/O for that drive to it. The master stays pristine and other
 * clients are unaffected. The master-write client keeps using the shared
 * DriveManager (base writes), so this class never writes a base image.
 *
 * Splinters here are ephemeral (under .transient, swept on restart);
 * persistent per-client splinters land in a later increment (#19).
 *
 * Mount facts come from the shared MountRegistry; `sync()` reconciles this
 * session's open handles with it (open new mounts, drop removed ones, reopen +
 * open a swap window when a drive's base changed).
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { MAX_DRIVES, MAX_TRACK_LEN, DriveState, FdcError } from './protocol';
import { MountRegistry } from './mount-registry';
import { TRANSIENT_DIRNAME } from './drive';
import { IDriveEngine } from './drive-engine';

// Matches DriveManager.SWAP_INVALIDATE_WINDOW_MS — the not-ready span that
// forces the FDC master to discard its cached track buffer after a base swap.
const SWAP_INVALIDATE_WINDOW_MS = 2500;

interface SessionDrive {
  state: DriveState;      // the mutable object handed to the command loop
  handle: fs.FileHandle;  // open handle (master RO, or splinter RW once forked)
  master: string;         // master image path this drive forked from
  baseEpoch: number;      // MountRegistry epoch this was opened against
}

export interface DriveSessionOptions {
  clientId: string;
  registry: MountRegistry;
}

export class DriveSession implements IDriveEngine {
  public fdcErrno: FdcError = FdcError.OK;
  private readonly clientId: string;
  private readonly registry: MountRegistry;
  private drives = new Map<number, SessionDrive>();

  constructor(opts: DriveSessionOptions) {
    this.clientId = opts.clientId;
    this.registry = opts.registry;
  }

  /**
   * Reconcile this session's open drives with the shared mount registry.
   * Called at connect and whenever the operator changes mounts.
   */
  async sync(): Promise<void> {
    for (let drive = 0; drive < MAX_DRIVES; drive++) {
      const entry = this.registry.get(drive);
      const cur = this.drives.get(drive);

      if (!entry) {
        if (cur) {
          await this.closeDrive(drive);
        }
        continue;
      }

      if (cur && cur.baseEpoch === entry.epoch) {
        continue; // unchanged
      }

      // New mount or the base changed under us — (re)open the master RO and
      // open a swap window so the FDC master invalidates its cached track.
      const wasMounted = !!cur;
      if (cur) {
        await this.closeDrive(drive);
      }
      try {
        const handle = await fs.open(entry.filename, fsSync.constants.O_RDONLY);
        const state: DriveState = {
          fd: handle.fd,
          filename: entry.filename,
          mounted: true,
          readonly: false,     // writes are allowed — they land on a splinter
          hdld: false,
          track: 0,
          lastIo: null,
          unavailableUntil: wasMounted ? Date.now() + SWAP_INVALIDATE_WINDOW_MS : null,
          transient: true,     // this session is copy-on-write over the master
          scratchPath: null,
          dirty: false,
        };
        this.drives.set(drive, { state, handle, master: entry.filename, baseEpoch: entry.epoch });
      } catch (error) {
        console.error(`[DriveSession ${this.clientId}] failed to open drive ${drive} (${entry.filename}):`, error);
        this.drives.delete(drive);
      }
    }
  }

  getDriveState(drive: number): DriveState | null {
    return this.drives.get(drive)?.state ?? null;
  }

  isMounted(drive: number): boolean {
    return this.drives.get(drive)?.state.mounted ?? false;
  }

  isInSwapWindow(drive: number): boolean {
    const until = this.drives.get(drive)?.state.unavailableUntil ?? null;
    return until !== null && Date.now() < until;
  }

  async canWrite(drive: number): Promise<boolean> {
    // A non-master session can always write a mounted drive — the write lands
    // on its private splinter, never the master.
    const sd = this.drives.get(drive);
    return !!sd && sd.state.mounted && !this.isInSwapWindow(drive);
  }

  async readTrack(drive: number, track: number, length: number): Promise<Buffer> {
    const sd = this.drives.get(drive);
    if (!sd || !sd.state.mounted) {
      this.fdcErrno = FdcError.NOT_READY;
      throw new Error(`Drive ${drive} not mounted`);
    }
    if (length <= 0 || length > MAX_TRACK_LEN) {
      this.fdcErrno = FdcError.NOT_READY;
      throw new Error(`Invalid track length: ${length}`);
    }
    const buffer = Buffer.alloc(length);
    await sd.handle.read(buffer, 0, length, track * length);
    sd.state.track = track;
    sd.state.lastIo = Date.now();
    this.fdcErrno = FdcError.OK;
    return buffer;
  }

  async writeTrack(drive: number, track: number, length: number, buffer: Buffer): Promise<number> {
    const sd = this.drives.get(drive);
    if (!sd || !sd.state.mounted) {
      this.fdcErrno = FdcError.NOT_READY;
      throw new Error(`Drive ${drive} not mounted`);
    }
    if (length <= 0 || length > MAX_TRACK_LEN || buffer.length < length) {
      this.fdcErrno = FdcError.WRITE_ERR;
      throw new Error(`Invalid track length: ${length}`);
    }
    // Copy-on-write: fork the splinter on the first write, then redirect I/O.
    if (!sd.state.scratchPath) {
      await this.forkSplinter(drive, sd);
    }
    const result = await sd.handle.write(buffer, 0, length, track * length);
    await sd.handle.sync();
    sd.state.track = track;
    sd.state.lastIo = Date.now();
    sd.state.dirty = true;
    this.fdcErrno = FdcError.OK;
    return result.bytesWritten;
  }

  /** Copy the master to a private splinter and reopen it read-write. */
  private async forkSplinter(drive: number, sd: SessionDrive): Promise<void> {
    const dir = path.join(path.dirname(sd.master), TRANSIENT_DIRNAME);
    await fs.mkdir(dir, { recursive: true });
    const safeId = this.clientId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const splinter = path.join(dir, `session-${safeId}-drive${drive}-${randomBytes(6).toString('hex')}.scratch`);
    await fs.copyFile(sd.master, splinter);

    await sd.handle.close().catch(() => { /* best-effort */ });
    const handle = await fs.open(splinter, fsSync.constants.O_RDWR);
    sd.handle = handle;
    sd.state.fd = handle.fd;
    sd.state.scratchPath = splinter;
  }

  private async closeDrive(drive: number): Promise<void> {
    const sd = this.drives.get(drive);
    if (!sd) return;
    await sd.handle.close().catch(() => { /* best-effort */ });
    if (sd.state.scratchPath) {
      await fs.unlink(sd.state.scratchPath).catch(() => { /* best-effort */ });
    }
    this.drives.delete(drive);
  }

  /** Path of a drive's splinter, or null if it hasn't forked yet. */
  getScratchPath(drive: number): string | null {
    return this.drives.get(drive)?.state.scratchPath ?? null;
  }

  /** Close all handles and discard all splinters. Call on disconnect. */
  async dispose(): Promise<void> {
    for (const drive of Array.from(this.drives.keys())) {
      await this.closeDrive(drive);
    }
  }
}
