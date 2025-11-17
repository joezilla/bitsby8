/**
 * FDC+ Serial Drive Server Protocol Definitions
 * TypeScript port of original C implementation
 */
export declare const FDCSDS_NAME = "FDC+ Serial Drive Server";
export declare const FDCSDS_COPYRIGHT = "TypeScript port by JoeZilla";
export declare const FDCSDS_VERSION = "2.0.0";
export declare const MAX_DRIVES = 16;
export declare const MAX_TRACKS = 77;
export declare const MAX_TRACK_LEN: number;
export declare const MAX_DISK_SIZE: number;
export declare const MAX_PATH = 128;
export declare enum BaudRate {
    B9600 = 9600,
    B19200 = 19200,
    B38400 = 38400,
    B57600 = 57600,
    B76800 = 76800,
    B230400 = 230400,
    B403200 = 403200,// macOS only
    B460800 = 460800
}
export declare const DEFAULT_BAUD_RATE = BaudRate.B460800;
export declare enum FdcError {
    OK = 0,
    NOT_READY = 1,
    CHKSUM_ERR = 2,
    WRITE_ERR = 3
}
export declare enum FdcCommand {
    STAT = "STAT",
    READ = "READ",
    WRIT = "WRIT"
}
/**
 * Drive state information
 */
export interface DriveState {
    fd: number | null;
    filename: string | null;
    mounted: boolean;
    readonly: boolean;
    hdld: boolean;
    track: number;
}
/**
 * FDC+ Command/Response Block
 *
 * Structure:
 * - 4 bytes: Command (ASCII string)
 * - 2 bytes: Parameter 1 (uint16 little-endian)
 * - 2 bytes: Parameter 2 (uint16 little-endian)
 * Total: 8 bytes
 */
export declare class CommandResponseBlock {
    cmd: string;
    param1: number;
    param2: number;
    constructor(cmd?: string, param1?: number, param2?: number);
    /**
     * Convert to Buffer for transmission
     */
    toBuffer(): Buffer;
    /**
     * Parse from Buffer
     */
    static fromBuffer(buffer: Buffer): CommandResponseBlock;
    /**
     * Get command as enum
     */
    getCommand(): FdcCommand | null;
    /**
     * Create from command and parameters
     */
    static create(cmd: FdcCommand, param1: number, param2: number): CommandResponseBlock;
}
/**
 * Byte manipulation helpers (equivalent to C macros)
 */
export declare class ByteUtils {
    static LSB(word: number): number;
    static MSB(word: number): number;
    static WORD(lsb: number, msb: number): number;
}
/**
 * Application configuration
 */
export interface Config {
    port: string | null;
    baudRate: BaudRate;
    verbose: boolean;
    debug: boolean;
    drives: Map<number, string>;
    readonlyDrives: Set<number>;
}
/**
 * Create default configuration
 */
export declare function createDefaultConfig(): Config;
/**
 * Timeout constants (in milliseconds)
 */
export declare const TIMEOUT_DEFAULT = 5000;
export declare const TIMEOUT_BYTE = 1000;
export declare const TIMEOUT_BUFFER = 5000;
//# sourceMappingURL=protocol.d.ts.map