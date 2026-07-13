/**
 * Shared type definitions for the web server modules.
 */

import { Server as SocketIOServer } from 'socket.io';
import { DriveManager } from './drive';
import { SerialPortManager } from './serial';
import { TerminalSerialManager } from './terminal-serial';
import { ConfigFile } from './config';
import { FdcServer } from './server';
import { Database } from './database';
import { ReplayEngine } from './replay-engine';
import { XmodemSender } from './xmodem-sender';
import { SessionStore } from './services/session-store';
import { WsTransportManager } from './ws-transport';

export interface WebServerConfig {
  port: number;
  host: string;
  disksDir: string;
  cassettesDir: string;
  scriptsDir: string;
  uploadsDir?: string;
  dataDir?: string;
}

export interface PreferredTerminalSettings {
  port?: string;
  baud?: number;
}

/**
 * Dependencies shared across route modules, services, and WebSocket handlers.
 */
export interface Dependencies {
  config: WebServerConfig;
  driveManager: DriveManager;
  serialManager: SerialPortManager;
  terminalManager: TerminalSerialManager;
  preferredTerminalSettings: PreferredTerminalSettings;
  io: SocketIOServer;
  database: Database;
  runtimeConfig: ConfigFile | null;

  // Absolute path of the package-installed baseline config the daemon
  // loaded at startup — this file is read-only from the app's POV.
  // On a .deb install this is `/etc/fdcsds/fdcsds.config.json`.
  // `null` when no baseline was loaded (all-defaults mode).
  packageConfigFilePath: string | null;

  // Absolute path of the runtime override file. Every UI-driven save
  // writes here (shallow-merged on top of the baseline at daemon
  // startup). Lives under `dataDir` — `/var/lib/fdcsds/fdcsds.overrides.json`
  // on a .deb install. Never null in practice: even a fresh install
  // has a writable dataDir.
  overrideConfigFilePath: string | null;

  // The parsed baseline config as-loaded from `packageConfigFilePath`.
  // Passed to `writePartialConfig` so cross-layer validation (GPIO pin
  // uniqueness spanning baseline + override) fires on every save.
  baselineConfig: ConfigFile | null;

  // Millisecond epoch captured once at process start. The UI polls
  // this via `GET /api/config/status` after a Restart-now click to
  // detect that the daemon actually came back on the new process.
  startupEpoch: number;

  // When true (via `--config-readonly` at boot), every PUT
  // /api/config/* returns 423 Locked and POST /api/config/rollback
  // is also refused. Useful for demos / kiosk installs.
  configReadonly: boolean;

  // In-memory session store for the UI login flow. Never null in
  // practice — instantiated in WebServer.setup(). Optional in the
  // interface so unit-test route stubs don't have to provide one when
  // they're not exercising auth-cookie paths.
  sessionStore?: SessionStore;

  wsTransport: WsTransportManager;

  // Multi-client disk serving (feature-flagged). Cached from the DB settings
  // store at startup and updated live by PUT /api/settings. When true, extra
  // virtual clients are served via the ConnectionManager (per-connection
  // copy-on-write sessions); when false, the legacy single-client path runs.
  multiClientServing: boolean;
  // Which client writes the base image directly (others splinter): a clientId,
  // 'serial' (default), or 'none'. Cached from the DB; updated live by PUT.
  writeMaster: string;
  connectionManager?: import('./services/connection-manager').ConnectionManager;

  // Owns virtual Machine Instance lifecycle + consoles (Bitsby8). Instantiated
  // in WebServer.setup once deps are assembled.
  instanceManager?: import('./services/instance-manager').InstanceManager;

  // Mutable server state
  server: FdcServer | null;
  diskServingEnabled: boolean;
  serverTask: Promise<void> | null;
  replayEngine: ReplayEngine | null;
  xmodemSender: XmodemSender | null;
  audioPlayer: any;
  currentAudioProcess: any;
}
