"use strict";
/**
 * Drive Management Module
 * Handles disk image file operations and drive state management
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DriveManager = void 0;
exports.getDriveManager = getDriveManager;
const fs = __importStar(require("fs/promises"));
const fsSync = __importStar(require("fs"));
const protocol_1 = require("./protocol");
/**
 * Drive Manager - Handles all disk image operations
 */
class DriveManager {
    drives;
    fileHandles;
    trackBuffer;
    fdcErrno;
    constructor() {
        this.drives = new Map();
        this.fileHandles = new Map();
        this.trackBuffer = Buffer.alloc(protocol_1.MAX_TRACK_LEN);
        this.fdcErrno = protocol_1.FdcError.OK;
        // Initialize all drives as unmounted
        for (let i = 0; i < protocol_1.MAX_DRIVES; i++) {
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
    getDriveState(drive) {
        if (drive >= protocol_1.MAX_DRIVES) {
            return null;
        }
        return this.drives.get(drive) || null;
    }
    /**
     * Get all drive states
     */
    getAllDriveStates() {
        return new Map(this.drives);
    }
    /**
     * Mount a disk image file to a drive
     */
    async mountDrive(drive, filename) {
        if (drive >= protocol_1.MAX_DRIVES) {
            throw new Error(`Invalid drive number: ${drive}`);
        }
        const driveState = this.drives.get(drive);
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
            return fileHandle.fd;
        }
        catch (error) {
            driveState.mounted = false;
            driveState.filename = '--ERROR--';
            throw error;
        }
    }
    /**
     * Unmount a drive
     */
    async unmountDrive(drive) {
        if (drive >= protocol_1.MAX_DRIVES) {
            throw new Error(`Invalid drive number: ${drive}`);
        }
        const driveState = this.drives.get(drive);
        const fileHandle = this.fileHandles.get(drive);
        if (driveState.mounted && fileHandle) {
            await fileHandle.close();
            this.fileHandles.delete(drive);
        }
        // Reset drive state
        driveState.fd = null;
        driveState.filename = null;
        driveState.mounted = false;
        driveState.track = 0;
        driveState.hdld = false;
    }
    /**
     * Unmount all drives
     */
    async unmountAll() {
        const unmountPromises = [];
        for (let drive = 0; drive < protocol_1.MAX_DRIVES; drive++) {
            if (this.drives.get(drive)?.mounted) {
                unmountPromises.push(this.unmountDrive(drive));
            }
        }
        await Promise.all(unmountPromises);
    }
    /**
     * Set write protection on a drive
     */
    writeProtect(drive, flag) {
        if (drive >= protocol_1.MAX_DRIVES) {
            throw new Error(`Invalid drive number: ${drive}`);
        }
        const driveState = this.drives.get(drive);
        driveState.readonly = flag;
    }
    /**
     * Read a track from a disk image
     */
    async readTrack(drive, track, length) {
        if (drive >= protocol_1.MAX_DRIVES) {
            this.fdcErrno = protocol_1.FdcError.NOT_READY;
            throw new Error(`Invalid drive number: ${drive}`);
        }
        const driveState = this.drives.get(drive);
        const fileHandle = this.fileHandles.get(drive);
        if (!driveState.mounted || !fileHandle) {
            this.fdcErrno = protocol_1.FdcError.NOT_READY;
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
                throw new Error(`Read ${bytesRead} bytes, expected ${length}`);
            }
            this.fdcErrno = protocol_1.FdcError.OK;
            return buffer;
        }
        catch (error) {
            this.fdcErrno = protocol_1.FdcError.NOT_READY;
            throw error;
        }
    }
    /**
     * Write a track to a disk image
     */
    async writeTrack(drive, track, length, buffer) {
        if (drive >= protocol_1.MAX_DRIVES) {
            this.fdcErrno = protocol_1.FdcError.NOT_READY;
            throw new Error(`Invalid drive number: ${drive}`);
        }
        const driveState = this.drives.get(drive);
        const fileHandle = this.fileHandles.get(drive);
        if (!driveState.mounted || !fileHandle) {
            this.fdcErrno = protocol_1.FdcError.NOT_READY;
            throw new Error(`Drive ${drive} not mounted`);
        }
        if (driveState.readonly) {
            this.fdcErrno = protocol_1.FdcError.WRITE_ERR;
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
                this.fdcErrno = protocol_1.FdcError.WRITE_ERR;
                throw new Error(`Wrote ${bytesWritten} bytes, expected ${length}`);
            }
            // Sync to disk for data integrity
            await fileHandle.sync();
            this.fdcErrno = protocol_1.FdcError.OK;
            return bytesWritten;
        }
        catch (error) {
            this.fdcErrno = protocol_1.FdcError.WRITE_ERR;
            throw error;
        }
    }
    /**
     * Get the track buffer (for compatibility)
     */
    getTrackBuffer() {
        return this.trackBuffer;
    }
    /**
     * Check if a drive is mounted
     */
    isMounted(drive) {
        if (drive >= protocol_1.MAX_DRIVES) {
            return false;
        }
        return this.drives.get(drive)?.mounted || false;
    }
    /**
     * Check if a drive is read-only
     */
    isReadOnly(drive) {
        if (drive >= protocol_1.MAX_DRIVES) {
            return false;
        }
        return this.drives.get(drive)?.readonly || false;
    }
}
exports.DriveManager = DriveManager;
/**
 * Global drive manager instance (singleton)
 */
let driveManagerInstance = null;
function getDriveManager() {
    if (!driveManagerInstance) {
        driveManagerInstance = new DriveManager();
    }
    return driveManagerInstance;
}
//# sourceMappingURL=drive.js.map