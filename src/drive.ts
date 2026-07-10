/**
 * Drive Management Module
 * Handles disk image file operations and drive state management
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import {
  MAX_DRIVES,
  MAX_TRACK_LEN,
  DriveState,
  FdcError,
} from './protocol';
import { getGpioLedController } from './gpio';
import { MountRegistry } from './mount-registry';
import { IDriveEngine } from './drive-engine';

/**
 * Resolves whether a read-only image should be backed by a copy-on-write
 * transient scratch (true) or hard-fail writes (false). Injected at startup;
 * the default keeps the historical "read-only means writes error" behavior.
 */
export type TransientPolicyResolver = (masterFilename: string) => boolean | Promise<boolean>;

/** Subdirectory (under the image's own directory) that holds scratch copies. */
export const TRANSIENT_DIRNAME = '.transient';

/**
 * Drive Manager - Handles all disk image operations
 */
export class DriveManager implements IDriveEngine {
  private drives: Map<number, DriveState>;
  private fileHandles: Map<number, fs.FileHandle>;
  private trackBuffer: Buffer;
  public fdcErrno: FdcError;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY_MS = 100;
  // ≥2 s per FDC+ firmware analysis (covers minidisk 1.6 s motor timeout and
  // 8" 1.3 s idle-invalidation); 500 ms cushion for STAT poll jitter.
  private readonly SWAP_INVALIDATE_WINDOW_MS = 2500;
  private debug: boolean = false;
  // Default: never use transient backing (writes to RO images error). Startup
  // injects a resolver that consults the global + per-image policy.
  private transientPolicyResolver: TransientPolicyResolver = () => false;
  // Authoritative operator mount table. When set, this manager keeps it in
  // lockstep as it mounts/unmounts/write-protects drives (it is the sole
  // writer). Consumed by the per-connection drive layer.
  private mountRegistry: MountRegistry | null = null;

  constructor() {
    this.drives = new Map();
    this.fileHandles = new Map();
    this.trackBuffer = Buffer.alloc(MAX_TRACK_LEN);
    this.fdcErrno = FdcError.OK;

    // Initialize all drives as unmounted
    for (let i = 0; i < MAX_DRIVES; i++) {
      this.drives.set(i, {
        fd: null,
        filename: null,
        mounted: false,
        readonly: false,
        hdld: false,
        track: 0,
        lastIo: null,
        unavailableUntil: null,
        transient: false,
        scratchPath: null,
        dirty: false,
      });
    }
  }

  /**
   * Enable or disable debug logging
   */
  setDebug(enabled: boolean): void {
    this.debug = enabled;
    if (this.debug) {
      console.log('[DEBUG] DriveManager debug logging enabled');
    }
  }

  /**
   * Inject the resolver that decides, per read-only image, whether writes are
   * redirected to a transient copy-on-write scratch. Called once at startup.
   */
  setTransientPolicyResolver(resolver: TransientPolicyResolver): void {
    this.transientPolicyResolver = resolver;
  }

  /**
   * Attach the shared operator mount registry. Once set, mount/unmount/
   * writeProtect keep it in sync as the authoritative mount table.
   */
  setMountRegistry(registry: MountRegistry): void {
    this.mountRegistry = registry;
  }

  /**
   * Whether the given read-only master image should be backed by a transient
   * scratch. Only consulted when the drive is read-only.
   */
  private async shouldUseTransient(master: string): Promise<boolean> {
    try {
      return await this.transientPolicyResolver(path.basename(master));
    } catch (error) {
      console.error('Transient policy resolver failed; treating as error policy:', error);
      return false;
    }
  }

  /**
   * Create a throwaway copy of `master` for copy-on-write backing and return
   * its path. Lives under {master dir}/.transient so the non-recursive image
   * listing never surfaces it.
   */
  private async createScratch(drive: number, master: string): Promise<string> {
    const dir = path.join(path.dirname(master), TRANSIENT_DIRNAME);
    await fs.mkdir(dir, { recursive: true });
    const scratch = path.join(dir, `drive${drive}-${randomBytes(6).toString('hex')}.scratch`);
    await fs.copyFile(master, scratch);
    return scratch;
  }

  /**
   * Delete the drive's scratch file (if any) and clear its transient state.
   */
  private async discardScratch(driveState: DriveState): Promise<void> {
    if (driveState.scratchPath) {
      await fs.unlink(driveState.scratchPath).catch(() => { /* best-effort */ });
    }
    driveState.scratchPath = null;
    driveState.transient = false;
    driveState.dirty = false;
  }

  /**
   * Sleep for a specified duration
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check if an error is transient and retryable
   */
  private isTransientError(error: any): boolean {
    const code = error?.code;
    // Retry on common transient file system errors
    return code === 'EAGAIN' || code === 'EBUSY' || code === 'EINTR' || code === 'EIO';
  }

  /**
   * Get drive state
   */
  getDriveState(drive: number): DriveState | null {
    if (drive >= MAX_DRIVES) {
      return null;
    }
    return this.drives.get(drive) || null;
  }

  /**
   * Get all drive states
   */
  getAllDriveStates(): Map<number, DriveState> {
    return new Map(this.drives);
  }

  /**
   * Mount a disk image file to a drive
   */
  async mountDrive(drive: number, filename: string): Promise<number> {
    if (drive >= MAX_DRIVES) {
      throw new Error(`Invalid drive number: ${drive}`);
    }

    const driveState = this.drives.get(drive)!;

    if (this.debug) {
      console.log(`[DEBUG] DriveManager.mountDrive: drive=${drive}, filename=${filename}, readonly=${driveState.readonly}`);
    }

    const now = Date.now();
    const wasMounted = driveState.mounted;
    const stillInPriorWindow =
      driveState.unavailableUntil !== null && now < driveState.unavailableUntil;

    // If a handle is already open (bare mountDrive over an already-mounted slot),
    // close it now so we don't leak the fd when we open the replacement below.
    const existingHandle = this.fileHandles.get(drive);
    if (existingHandle) {
      try {
        await existingHandle.close();
      } catch (error) {
        console.error(`Error closing previous file handle for drive ${drive}:`, error);
      }
      this.fileHandles.delete(drive);
      driveState.fd = null;
    }
    // Drop any scratch left by the outgoing mount before we re-decide backing.
    await this.discardScratch(driveState);

    // Open the not-ready window BEFORE opening the new handle: any READ that
    // races through between fs.open and the next STAT must see NOT_READY.
    if (wasMounted || stillInPriorWindow) {
      driveState.unavailableUntil = now + this.SWAP_INVALIDATE_WINDOW_MS;
      if (this.debug) {
        console.log(`[DEBUG] DriveManager.mountDrive: swap window opened, unavailableUntil=${driveState.unavailableUntil} (${this.SWAP_INVALIDATE_WINDOW_MS} ms)`);
      }
    }

    try {
      // Check if file exists
      await fs.access(filename, fsSync.constants.F_OK);

      // A read-only image whose policy is 'transient' is backed by a writable
      // scratch copy: the guest can write, but the master stays pristine. We
      // keep driveState.filename pointing at the master so mounted-checks
      // (delete/format/rollback guards) still see the master as in use.
      const useTransient = driveState.readonly && (await this.shouldUseTransient(filename));
      const openPath = useTransient ? await this.createScratch(drive, filename) : filename;
      const mode = (useTransient || !driveState.readonly)
        ? fsSync.constants.O_RDWR
        : fsSync.constants.O_RDONLY;

      // Open file handle
      const fileHandle = await fs.open(openPath, mode);

      // Update drive state
      driveState.filename = filename;
      driveState.fd = fileHandle.fd;
      driveState.mounted = true;
      driveState.track = 0;
      driveState.hdld = false;
      driveState.transient = useTransient;
      driveState.scratchPath = useTransient ? openPath : null;
      driveState.dirty = false;

      this.fileHandles.set(drive, fileHandle);

      // Keep the operator mount registry in sync (authoritative mount table).
      this.mountRegistry?.set(drive, filename, driveState.readonly);

      // Log successful mount with mode
      console.log(`Mounted drive ${drive}: ${filename}, mode=${driveState.readonly ? (useTransient ? 'RO+transient' : 'RO') : 'RW'}, fd=${fileHandle.fd}`);

      if (this.debug) {
        console.log(`[DEBUG] DriveManager.mountDrive SUCCESS: drive=${drive}, fd=${fileHandle.fd}, filesize=${(await fileHandle.stat()).size} bytes`);
      }

      // Update GPIO LEDs
      getGpioLedController().updateDriveStatus(drive, driveState);

      return fileHandle.fd;
    } catch (error) {
      console.error(`Failed to mount drive ${drive} (${filename}):`, error);
      if (this.debug) {
        console.log(`[DEBUG] DriveManager.mountDrive FAILED: drive=${drive}, error=${(error as Error).message}`);
      }
      driveState.mounted = false;
      driveState.filename = '--ERROR--';
      // A scratch created just before a failed open would otherwise leak until
      // the next startup sweep — drop it now.
      await this.discardScratch(driveState);
      throw error;
    }
  }

  /**
   * Unmount a drive
   */
  async unmountDrive(drive: number): Promise<void> {
    if (drive >= MAX_DRIVES) {
      throw new Error(`Invalid drive number: ${drive}`);
    }

    const driveState = this.drives.get(drive)!;
    const fileHandle = this.fileHandles.get(drive);
    const wasMounted = driveState.mounted;

    if (driveState.mounted && fileHandle) {
      try {
        await fileHandle.close();
        this.fileHandles.delete(drive);
      } catch (error) {
        console.error(`Error closing file handle for drive ${drive}:`, error);
        // Still delete from map to prevent leaks
        this.fileHandles.delete(drive);
        throw error;
      }
    }

    // Discard any transient scratch. Callers wanting to keep the changes must
    // commit or save-as-snapshot BEFORE unmounting.
    await this.discardScratch(driveState);

    // Keep the operator mount registry in sync.
    this.mountRegistry?.clear(drive);

    // Reset drive state
    driveState.fd = null;
    driveState.filename = null;
    driveState.mounted = false;
    driveState.track = 0;
    driveState.hdld = false;

    // Stamp the swap window so a remount within ~2.5 s still gives the FDC+
    // a full not-ready span from the moment this drive first went away.
    if (wasMounted) {
      driveState.unavailableUntil =
        Date.now() + this.SWAP_INVALIDATE_WINDOW_MS;
    }

    // Update GPIO LEDs
    getGpioLedController().updateDriveStatus(drive, driveState);
  }

  /**
   * Unmount all drives
   */
  async unmountAll(): Promise<void> {
    const unmountPromises: Promise<void>[] = [];
    const errors: Error[] = [];

    for (let drive = 0; drive < MAX_DRIVES; drive++) {
      if (this.drives.get(drive)?.mounted) {
        unmountPromises.push(
          this.unmountDrive(drive).catch((error) => {
            errors.push(error);
            console.error(`Failed to unmount drive ${drive}:`, error);
          })
        );
      }
    }

    await Promise.all(unmountPromises);

    if (errors.length > 0) {
      throw new Error(`Failed to unmount ${errors.length} drive(s)`);
    }
  }

  /**
   * Explicit cleanup method - ensures all resources are released
   * Call this before the DriveManager is destroyed
   */
  async cleanup(): Promise<void> {
    await this.unmountAll();
  }

  /**
   * Remount a drive with the correct file mode (read-only or read-write)
   * This is necessary when the readonly flag changes after mount
   */
  private async remountWithMode(drive: number, readonly: boolean): Promise<void> {
    const driveState = this.drives.get(drive)!;
    const filename = driveState.filename;

    if (!filename || !driveState.mounted) {
      return; // Nothing to remount
    }

    console.log(`Remounting drive ${drive} with mode ${readonly ? 'RO' : 'RW'} (file: ${filename})`);

    // Close current handle
    const fileHandle = this.fileHandles.get(drive);
    if (fileHandle) {
      try {
        await fileHandle.close();
      } catch (error) {
        console.error(`Error closing file handle during remount for drive ${drive}:`, error);
        // Continue with remount anyway
      }
      this.fileHandles.delete(drive);
    }

    // Re-decide transient backing from scratch: toggling to RO under a
    // 'transient' policy creates a scratch; toggling back to RW drops it and
    // reopens the master directly.
    await this.discardScratch(driveState);
    const useTransient = readonly && (await this.shouldUseTransient(filename));
    const openPath = useTransient ? await this.createScratch(drive, filename) : filename;
    const mode = (useTransient || !readonly)
      ? fsSync.constants.O_RDWR
      : fsSync.constants.O_RDONLY;

    try {
      const newHandle = await fs.open(openPath, mode);
      driveState.fd = newHandle.fd;
      driveState.transient = useTransient;
      driveState.scratchPath = useTransient ? openPath : null;
      driveState.dirty = false;
      this.fileHandles.set(drive, newHandle);
      console.log(`Successfully remounted drive ${drive}, fd=${newHandle.fd}, mode=${readonly ? (useTransient ? 'RO+transient' : 'RO') : 'RW'}`);
    } catch (error) {
      console.error(`Failed to remount drive ${drive}:`, error);
      // Mark drive as unmounted on remount failure
      driveState.mounted = false;
      driveState.fd = null;
      throw error;
    }
  }

  /**
   * Set write protection on a drive
   * If the drive is mounted, this will remount it with the correct file mode
   */
  async writeProtect(drive: number, flag: boolean): Promise<void> {
    if (drive >= MAX_DRIVES) {
      throw new Error(`Invalid drive number: ${drive}`);
    }

    const driveState = this.drives.get(drive)!;
    const oldFlag = driveState.readonly;

    console.log(`WriteProtect drive ${drive}: ${flag ? 'RO' : 'RW'}, mounted=${driveState.mounted}, changing=${oldFlag !== flag}`);

    // Update flag
    driveState.readonly = flag;

    // If mounted and flag changed, remount with correct mode to prevent EBADF errors
    if (driveState.mounted && oldFlag !== flag) {
      await this.remountWithMode(drive, flag);
    }

    // Keep the operator mount registry's read-only flag in sync.
    if (driveState.mounted) {
      this.mountRegistry?.setReadonly(drive, flag);
    }

    // Update GPIO LEDs
    getGpioLedController().updateDriveStatus(drive, driveState);
  }

  /**
   * Read a track from a disk image
   */
  async readTrack(
    drive: number,
    track: number,
    length: number
  ): Promise<Buffer> {
    if (drive >= MAX_DRIVES) {
      this.fdcErrno = FdcError.NOT_READY;
      throw new Error(`Invalid drive number: ${drive}`);
    }

    if (this.isInSwapWindow(drive)) {
      this.fdcErrno = FdcError.NOT_READY;
      throw new Error(`Drive ${drive} unavailable (swap window active)`);
    }

    const driveState = this.drives.get(drive)!;
    const fileHandle = this.fileHandles.get(drive);

    if (!driveState.mounted || !fileHandle) {
      this.fdcErrno = FdcError.NOT_READY;
      throw new Error(`Drive ${drive} not mounted`);
    }

    // Validate file handle is still open
    if (fileHandle.fd === undefined || fileHandle.fd < 0) {
      this.fdcErrno = FdcError.NOT_READY;
      throw new Error(`Drive ${drive} file handle is invalid (fd=${fileHandle.fd})`);
    }

    // Calculate offset
    const offset = track * length;

    if (this.debug) {
      console.log(`[DEBUG] DriveManager.readTrack: drive=${drive}, track=${track}, length=${length}, offset=${offset}, fd=${fileHandle.fd}, filename=${driveState.filename}`);
    }

    // Update drive state
    driveState.track = track;
    driveState.hdld = true;

    try {
      // Read track data
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await fileHandle.read(buffer, 0, length, offset);

      if (bytesRead !== length) {
        throw new Error(
          `Read ${bytesRead} bytes, expected ${length}`
        );
      }

      if (this.debug) {
        console.log(`[DEBUG] DriveManager.readTrack SUCCESS: drive=${drive}, track=${track}, bytesRead=${bytesRead}`);
      }

      driveState.lastIo = Date.now();
      this.fdcErrno = FdcError.OK;
      return buffer;
    } catch (error) {
      const errDetails = error instanceof Error
        ? { message: error.message, code: (error as any).code, stack: error.stack }
        : error;
      console.error(`Failed to read track - Drive ${drive}, Track ${track}, Length ${length}:`, errDetails);
      this.fdcErrno = FdcError.NOT_READY;
      throw error;
    }
  }

  /**
   * Write a track to a disk image
   */
  async writeTrack(
    drive: number,
    track: number,
    length: number,
    buffer: Buffer
  ): Promise<number> {
    if (drive >= MAX_DRIVES) {
      this.fdcErrno = FdcError.NOT_READY;
      throw new Error(`Invalid drive number: ${drive}`);
    }

    if (this.isInSwapWindow(drive)) {
      this.fdcErrno = FdcError.NOT_READY;
      throw new Error(`Drive ${drive} unavailable (swap window active)`);
    }

    const driveState = this.drives.get(drive)!;
    const fileHandle = this.fileHandles.get(drive);

    if (!driveState.mounted || !fileHandle) {
      this.fdcErrno = FdcError.NOT_READY;
      throw new Error(`Drive ${drive} not mounted`);
    }

    // Validate file handle is still open
    if (fileHandle.fd === undefined || fileHandle.fd < 0) {
      this.fdcErrno = FdcError.NOT_READY;
      throw new Error(`Drive ${drive} file handle is invalid (fd=${fileHandle.fd})`);
    }

    // A transient-backed drive is nominally read-only but writes are allowed —
    // they land on the scratch copy, not the master.
    if (driveState.readonly && !driveState.transient) {
      this.fdcErrno = FdcError.WRITE_ERR;
      throw new Error(`Drive ${drive} is read-only`);
    }

    // Validate file handle is writable (test actual file mode, not just flag)
    // This catches cases where file was opened RO but readonly flag was changed
    try {
      await fileHandle.datasync();
    } catch (error: any) {
      if (error.code === 'EBADF' || error.code === 'EACCES') {
        this.fdcErrno = FdcError.WRITE_ERR;
        console.error(`Drive ${drive} file handle not writable (fd=${fileHandle.fd}, error=${error.code})`);
        throw new Error(`Drive ${drive} file not open for writing (fd=${fileHandle.fd})`);
      }
      // Other errors will be caught in the write attempt below
    }

    // Validate parameters
    if (length <= 0 || length > MAX_TRACK_LEN) {
      this.fdcErrno = FdcError.WRITE_ERR;
      throw new Error(`Invalid track length: ${length} (max: ${MAX_TRACK_LEN})`);
    }

    if (buffer.length < length) {
      this.fdcErrno = FdcError.WRITE_ERR;
      throw new Error(`Buffer too small: ${buffer.length} < ${length}`);
    }

    if (track < 0) {
      this.fdcErrno = FdcError.WRITE_ERR;
      throw new Error(`Invalid track number: ${track}`);
    }

    // Calculate offset
    const offset = track * length;

    if (this.debug) {
      console.log(`[DEBUG] DriveManager.writeTrack: drive=${drive}, track=${track}, length=${length}, offset=${offset}, fd=${fileHandle.fd}, filename=${driveState.filename}, readonly=${driveState.readonly}`);
    }

    // Update drive state
    driveState.track = track;
    driveState.hdld = true;

    try {
      // Log write attempt for debugging
      console.log(`Writing track - Drive ${drive}, Track ${track}, Length ${length}, Offset ${offset}, FD ${fileHandle.fd}, File: ${driveState.filename}`);

      let lastError: any = null;
      let bytesWritten = 0;

      // Retry loop for transient errors
      for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
        try {
          if (this.debug && attempt > 0) {
            console.log(`[DEBUG] DriveManager.writeTrack retry attempt ${attempt + 1}/${this.MAX_RETRIES}`);
          }

          // Write track data
          const result = await fileHandle.write(buffer, 0, length, offset);
          bytesWritten = result.bytesWritten;

          if (bytesWritten !== length) {
            throw new Error(
              `Wrote ${bytesWritten} bytes, expected ${length}`
            );
          }

          // Sync to disk for data integrity
          await fileHandle.sync();

          // Success - exit retry loop
          if (attempt > 0) {
            console.log(`Write succeeded on attempt ${attempt + 1}`);
          }

          if (this.debug) {
            console.log(`[DEBUG] DriveManager.writeTrack SUCCESS: drive=${drive}, track=${track}, bytesWritten=${bytesWritten}, synced to disk`);
          }

          driveState.lastIo = Date.now();
          if (driveState.transient) {
            driveState.dirty = true;
          }
          this.fdcErrno = FdcError.OK;
          return bytesWritten;

        } catch (error) {
          lastError = error;

          // Only retry on transient errors
          if (this.isTransientError(error) && attempt < this.MAX_RETRIES - 1) {
            const delay = this.RETRY_DELAY_MS * Math.pow(2, attempt);
            console.warn(`Write failed (attempt ${attempt + 1}/${this.MAX_RETRIES}), retrying in ${delay}ms:`,
              error instanceof Error ? error.message : error);
            await this.sleep(delay);
          } else {
            // Non-transient error or final attempt - rethrow
            throw error;
          }
        }
      }

      // Should never reach here, but just in case
      throw lastError || new Error('Write failed after retries');
    } catch (error) {
      const errDetails = error instanceof Error
        ? { message: error.message, code: (error as any).code, stack: error.stack }
        : error;
      console.error(`Failed to write track - Drive ${drive}, Track ${track}, Length ${length}:`, errDetails);
      this.fdcErrno = FdcError.WRITE_ERR;
      throw error;
    }
  }

  /**
   * Get the track buffer (for compatibility)
   */
  getTrackBuffer(): Buffer {
    return this.trackBuffer;
  }

  /**
   * Check if a drive is mounted
   */
  isMounted(drive: number): boolean {
    if (drive >= MAX_DRIVES) {
      return false;
    }
    return this.drives.get(drive)?.mounted || false;
  }

  /**
   * True while the drive must be reported not-ready to the FDC+ so its
   * cached trackBuf for the prior image is discarded before serving reads
   * from the newly mounted image.
   */
  isInSwapWindow(drive: number): boolean {
    if (drive >= MAX_DRIVES) {
      return false;
    }
    const until = this.drives.get(drive)?.unavailableUntil;
    return until !== null && until !== undefined && Date.now() < until;
  }

  /**
   * Check if a drive is read-only
   */
  isReadOnly(drive: number): boolean {
    if (drive >= MAX_DRIVES) {
      return false;
    }
    return this.drives.get(drive)?.readonly || false;
  }

  /**
   * Commit a transient drive's scratch back onto its master image, keeping the
   * drive mounted and transient (dirty resets to false). The master is not
   * held open while transient, so overwriting it is safe. Callers must ensure
   * the master isn't mounted read-write on another drive.
   */
  async commitTransient(drive: number): Promise<void> {
    const driveState = this.drives.get(drive);
    if (!driveState || !driveState.transient || !driveState.scratchPath || !driveState.filename) {
      throw new Error(`Drive ${drive} is not transient-backed`);
    }
    const master = driveState.filename;
    const tmp = `${master}.commit.tmp`;
    try {
      await fs.copyFile(driveState.scratchPath, tmp);
      await fs.rename(tmp, master);
    } catch (err) {
      await fs.unlink(tmp).catch(() => { /* best-effort */ });
      throw err;
    }
    driveState.dirty = false;
  }

  /**
   * Check if a drive can accept write operations
   * Returns false if drive is not mounted, readonly, or file handle is invalid
   */
  async canWrite(drive: number): Promise<boolean> {
    if (drive >= MAX_DRIVES) {
      return false;
    }

    if (this.isInSwapWindow(drive)) {
      return false;
    }

    const driveState = this.drives.get(drive);
    const fileHandle = this.fileHandles.get(drive);

    if (!driveState || !driveState.mounted || !fileHandle) {
      return false;
    }

    if (driveState.readonly && !driveState.transient) {
      return false;
    }

    // Test if file handle is actually writable
    try {
      await fileHandle.datasync();
      return true;
    } catch (error: any) {
      if (error.code === 'EBADF' || error.code === 'EACCES') {
        console.warn(`Drive ${drive} file handle not writable (fd=${fileHandle.fd}, error=${error.code})`);
        return false;
      }
      // If it's some other error, assume writable for now
      return true;
    }
  }
}

/**
 * Global drive manager instance (singleton)
 */
let driveManagerInstance: DriveManager | null = null;

export function getDriveManager(): DriveManager {
  if (!driveManagerInstance) {
    driveManagerInstance = new DriveManager();
  }
  return driveManagerInstance;
}
