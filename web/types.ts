export type PageName = 'home' | 'config' | 'disks';

export interface DriveStatus {
  id: number;
  mounted: boolean;
  filename?: string | null;
  fullPath?: string | null;
  readonly?: boolean;
  headLoaded?: boolean;
  track?: number;
}

export interface SerialStatus {
  connected: boolean;
  device?: string | null;
  baudRate?: number | null;
}

export interface ServerStatus {
  serial: SerialStatus;
  drives: DriveStatus[];
  timestamp: string;
}

export interface PreferredTerminalSettings {
  port?: string;
  baud?: number;
}

export interface TerminalConfig {
  baudRate?: number;
  dataBits?: number;
  stopBits?: number;
  parity?: string;
  flowControl?: string;
}

export interface TerminalStatus {
  connected: boolean;
  device?: string | null;
  config?: TerminalConfig;
  preferred?: PreferredTerminalSettings;
}

export interface PortInfo {
  path: string;
  manufacturer?: string | null;
}

export interface DiskMetadata {
  description?: string;
  size?: number;
  uploadDate?: string;
}

export interface StartupMount {
  driveId: number;
  diskFilename: string | null;
  readonly: boolean;
}

export interface ConfigOverrides {
  port?: string;
  baud?: number;
  terminalPort?: string;
  terminalBaud?: number;
  terminalAutoconnect?: boolean;
  webPort?: number;
  webHost?: string;
  gpioLeds?: {
    enabled?: boolean;
    pins?: number[];
    activity?: number;
    activeHigh?: boolean;
  };
  logFile?: string;
  verbose?: boolean;
  debug?: boolean;
  headless?: boolean;
}

export type NotificationKind = 'success' | 'error' | 'info';
