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

  // Absolute path of the config file this daemon loaded at startup.
  // `null` when the daemon runs with no config file (all defaults).
  // Used by config-persistence to write back to the same location.
  configFilePath: string | null;

  // Millisecond epoch captured once at process start. The UI polls
  // this via `GET /api/config/status` after a Restart-now click to
  // detect that the daemon actually came back on the new process.
  startupEpoch: number;

  // Mutable server state
  server: FdcServer | null;
  diskServingEnabled: boolean;
  serverTask: Promise<void> | null;
  replayEngine: ReplayEngine | null;
  xmodemSender: XmodemSender | null;
  audioPlayer: any;
  currentAudioProcess: any;
}
