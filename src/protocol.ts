/**
 * FDC+ Serial Drive Server Protocol Definitions
 * TypeScript port of original C implementation
 */

// Application constants
export const FDCSDS_NAME = 'FDC+ Serial Drive Server';
export const FDCSDS_COPYRIGHT = 'TypeScript port by JoeZilla';
export const FDCSDS_VERSION = '2.0.0';

// Drive configuration
export const MAX_DRIVES = 16;
export const MAX_TRACKS = 77;
export const MAX_TRACK_LEN = 137 * 32; // 4,384 bytes
export const MAX_DISK_SIZE = MAX_TRACK_LEN * MAX_TRACKS;
export const MAX_PATH = 128;

// Baud rates supported by FDC+
export enum BaudRate {
  B9600 = 9600,
  B19200 = 19200,
  B38400 = 38400,
  B57600 = 57600,
  B76800 = 76800,
  B230400 = 230400,
  B403200 = 403200, // macOS only
  B460800 = 460800,
}

export const DEFAULT_BAUD_RATE = BaudRate.B460800;

// FDC+ Error codes
export enum FdcError {
  OK = 0x00,
  NOT_READY = 0x01,
  CHKSUM_ERR = 0x02,
  WRITE_ERR = 0x03,
}

// FDC+ Commands (4-byte ASCII strings)
export enum FdcCommand {
  STAT = 'STAT',
  READ = 'READ',
  WRIT = 'WRIT',
}

/**
 * Drive state information
 */
export interface DriveState {
  fd: number | null; // File descriptor (null if unmounted)
  filename: string | null;
  mounted: boolean;
  readonly: boolean;
  hdld: boolean; // Head loaded
  track: number; // Current track number
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
export class CommandResponseBlock {
  cmd: string; // 4-byte ASCII command
  param1: number; // uint16
  param2: number; // uint16

  constructor(cmd: string = '\0\0\0\0', param1: number = 0, param2: number = 0) {
    this.cmd = cmd.padEnd(4, '\0').substring(0, 4);
    this.param1 = param1 & 0xffff;
    this.param2 = param2 & 0xffff;
  }

  /**
   * Convert to Buffer for transmission
   */
  toBuffer(): Buffer {
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
  static fromBuffer(buffer: Buffer): CommandResponseBlock {
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
  getCommand(): FdcCommand | null {
    const cmdStr = this.cmd.trim();
    if (Object.values(FdcCommand).includes(cmdStr as FdcCommand)) {
      return cmdStr as FdcCommand;
    }
    return null;
  }

  /**
   * Create from command and parameters
   */
  static create(cmd: FdcCommand, param1: number, param2: number): CommandResponseBlock {
    return new CommandResponseBlock(cmd, param1, param2);
  }
}

/**
 * Byte manipulation helpers (equivalent to C macros)
 */
export class ByteUtils {
  static LSB(word: number): number {
    return word & 0xff;
  }

  static MSB(word: number): number {
    return (word & 0xff00) >> 8;
  }

  static WORD(lsb: number, msb: number): number {
    return ((msb & 0xff) << 8) | (lsb & 0xff);
  }
}

/**
 * Application configuration
 */
export interface Config {
  port: string | null; // Serial port device path
  baudRate: BaudRate;
  verbose: boolean;
  debug: boolean;
  drives: Map<number, string>; // Drive number -> disk image path
  readonlyDrives: Set<number>; // Set of read-only drive numbers
}

/**
 * Create default configuration
 */
export function createDefaultConfig(): Config {
  return {
    port: null,
    baudRate: DEFAULT_BAUD_RATE,
    verbose: false,
    debug: false,
    drives: new Map(),
    readonlyDrives: new Set(),
  };
}

/**
 * Timeout constants (in milliseconds)
 */
export const TIMEOUT_DEFAULT = 5000;
export const TIMEOUT_BYTE = 1000;
export const TIMEOUT_BUFFER = 5000;
