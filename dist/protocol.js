"use strict";
/**
 * FDC+ Serial Drive Server Protocol Definitions
 * TypeScript port of original C implementation
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TIMEOUT_BUFFER = exports.TIMEOUT_BYTE = exports.TIMEOUT_DEFAULT = exports.ByteUtils = exports.CommandResponseBlock = exports.FdcCommand = exports.FdcError = exports.DEFAULT_BAUD_RATE = exports.BaudRate = exports.MAX_PATH = exports.MAX_DISK_SIZE = exports.MAX_TRACK_LEN = exports.MAX_TRACKS = exports.MAX_DRIVES = exports.FDCSDS_VERSION = exports.FDCSDS_COPYRIGHT = exports.FDCSDS_NAME = void 0;
exports.createDefaultConfig = createDefaultConfig;
// Application constants
exports.FDCSDS_NAME = 'FDC+ Serial Drive Server';
exports.FDCSDS_COPYRIGHT = 'TypeScript port by JoeZilla';
exports.FDCSDS_VERSION = '2.0.0';
// Drive configuration
exports.MAX_DRIVES = 16;
exports.MAX_TRACKS = 77;
exports.MAX_TRACK_LEN = 137 * 32; // 4,384 bytes
exports.MAX_DISK_SIZE = exports.MAX_TRACK_LEN * exports.MAX_TRACKS;
exports.MAX_PATH = 128;
// Baud rates supported by FDC+
var BaudRate;
(function (BaudRate) {
    BaudRate[BaudRate["B9600"] = 9600] = "B9600";
    BaudRate[BaudRate["B19200"] = 19200] = "B19200";
    BaudRate[BaudRate["B38400"] = 38400] = "B38400";
    BaudRate[BaudRate["B57600"] = 57600] = "B57600";
    BaudRate[BaudRate["B76800"] = 76800] = "B76800";
    BaudRate[BaudRate["B230400"] = 230400] = "B230400";
    BaudRate[BaudRate["B403200"] = 403200] = "B403200";
    BaudRate[BaudRate["B460800"] = 460800] = "B460800";
})(BaudRate || (exports.BaudRate = BaudRate = {}));
exports.DEFAULT_BAUD_RATE = BaudRate.B460800;
// FDC+ Error codes
var FdcError;
(function (FdcError) {
    FdcError[FdcError["OK"] = 0] = "OK";
    FdcError[FdcError["NOT_READY"] = 1] = "NOT_READY";
    FdcError[FdcError["CHKSUM_ERR"] = 2] = "CHKSUM_ERR";
    FdcError[FdcError["WRITE_ERR"] = 3] = "WRITE_ERR";
})(FdcError || (exports.FdcError = FdcError = {}));
// FDC+ Commands (4-byte ASCII strings)
var FdcCommand;
(function (FdcCommand) {
    FdcCommand["STAT"] = "STAT";
    FdcCommand["READ"] = "READ";
    FdcCommand["WRIT"] = "WRIT";
})(FdcCommand || (exports.FdcCommand = FdcCommand = {}));
/**
 * FDC+ Command/Response Block
 *
 * Structure:
 * - 4 bytes: Command (ASCII string)
 * - 2 bytes: Parameter 1 (uint16 little-endian)
 * - 2 bytes: Parameter 2 (uint16 little-endian)
 * Total: 8 bytes
 */
class CommandResponseBlock {
    cmd; // 4-byte ASCII command
    param1; // uint16
    param2; // uint16
    constructor(cmd = '\0\0\0\0', param1 = 0, param2 = 0) {
        this.cmd = cmd.padEnd(4, '\0').substring(0, 4);
        this.param1 = param1 & 0xffff;
        this.param2 = param2 & 0xffff;
    }
    /**
     * Convert to Buffer for transmission
     */
    toBuffer() {
        const buffer = Buffer.alloc(8);
        // Write 4-byte command
        buffer.write(this.cmd, 0, 4, 'ascii');
        // Write params as little-endian uint16
        buffer.writeUInt16LE(this.param1, 4);
        buffer.writeUInt16LE(this.param2, 6);
        return buffer;
    }
    /**
     * Parse from Buffer
     */
    static fromBuffer(buffer) {
        if (buffer.length < 8) {
            throw new Error(`Invalid buffer length: ${buffer.length}, expected 8`);
        }
        const cmd = buffer.toString('ascii', 0, 4);
        const param1 = buffer.readUInt16LE(4);
        const param2 = buffer.readUInt16LE(6);
        return new CommandResponseBlock(cmd, param1, param2);
    }
    /**
     * Get command as enum
     */
    getCommand() {
        const cmdStr = this.cmd.trim();
        if (Object.values(FdcCommand).includes(cmdStr)) {
            return cmdStr;
        }
        return null;
    }
    /**
     * Create from command and parameters
     */
    static create(cmd, param1, param2) {
        return new CommandResponseBlock(cmd, param1, param2);
    }
}
exports.CommandResponseBlock = CommandResponseBlock;
/**
 * Byte manipulation helpers (equivalent to C macros)
 */
class ByteUtils {
    static LSB(word) {
        return word & 0xff;
    }
    static MSB(word) {
        return (word & 0xff00) >> 8;
    }
    static WORD(lsb, msb) {
        return ((msb & 0xff) << 8) | (lsb & 0xff);
    }
}
exports.ByteUtils = ByteUtils;
/**
 * Create default configuration
 */
function createDefaultConfig() {
    return {
        port: null,
        baudRate: exports.DEFAULT_BAUD_RATE,
        verbose: false,
        debug: false,
        drives: new Map(),
        readonlyDrives: new Set(),
    };
}
/**
 * Timeout constants (in milliseconds)
 */
exports.TIMEOUT_DEFAULT = 5000;
exports.TIMEOUT_BYTE = 1000;
exports.TIMEOUT_BUFFER = 5000;
//# sourceMappingURL=protocol.js.map