/**
 * Web Server Module
 * Provides REST API and WebSocket interface for remote management
 */

import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import * as path from 'path';
import * as fs from 'fs/promises';
import { DriveManager } from './drive';
import { SerialPortManager } from './serial';
import { TerminalSerialManager } from './terminal-serial';
import { MAX_DRIVES } from './protocol';

export interface WebServerConfig {
  port: number;
  host: string;
  disksDir: string;
}

export interface PreferredTerminalSettings {
  port?: string;
  baud?: number;
}

export class WebServer {
  private app: express.Application;
  private httpServer: any;
  private io: SocketIOServer;
  private config: WebServerConfig;
  private driveManager: DriveManager;
  private serialManager: SerialPortManager;
  private terminalManager: TerminalSerialManager;
  private preferredTerminalSettings: PreferredTerminalSettings;
  private statusInterval: NodeJS.Timeout | null = null;

  constructor(
    config: WebServerConfig,
    driveManager: DriveManager,
    serialManager: SerialPortManager,
    terminalManager: TerminalSerialManager,
    preferredTerminalSettings?: PreferredTerminalSettings
  ) {
    this.config = config;
    this.driveManager = driveManager;
    this.serialManager = serialManager;
    this.terminalManager = terminalManager;
    this.preferredTerminalSettings = preferredTerminalSettings || {};

    // Create Express app
    this.app = express();
    this.httpServer = createServer(this.app);

    // Create Socket.IO server
    this.io = new SocketIOServer(this.httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
    });

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, '../public')));
  }

  /**
   * Setup REST API routes
   */
  private setupRoutes(): void {
    // Health check
    this.app.get('/api/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Get server status
    this.app.get('/api/status', (_req: Request, res: Response) => {
      res.json(this.getStatus());
    });

    // Get drive status
    this.app.get('/api/drives', (_req: Request, res: Response) => {
      res.json(this.getDrivesStatus());
    });

    // Mount disk image to drive
    this.app.post('/api/drives/:id/mount', async (req: Request, res: Response): Promise<void> => {
      try {
        const driveId = parseInt(req.params.id);
        const { filename } = req.body;

        if (!filename) {
          res.status(400).json({ error: 'Filename is required' });
          return;
        }

        if (driveId < 0 || driveId >= MAX_DRIVES) {
          res.status(400).json({ error: 'Invalid drive ID' });
          return;
        }

        // Construct full path
        const fullPath = path.join(this.config.disksDir, filename);

        // Mount the drive
        await this.driveManager.mountDrive(driveId, fullPath);

        // Broadcast status update
        this.broadcastStatus();

        res.json({ success: true, drive: driveId, filename });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Unmount drive
    this.app.post('/api/drives/:id/unmount', async (req: Request, res: Response): Promise<void> => {
      try {
        const driveId = parseInt(req.params.id);

        if (driveId < 0 || driveId >= MAX_DRIVES) {
          res.status(400).json({ error: 'Invalid drive ID' });
          return;
        }

        await this.driveManager.unmountDrive(driveId);

        // Broadcast status update
        this.broadcastStatus();

        res.json({ success: true, drive: driveId });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Set drive read-only status
    this.app.put('/api/drives/:id/readonly', (req: Request, res: Response): void => {
      try {
        const driveId = parseInt(req.params.id);
        const { readonly } = req.body;

        if (driveId < 0 || driveId >= MAX_DRIVES) {
          res.status(400).json({ error: 'Invalid drive ID' });
          return;
        }

        this.driveManager.writeProtect(driveId, readonly);

        // Broadcast status update
        this.broadcastStatus();

        res.json({ success: true, drive: driveId, readonly });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // List available disk images
    this.app.get('/api/images', async (_req: Request, res: Response): Promise<void> => {
      try {
        const images = await this.listDiskImages();
        res.json({ images });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Terminal API endpoints

    // Get terminal status
    this.app.get('/api/terminal/status', (_req: Request, res: Response) => {
      res.json(this.getTerminalStatus());
    });

    // List available serial ports
    this.app.get('/api/terminal/ports', async (_req: Request, res: Response): Promise<void> => {
      try {
        const ports = await TerminalSerialManager.listPorts();
        res.json({ ports });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Open terminal serial port
    this.app.post('/api/terminal/open', async (req: Request, res: Response): Promise<void> => {
      try {
        const { device, config } = req.body;

        if (!device) {
          res.status(400).json({ error: 'Device path is required' });
          return;
        }

        await this.terminalManager.openPort(device, config);

        // Broadcast terminal status update
        this.io.emit('terminal:status', this.getTerminalStatus());

        res.json({ success: true, device });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Close terminal serial port
    this.app.post('/api/terminal/close', async (_req: Request, res: Response): Promise<void> => {
      try {
        await this.terminalManager.closePort();

        // Broadcast terminal status update
        this.io.emit('terminal:status', this.getTerminalStatus());

        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Update terminal configuration
    this.app.put('/api/terminal/config', async (req: Request, res: Response): Promise<void> => {
      try {
        const { config } = req.body;

        if (!config) {
          res.status(400).json({ error: 'Configuration is required' });
          return;
        }

        await this.terminalManager.updateConfig(config);

        // Broadcast terminal status update
        this.io.emit('terminal:status', this.getTerminalStatus());

        res.json({ success: true, config: this.terminalManager.getConfig() });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Serve the web interface
    this.app.get('/', (_req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, '../public/index.html'));
    });
  }

  /**
   * Setup WebSocket handlers
   */
  private setupWebSocket(): void {
    this.io.on('connection', (socket) => {
      // console.log('Web client connected:', socket.id);

      // Send initial status
      socket.emit('status', this.getStatus());
      socket.emit('terminal:status', this.getTerminalStatus());

      // Handle disconnect
      socket.on('disconnect', () => {
        // console.log('Web client disconnected:', socket.id);
      });

      // Handle status request
      socket.on('request-status', () => {
        socket.emit('status', this.getStatus());
      });

      // Terminal WebSocket handlers

      // Handle terminal data from client (keyboard input)
      socket.on('terminal:write', async (data: string) => {
        try {
          if (this.terminalManager.isOpen()) {
            await this.terminalManager.write(Buffer.from(data));
          }
        } catch (error) {
          socket.emit('terminal:error', { message: (error as Error).message });
        }
      });

      // Handle terminal control signals
      socket.on('terminal:control', async (signal: { type: 'dtr' | 'rts'; value: boolean }) => {
        try {
          if (this.terminalManager.isOpen()) {
            if (signal.type === 'dtr') {
              await this.terminalManager.setDTR(signal.value);
            } else if (signal.type === 'rts') {
              await this.terminalManager.setRTS(signal.value);
            }
          }
        } catch (error) {
          socket.emit('terminal:error', { message: (error as Error).message });
        }
      });
    });

    // Setup terminal data handler to broadcast incoming serial data to all clients
    this.terminalManager.onData((data: Buffer) => {
      this.io.emit('terminal:data', Array.from(data));
    });

    // Setup terminal error handler
    this.terminalManager.onError((error: Error) => {
      this.io.emit('terminal:error', { message: error.message });
    });

    // Setup terminal close handler
    this.terminalManager.onClose(() => {
      this.io.emit('terminal:status', this.getTerminalStatus());
    });
  }

  /**
   * Get current server status
   */
  private getStatus() {
    return {
      serial: {
        connected: this.serialManager.isOpen(),
        device: this.serialManager.getDevice(),
        baudRate: this.serialManager.getBaudRate(),
      },
      drives: this.getDrivesStatus(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get drives status
   */
  private getDrivesStatus() {
    const drives: any[] = [];

    for (let i = 0; i < 4; i++) {
      // Show first 4 drives in UI
      const state = this.driveManager.getDriveState(i);
      if (state) {
        drives.push({
          id: i,
          mounted: state.mounted,
          filename: state.filename ? path.basename(state.filename) : null,
          fullPath: state.filename,
          readonly: state.readonly,
          headLoaded: state.hdld,
          track: state.track,
        });
      }
    }

    return drives;
  }

  /**
   * Get terminal status
   */
  private getTerminalStatus() {
    return {
      connected: this.terminalManager.isOpen(),
      device: this.terminalManager.getDevice(),
      config: this.terminalManager.getConfig(),
      preferred: this.preferredTerminalSettings,
    };
  }

  /**
   * List available disk images in disks directory
   */
  private async listDiskImages(): Promise<string[]> {
    try {
      // Ensure disks directory exists
      await fs.mkdir(this.config.disksDir, { recursive: true });

      const files = await fs.readdir(this.config.disksDir);

      // Filter for disk image files
      return files.filter((file) =>
        file.match(/\.(dsk|img|ima)$/i)
      ).sort();
    } catch (error) {
      console.error('Error listing disk images:', error);
      return [];
    }
  }

  /**
   * Broadcast status update to all connected clients
   */
  public broadcastStatus(): void {
    this.io.emit('status', this.getStatus());
  }

  /**
   * Start the web server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.httpServer.listen(this.config.port, this.config.host, () => {
          console.log(
            `Web interface available at http://${this.config.host}:${this.config.port}`
          );

          // Start periodic status broadcasting
          this.statusInterval = setInterval(() => {
            this.broadcastStatus();
          }, 1000); // Update every second

          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop the web server
   */
  async stop(): Promise<void> {
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = null;
    }

    return new Promise((resolve) => {
      this.httpServer.close(() => {
        console.log('Web server stopped');
        resolve();
      });
    });
  }
}
