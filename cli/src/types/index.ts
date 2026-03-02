/**
 * Shared types for FDC+ CLI client.
 * These mirror the server's API response shapes.
 */

// --- Server Status ---

export interface ServerStatus {
  serial: {
    connected: boolean;
    device: string;
    baudRate: number;
    configuredPort: string;
    configuredBaudRate: number;
  };
  diskServing: {
    enabled: boolean;
    running: boolean;
  };
  drives: DriveStatus[];
  timestamp: string;
}

export interface DriveStatus {
  id: number;
  mounted: boolean;
  filename: string | null;
  fullPath: string | null;
  readonly: boolean;
  headLoaded: boolean;
  track: number;
}

// --- Serial Ports ---

export interface SerialPortInfo {
  path: string;
  resolvedPath: string;
  persistentPaths: {
    byId?: string;
    byPath?: string;
  };
  manufacturer?: string;
  serialNumber?: string;
  pnpId?: string;
  vendorId?: string;
  productId?: string;
  recommended: string;
}

// --- Disk Images ---

export interface DiskImage {
  name: string;
  size: number;
  description: string;
  notes: string;
}

// --- CP/M ---

export interface CpmFileInfo {
  user: number;
  filename: string;
  extension: string;
  size: number;
  readonly: boolean;
  system: boolean;
  extents: number;
}

export interface CpmDiskInfo {
  params: {
    seclen: number;
    tracks: number;
    sectrk: number;
    blocksize: number;
    maxdir: number;
    boottrk: number;
  };
  freeSpace: {
    freeBlocks: number;
    freeBytes: number;
    totalBlocks: number;
    totalBytes: number;
    usedBlocks: number;
    usedBytes: number;
    directoryEntriesFree: number;
    directoryEntriesTotal: number;
  };
  fileCount: number;
  mounted: boolean | number;
}

// --- Terminal ---

export interface TerminalConfig {
  baudRate?: number;
  dataBits?: 5 | 6 | 7 | 8;
  stopBits?: 1 | 2;
  parity?: 'none' | 'even' | 'odd' | 'mark' | 'space';
  flowControl?: 'none' | 'hardware' | 'software';
}

export interface TerminalStatus {
  connected: boolean;
  device: string;
  config: TerminalConfig;
  preferred: {
    port?: string;
    baud?: number;
  };
}

// --- Cassettes ---

export interface CassetteInfo {
  name: string;
  size: number;
  description: string;
  notes: string;
}

// --- Scripts ---

export interface ScriptInfo {
  name: string;
  size: number;
}

export interface ScriptContent {
  name: string;
  content?: string;
  size: number;
  binary: boolean;
}

// --- Replay / Transfer ---

export interface ReplayProgress {
  state: 'running' | 'completed' | 'cancelled' | 'error';
  bytesSent: number;
  totalBytes: number;
  percentComplete: number;
  fileName: string;
  error?: string;
}

export interface ReplayOptions {
  scriptName: string;
  mode?: 'raw' | 'xmodem';
  chunkSize?: number;
  interByteDelayMs?: number;
  interLineDelayMs?: number;
  lineEnding?: 'cr' | 'lf' | 'crlf' | 'raw';
  useCrc?: boolean;
}

// --- Server Config ---

export interface ServerConfig {
  port?: string;
  baud?: number;
  web?: boolean;
  webPort?: number;
  webHost?: string;
  terminalPort?: string;
  terminalBaud?: number;
  terminalAutoconnect?: boolean;
  verbose?: boolean;
  debug?: boolean;
  logFile?: string;
  gpioLeds?: boolean;
}

// --- CLI Config ---

export interface CliConfig {
  defaultServer?: string;
  servers?: Record<string, string>;
  terminalPort?: string;
  terminalBaud?: number;
  commandHistory?: string[];
}

// --- Input Modes ---

export type InputMode = 'terminal' | 'command';
