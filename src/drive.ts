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
      });
    }
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

      // Update GPIO LEDs
      getGpioLedController().updateDriveStatus(drive, driveState);

      return fileHandle.fd;
    } catch (error) {
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
   * Set write protection on a drive
   */
  writeProtect(drive: number, flag: boolean): void {
    if (drive >= MAX_DRIVES) {
      throw new Error(`Invalid drive number: ${drive}`);
    }

    const driveState = this.drives.get(drive)!;
    driveState.readonly = flag;

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

    // Calculate offset
    const offset = track * length;

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

      this.fdcErrno = FdcError.OK;
      return buffer;
    } catch (error) {
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

    if (driveState.readonly) {
      this.fdcErrno = FdcError.WRITE_ERR;
      throw new Error(`Drive ${drive} is read-only`);
    }

    // Calculate offset
    const offset = track * length;

    // Update drive state
    driveState.track = track;
    driveState.hdld = true;

    try {
      // Write track data
      const { bytesWritten } = await fileHandle.write(buffer, 0, length, offset);

      if (bytesWritten !== length) {
        this.fdcErrno = FdcError.WRITE_ERR;
        throw new Error(
          `Wrote ${bytesWritten} bytes, expected ${length}`
        );
      }

      // Sync to disk for data integrity
      await fileHandle.sync();

      this.fdcErrno = FdcError.OK;
      return bytesWritten;
    } catch (error) {
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
