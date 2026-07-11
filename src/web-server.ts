/**
 * Web Server Module
 * Provides REST API and WebSocket interface for remote management.
 *
 * This is the orchestrator that composes middleware, routes, and WebSocket
 * handlers from their respective modules.
 */

import express from 'express';
import { createServer, IncomingMessage } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { WebSocketServer } from 'ws';
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
import { MAX_DISK_IMAGE_SIZE } from './utils/disk-image-validation';
import { setupWebSocket } from './websocket/handlers';
import { broadcastStatus } from './services/disk-serving';
import { getWsTransportManager } from './ws-transport';
import { startReleaseChecker } from './services/release-check';

// Route modules
import { registerHealthRoutes } from './routes/health';
import { registerConfigRoutes } from './routes/config';
import { registerSerialRoutes } from './routes/serial';
import { registerDiskServingRoutes } from './routes/disk-serving';
import { registerDriveRoutes } from './routes/drives';
import { registerImageRoutes } from './routes/images';
import { registerSnapshotRoutes } from './routes/snapshots';
import { registerCatalogRoutes } from './routes/catalog';
import { loadSeedCatalog } from './services/catalog-seed';
import { INSTANCE_CLIENT_PREFIX } from './services/instance-manager';
import { registerSettingsRoutes } from './routes/settings';
import { registerClientRoutes } from './routes/clients';
import { ConnectionManager } from './services/connection-manager';
import { getMultiClientServing, getWriteMaster } from './services/feature-flags';
import { registerCpmRoutes } from './routes/cpm';
import { registerCassetteRoutes } from './routes/cassettes';
import { registerTerminalRoutes } from './routes/terminal';
import { registerScriptRoutes } from './routes/scripts';
import { registerReplayRoutes } from './routes/replay';
import { registerMcpRoutes, setMcpHttpEnabled } from './mcp-http';
import { createBearerOnlyAuth } from './middleware/auth';
import { registerAuthRoutes } from './routes/auth';
import { SessionStore } from './services/session-store';
import { createLogger } from './logger';

const log = createLogger('web-server');

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

    // In-memory session store for UI logins. Sessions die on daemon
    // restart — operators re-login on the next page load, which
    // AuthGate handles automatically via the 401-then-reload flow.
    const sessionStore = new SessionStore();

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
      sessionStore,
      wsTransport: getWsTransportManager(),
      multiClientServing: false,
      writeMaster: 'serial',
      server: options?.server || null,
      diskServingEnabled: options?.server !== null && options?.server !== undefined,
      serverTask: null,
      replayEngine: null,
      xmodemSender: null,
      audioPlayer: null,
      currentAudioProcess: null,
    };

    // Surface the "apiKey set but no adminPassword" state at startup
    // — this is the LAN-open regression the migration plan warns about.
    const rc = this.deps.runtimeConfig;
    if (rc?.apiKey && !rc?.adminPassword) {
      log.warn(
        'Admin password not set — browsers cannot log in to the dashboard UI. ' +
          'Machine clients (MCP, curl) can still authenticate with the API key. ' +
          'To enable UI access, set adminPassword via PUT /api/config/web or by ' +
          'editing /var/lib/fdcsds/fdcsds.overrides.json directly.',
      );
    }

    // Propagate verbose setting to terminal serial manager
    if (this.deps.runtimeConfig?.verbose) {
      this.deps.terminalManager.setVerbose(true);
    }

    // Owns the extra per-connection loops used when multi-client serving is on.
    this.deps.connectionManager = new ConnectionManager(this.deps);

    this.setup();
  }

  private setup(): void {
    // Middleware. Auth uses live callbacks into runtimeConfig so key
    // and password rotations take effect without a daemon restart.
    setupSecurityMiddleware(this.app, this.deps.config, {
      getApiKey: () => this.deps.runtimeConfig?.apiKey ?? null,
      getAdminPasswordHash: () => this.deps.runtimeConfig?.adminPassword ?? null,
      sessionStore: this.deps.sessionStore!,
    });
    setupStaticMiddleware(this.app);

    // REST API routes
    const router = this.app;
    registerHealthRoutes(router, this.deps);
    registerAuthRoutes(router, this.deps);
    registerConfigRoutes(router, this.deps);
    registerSerialRoutes(router, this.deps);
    registerDiskServingRoutes(router, this.deps);
    registerDriveRoutes(router, this.deps);
    registerImageRoutes(router, this.deps);
    registerSnapshotRoutes(router, this.deps);
    registerCatalogRoutes(router, this.deps);
    registerSettingsRoutes(router, this.deps);
    registerClientRoutes(router, this.deps);
    registerCpmRoutes(router, this.deps);
    registerCassetteRoutes(router, this.deps);
    registerTerminalRoutes(router, this.deps);
    registerScriptRoutes(router, this.deps);
    registerReplayRoutes(router, this.deps);

    // MCP over HTTP (opt-in via config.enableMcpHttp). Bearer-ONLY
    // auth — session cookies must NOT authenticate here, or a browser
    // on the same origin could POST to /mcp with the operator's UI
    // cookie attached (CSRF). Machines never have cookies, so this is
    // strictly correct behavior.
    this.app.use(
      '/mcp',
      createBearerOnlyAuth(() => this.deps.runtimeConfig?.apiKey ?? null),
    );
    // MCP tool bodies carry base64 file payloads (write_cpm_file), which
    // blow past express.json's 100 KB default. Allow up to the
    // base64-expanded disk-image ceiling (~1.34× the raw size) plus slack
    // for the JSON-RPC envelope, so any file that fits a target disk can
    // be written over MCP-HTTP, not just over the REST upload endpoint.
    const mcpBodyLimit = Math.ceil(MAX_DISK_IMAGE_SIZE * 1.4) + 64 * 1024;
    this.app.use('/mcp', express.json({ limit: mcpBodyLimit }));
    registerMcpRoutes(this.app as any, this.deps);
    const apiKey = this.deps.runtimeConfig?.apiKey ?? null;
    const mcpEnabled = !!apiKey && !!this.deps.runtimeConfig?.enableMcpHttp;
    setMcpHttpEnabled(mcpEnabled);
    log.info({ mcpHttpEnabled: mcpEnabled }, 'MCP HTTP transport state');

    // WebSocket handlers
    setupWebSocket(this.io, this.deps);

    // FDC WebSocket transport endpoint
    this.setupFdcWebSocket();
  }

  /**
   * Attach a raw WebSocket server at /fdc-ws for virtual FDC clients.
   *
   * Socket.IO also registers an 'upgrade' listener (to handle /socket.io paths).
   * We capture Socket.IO's listeners and replace them with a routing handler
   * that steers /fdc-ws upgrades to our ws server and everything else to Socket.IO.
   * This is the recommended pattern from the ws README for sharing an HTTP server.
   */
  private setupFdcWebSocket(): void {
    const wss = new WebSocketServer({ noServer: true });
    const log = require('./logger').createLogger('fdc-ws');

    // Capture existing upgrade listeners (Socket.IO's) before replacing them.
    const existingListeners = this.httpServer.rawListeners('upgrade').slice();
    this.httpServer.removeAllListeners('upgrade');

    this.httpServer.on('upgrade', (req: IncomingMessage, socket: any, head: Buffer) => {
      const rawUrl = req.url || '';
      const urlPath = rawUrl.split('?')[0];

      if (urlPath === '/fdc-ws') {
        // TCP-based disk serving is on by default; only an explicit
        // `false` disables it. Refuse the upgrade when turned off.
        if (this.deps.runtimeConfig?.enableWsTransport === false) {
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
          socket.destroy();
          return;
        }
        const apiKey = this.deps.runtimeConfig?.apiKey ?? null;
        if (apiKey && !isFdcWsAuthorized(req, apiKey)) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (client) => {
          // Multi-client ON: each virtual client gets its own served loop +
          // copy-on-write session via the ConnectionManager. OFF: legacy
          // single shared transport (a new client replaces the prior one).
          if (this.deps.multiClientServing && this.deps.connectionManager) {
            const clientId = new URL(rawUrl, 'http://localhost').searchParams.get('clientId');
            // The `inst:` clientId namespace is reserved for local virtual
            // Machine Instances (served in-process). An external client must not
            // claim it — that would collide with an instance's splinter (AD-7).
            if (clientId?.startsWith(INSTANCE_CLIENT_PREFIX)) {
              log.warn({ clientId }, 'rejecting external FDC client claiming reserved inst: prefix');
              try { client.close(); } catch { /* already closing */ }
              return;
            }
            log.info({ clientId }, 'Virtual FDC client connected (multi-client)');
            this.deps.connectionManager.addWsClient(client, clientId).catch((err) => {
              log.error({ err }, 'failed to start multi-client FDC connection');
            });
          } else {
            log.info('Virtual FDC client connected');
            this.deps.wsTransport.acceptConnection(client);
            this.broadcastStatus();
          }
        });
        return;
      }

      // Delegate everything else to Socket.IO's listener(s).
      for (const listener of existingListeners) {
        (listener as Function).call(this.httpServer, req, socket, head);
      }
    });
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

    // Seed the Catalog with 8sim's built-in Card Definitions (non-fatal).
    try {
      await loadSeedCatalog(this.deps);
    } catch (error) {
      console.error('Catalog seeding failed (continuing):', error);
    }

    // Cache the multi-client settings (updated live by PUT /api/settings).
    try {
      this.deps.multiClientServing = await getMultiClientServing(this.deps.database);
      this.deps.writeMaster = await getWriteMaster(this.deps.database);
    } catch {
      this.deps.multiClientServing = false;
      this.deps.writeMaster = 'serial';
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

/**
 * Check whether an /fdc-ws upgrade request carries a valid API key.
 * Accepts: Authorization: Bearer <key>  OR  ?token=<key> query param.
 */
function isFdcWsAuthorized(req: IncomingMessage, apiKey: string): boolean {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7) === apiKey;
  }
  const tokenMatch = (req.url || '').match(/[?&]token=([^&]+)/);
  if (tokenMatch) {
    return decodeURIComponent(tokenMatch[1]) === apiKey;
  }
  return false;
}
