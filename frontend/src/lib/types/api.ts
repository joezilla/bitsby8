/** Types mirroring the backend API responses. */

export interface ServerStatus {
  serial: {
    connected: boolean;
    device: string | null;
    baudRate: number;
    configuredPort: string;
    configuredBaudRate: number;
  };
  diskServing: {
    enabled: boolean;
    running: boolean;
  };
  drives: DriveState[];
  system: {
    version: string;                // "2.0.0" — upstream semver
    build: string | null;           // "149+g76c38eb.dirty.1783199368" — git-derived revision
    commit: string | null;          // "76c38eb"
    dirty: boolean;
    builtAt: string | null;         // ISO-8601 UTC
    uptimeSeconds: number;
  };
  timestamp: string;
}

export interface DriveState {
  id: number;
  mounted: boolean;
  filename: string | null;
  fullPath: string | null;
  readonly: boolean;
  headLoaded: boolean;
  track: number;
  lastIo: number | null; // epoch ms of most recent successful r/w; null if never
}

export interface TerminalStatus {
  connected: boolean;
  device: string | null;
  config: TerminalConfig;
  preferred: {
    port?: string;
    baud?: number;
  };
}

export interface TerminalConfig {
  baudRate: number;
  dataBits: number;
  stopBits: number;
  parity: string;
  flowControl: string;
}

export interface DiskImageInfo {
  name: string;
  size: number;
  description: string;
  notes: string;
}

export interface CassetteInfo {
  name: string;
  size: number;
  description: string;
  notes: string;
}

export interface ScriptInfo {
  name: string;
  size: number;
}

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

export interface ReplayProgress {
  state: 'running' | 'completed' | 'cancelled' | 'error';
  bytesSent: number;
  totalBytes: number;
  percentComplete: number;
  fileName: string;
  error?: string;
}

export interface CpmFileInfo {
  user: number;
  filename: string;
  extension: string;
  size: number;
  readonly: boolean;
  system: boolean;
  extents: number;
}
