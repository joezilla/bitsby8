/**
 * Web Server Module
 * Provides REST API and WebSocket interface for remote management.
 *
 * This is the orchestrator that composes middleware, routes, and WebSocket
 * handlers from their respective modules.
 */

import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import * as path from 'path';
import { DriveManager } from './drive';
import { SerialPortManager } from './serial';
import { TerminalSerialManager } from './terminal-serial';
import { ConfigFile } from './config';
import { FdcServer } from './server';
import { Database } from './database';
import { WebServerConfig, PreferredTerminalSettings, Dependencies } from './types';
import { buildAllowedOrigins, setupSecurityMiddleware } from './middleware/security';
import { setupStaticMiddleware } from './middleware/static';
import { setupWebSocket } from './websocket/handlers';
import { broadcastStatus } from './services/disk-serving';
import { startReleaseChecker } from './services/release-check';

// Route modules
import { registerHealthRoutes } from './routes/health';
import { registerConfigRoutes } from './routes/config';
import { registerSerialRoutes } from './routes/serial';
import { registerDiskServingRoutes } from './routes/disk-serving';
import { registerDriveRoutes } from './routes/drives';
import { registerImageRoutes } from './routes/images';
import { registerCpmRoutes } from './routes/cpm';
import { registerCassetteRoutes } from './routes/cassettes';
import { registerTerminalRoutes } from './routes/terminal';
import { registerScriptRoutes } from './routes/scripts';
import { registerReplayRoutes } from './routes/replay';
import { registerMcpRoutes, setMcpHttpEnabled } from './mcp-http';
import { createAuthMiddleware } from './middleware/auth';

// Re-export types for backward compatibility
export { WebServerConfig, PreferredTerminalSettings } from './types';

export class WebServer {
  private app: express.Application;
  private httpServer: any;
  private io: SocketIOServer;
  private deps: Dependencies;
  private statusInterval: NodeJS.Timeout | null = null;
  private stopReleaseCheck: (() => void) | null = null;

  constructor(
    config: WebServerConfig,
    driveManager: DriveManager,
    serialManager: SerialPortManager,
    terminalManager: TerminalSerialManager,
    preferredTerminalSettings?: PreferredTerminalSettings,
    options?: {
      server?: FdcServer;
      runtimeConfig?: ConfigFile;
      database?: Database;
      packageConfigFilePath?: string | null;
      overrideConfigFilePath?: string | null;
      baselineConfig?: ConfigFile | null;
      startupEpoch?: number;
      configReadonly?: boolean;
    }
  ) {
    // Create Express app and HTTP server
    this.app = express();
    this.httpServer = createServer(this.app);

    // Create Socket.IO server
    const allowedOrigins = buildAllowedOrigins(config);
    this.io = new SocketIOServer(this.httpServer, {
      cors: {
        origin: allowedOrigins,
        methods: ['GET', 'POST'],
      },
    });

    // Resolve database
    let database: Database;
    if (options?.database) {
      database = options.database;
    } else {
      const dbPath = path.join(config.dataDir || process.cwd(), 'fdcplus.db');
      database = new Database(dbPath);
    }

    // Build shared dependencies
    this.deps = {
      config,
      driveManager,
      serialManager,
      terminalManager,
      preferredTerminalSettings: preferredTerminalSettings || {},
      io: this.io,
      database,
      runtimeConfig: options?.runtimeConfig || null,
      packageConfigFilePath: options?.packageConfigFilePath ?? null,
      overrideConfigFilePath: options?.overrideConfigFilePath ?? null,
      baselineConfig: options?.baselineConfig ?? null,
      startupEpoch: options?.startupEpoch ?? Date.now(),
      configReadonly: options?.configReadonly ?? false,
      server: options?.server || null,
      diskServingEnabled: options?.server !== null && options?.server !== undefined,
      serverTask: null,
      replayEngine: null,
      xmodemSender: null,
      audioPlayer: null,
      currentAudioProcess: null,
    };

    // Propagate verbose setting to terminal serial manager
    if (this.deps.runtimeConfig?.verbose) {
      this.deps.terminalManager.setVerbose(true);
    }

    this.setup();
  }

  private setup(): void {
    // Middleware
    setupSecurityMiddleware(this.app, this.deps.config, this.deps.runtimeConfig?.apiKey);
    setupStaticMiddleware(this.app);

    // REST API routes
    const router = this.app;
    registerHealthRoutes(router, this.deps);
    registerConfigRoutes(router, this.deps);
    registerSerialRoutes(router, this.deps);
    registerDiskServingRoutes(router, this.deps);
    registerDriveRoutes(router, this.deps);
    registerImageRoutes(router, this.deps);
    registerCpmRoutes(router, this.deps);
    registerCassetteRoutes(router, this.deps);
    registerTerminalRoutes(router, this.deps);
    registerScriptRoutes(router, this.deps);
    registerReplayRoutes(router, this.deps);

    // MCP over HTTP (opt-in via config.enableMcpHttp). Bearer auth is
    // reused from the main API — MCP shares the same trust boundary.
    // The endpoint is always mounted; a runtime guard in mcp-http.ts
    // returns 503 when disabled, so operators can flip it without a
    // daemon restart. Refuse to activate without an api key.
    const apiKey = this.deps.runtimeConfig?.apiKey ?? null;
    this.app.use('/mcp', createAuthMiddleware(apiKey));
    registerMcpRoutes(this.app as any, this.deps);
    setMcpHttpEnabled(!!apiKey && !!this.deps.runtimeConfig?.enableMcpHttp);

    // WebSocket handlers
    setupWebSocket(this.io, this.deps);
  }

  /**
   * Cancel any active replay or XMODEM transfer.
   */
  public cancelActiveTransfer(): void {
    if (this.deps.replayEngine && this.deps.replayEngine.isRunning()) {
      this.deps.replayEngine.cancel();
    }
    if (this.deps.xmodemSender && this.deps.xmodemSender.isRunning()) {
      this.deps.xmodemSender.cancel();
    }
  }

  /**
   * Broadcast status update to all connected clients.
   */
  public broadcastStatus(): void {
    broadcastStatus(this.deps);
  }

  /**
   * Start the web server.
   */
  async start(): Promise<void> {
    // Initialize database if not already initialized
    if (!this.deps.database.isInitialized()) {
      try {
        await this.deps.database.initialize();
      } catch (error) {
        console.error(`Failed to initialize database at ${this.deps.database.getPath()}:`, error);
        console.log('Continuing without database support');
      }
    }

    return new Promise((resolve, reject) => {
      try {
        this.httpServer.listen(this.deps.config.port, this.deps.config.host, () => {
          console.log(
            `Web interface available at http://${this.deps.config.host}:${this.deps.config.port}`
          );

          // Start periodic status broadcasting
          this.statusInterval = setInterval(() => {
            this.broadcastStatus();
          }, 1000);

          // Start GitHub release poll unless disabled via config.
          const uc = this.deps.runtimeConfig?.system?.updateCheck;
          this.stopReleaseCheck = startReleaseChecker({
            enabled: uc?.enabled ?? true,
            intervalHours: uc?.intervalHours ?? 6,
          });

          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Start the FDC server (if one was provided in constructor).
   * Must be called after start() to begin disk serving.
   */
  async startServer(): Promise<void> {
    if (!this.deps.server) {
      throw new Error('No FDC server configured');
    }

    if (this.deps.serverTask) {
      console.warn('FDC server is already running');
      return;
    }

    console.log('Starting FDC server...');
    this.deps.serverTask = this.deps.server.start().catch((error) => {
      console.error('FDC server error:', error);
      this.deps.serverTask = null;
      this.deps.diskServingEnabled = false;
      this.broadcastStatus();
      throw error;
    });

    await new Promise(resolve => setTimeout(resolve, 100));
    console.log('FDC server started');
    this.broadcastStatus();
  }

  /**
   * Stop the web server.
   */
  async stop(): Promise<void> {
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = null;
    }

    if (this.stopReleaseCheck) {
      this.stopReleaseCheck();
      this.stopReleaseCheck = null;
    }

    this.io.disconnectSockets(true);

    return new Promise((resolve) => {
      this.httpServer.close(() => {
        this.io.close(() => {
          console.log('Web server stopped');
          resolve();
        });
      });
    });
  }
}
