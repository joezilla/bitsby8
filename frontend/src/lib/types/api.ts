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
    latestVersion: string | null;   // newest release on GitHub, null before first poll
    latestUrl: string | null;       // release page URL
    updateAvailable: boolean;
    updateCheckedAt: string | null; // ISO-8601 UTC
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
  // Copy-on-write backing for a read-only image: writes go to a throwaway
  // scratch (master untouched); `dirty` flips once the guest has written.
  transient?: boolean;
  dirty?: boolean;
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

export interface SnapshotInfo {
  id: string;
  disk_filename: string;
  label: string;
  size_bytes: number;
  created_at: string;
}

/** Per-image behavior when the guest writes to a read-only mount. */
export type ReadonlyWritePolicy = 'inherit' | 'error' | 'transient';

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

// ---------------------------------------------------------------------------
// Config section shapes — mirror the Zod schemas in src/config.ts.
// Every field is optional so a section PUT can carry a partial patch.
// ---------------------------------------------------------------------------

export interface SerialSection {
  port?: string;
  baud?: number;
  drive0?: string | null;
  drive1?: string | null;
  drive2?: string | null;
  drive3?: string | null;
  readonly?: number[];
}

export interface WebSection {
  web?: boolean;
  webPort?: number;
  webHost?: string;
  // Machine-only token — sent on set, never echoed on GET.
  apiKey?: string | null;
  // Human login password — plaintext on send, hashed server-side.
  // Never echoed on GET. Empty string clears the current password.
  adminPassword?: string | null;
}

export interface McpSection {
  enableMcpHttp?: boolean;
}

export interface DiskServingSection {
  // TCP-based (WebSocket) FDC transport. On by default — absent means
  // enabled; only an explicit false disables it.
  enableWsTransport?: boolean;
}

export interface TerminalSection {
  terminalPort?: string;
  terminalBaud?: number;
  terminalAutoconnect?: boolean;
  terminalBackspaceMode?: 'del' | 'bs';
  terminalLocalEcho?: boolean;
  terminalCrMode?: 'cr' | 'crlf';
}

export interface LoggingSection {
  verbose?: boolean;
  debug?: boolean;
  logFile?: string | null;
}

export interface DataSection {
  dataDir?: string | null;
  terminalOnly?: boolean;
}

export interface GpioDrivePins {
  enable?: number | null;
  headLoad?: number | null;
  readOnly?: number | null;
}

export interface GpioTerminalPins {
  rx?: number | null;
  tx?: number | null;
  connected?: number | null;
}

export interface GpioSection {
  enabled?: boolean;
  activeLow?: boolean;
  blinkDuration?: number;
  activityBlinkDuration?: number;
  activityLed?: number | null;
  drive0?: GpioDrivePins;
  drive1?: GpioDrivePins;
  drive2?: GpioDrivePins;
  drive3?: GpioDrivePins;
  terminal?: GpioTerminalPins;
}

export interface ConfigDoc
  extends SerialSection,
    WebSection,
    McpSection,
    DiskServingSection,
    TerminalSection,
    LoggingSection,
    DataSection {
  gpioLeds?: GpioSection;
}

export interface ConfigStatus {
  // Read-only baseline shipped by the package (e.g. /etc/fdcsds/fdcsds.config.json).
  // Editable by an admin, never by the daemon.
  packageConfigFilePath: string | null;
  // Writable runtime overrides file (e.g. /var/lib/fdcsds/fdcsds.overrides.json).
  // Every UI-driven save lands here, shallow-merged on top of the baseline.
  overrideConfigFilePath: string | null;
  // Alias for overrideConfigFilePath — kept one release for old frontends.
  configFilePath: string | null;
  writable: boolean;
  mtimeMs: number | null;
  systemdManaged: boolean;
  startupEpoch: number;
  apiKeySet: boolean;
  adminPasswordSet: boolean;
  mcpHttpEnabled: boolean;
  mcpHttpLive: boolean;
  mcpHttpSessions: number;
  // TCP-based disk serving (WebSocket FDC transport) — on by default.
  wsTransportEnabled: boolean;
  wsTransportConnected: boolean;
  configReadonly: boolean;
  etag?: string;
}
