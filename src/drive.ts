/**
 * Drive Management Module
 * Handles disk image file operations and drive state management
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import {
  MAX_DRIVES,
  MAX_TRACK_LEN,
  DriveState,
  FdcError,
} from './protocol';
import { getGpioLedController } from './gpio';

/**
 * Drive Manager - Handles all disk image operations
 */
export class DriveManager {
  private drives: Map<number, DriveState>;
  private fileHandles: Map<number, fs.FileHandle>;
  private trackBuffer: Buffer;
  public fdcErrno: FdcError;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY_MS = 100;
  private debug: boolean = false;

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
    const mode = driveState.readonly
      ? fsSync.constants.O_RDONLY
      : fsSync.constants.O_RDWR;

    if (this.debug) {
      console.log(`[DEBUG] DriveManager.mountDrive: drive=${drive}, filename=${filename}, readonly=${driveState.readonly}, mode=${mode === fsSync.constants.O_RDONLY ? 'O_RDONLY' : 'O_RDWR'}`);
    }

    try {
      // Check if file exists
      await fs.access(filename, fsSync.constants.F_OK);

      // Open file handle
      const fileHandle = await fs.open(filename, mode);

      // Update drive state
      driveState.filename = filename;
      driveState.fd = fileHandle.fd;
      driveState.mounted = true;
      driveState.track = 0;
      driveState.hdld = false;

      this.fileHandles.set(drive, fileHandle);

      // Log successful mount with mode
      console.log(`Mounted drive ${drive}: ${filename}, mode=${driveState.readonly ? 'RO' : 'RW'}, fd=${fileHandle.fd}`);

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

    // Reset drive state
    driveState.fd = null;
    driveState.filename = null;
    driveState.mounted = false;
    driveState.track = 0;
    driveState.hdld = false;

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

    // Reopen with correct mode
    const mode = readonly
      ? fsSync.constants.O_RDONLY
      : fsSync.constants.O_RDWR;

    try {
      const newHandle = await fs.open(filename, mode);
      driveState.fd = newHandle.fd;
      this.fileHandles.set(drive, newHandle);
      console.log(`Successfully remounted drive ${drive}, fd=${newHandle.fd}, mode=${readonly ? 'RO' : 'RW'}`);
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

    if (driveState.readonly) {
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
   * Check if a drive is read-only
   */
  isReadOnly(drive: number): boolean {
    if (drive >= MAX_DRIVES) {
      return false;
    }
    return this.drives.get(drive)?.readonly || false;
  }

  /**
   * Check if a drive can accept write operations
   * Returns false if drive is not mounted, readonly, or file handle is invalid
   */
  async canWrite(drive: number): Promise<boolean> {
    if (drive >= MAX_DRIVES) {
      return false;
    }

    const driveState = this.drives.get(drive);
    const fileHandle = this.fileHandles.get(drive);

    if (!driveState || !driveState.mounted || !fileHandle) {
      return false;
    }

    if (driveState.readonly) {
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
