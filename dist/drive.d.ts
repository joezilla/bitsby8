/**
 * Drive Management Module
 * Handles disk image file operations and drive state management
 */
import { DriveState, FdcError } from './protocol';
/**
 * Drive Manager - Handles all disk image operations
 */
export declare class DriveManager {
    private drives;
    private fileHandles;
    private trackBuffer;
    fdcErrno: FdcError;
    constructor();
    /**
     * Get drive state
     */
    getDriveState(drive: number): DriveState | null;
    /**
     * Get all drive states
     */
    getAllDriveStates(): Map<number, DriveState>;
    /**
     * Mount a disk image file to a drive
     */
    mountDrive(drive: number, filename: string): Promise<number>;
    /**
     * Unmount a drive
     */
    unmountDrive(drive: number): Promise<void>;
    /**
     * Unmount all drives
     */
    unmountAll(): Promise<void>;
    /**
     * Set write protection on a drive
     */
    writeProtect(drive: number, flag: boolean): void;
    /**
     * Read a track from a disk image
     */
    readTrack(drive: number, track: number, length: number): Promise<Buffer>;
    /**
     * Write a track to a disk image
     */
    writeTrack(drive: number, track: number, length: number, buffer: Buffer): Promise<number>;
    /**
     * Get the track buffer (for compatibility)
     */
    getTrackBuffer(): Buffer;
    /**
     * Check if a drive is mounted
     */
    isMounted(drive: number): boolean;
    /**
     * Check if a drive is read-only
     */
    isReadOnly(drive: number): boolean;
}
export declare function getDriveManager(): DriveManager;
//# sourceMappingURL=drive.d.ts.map