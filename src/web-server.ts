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
import { MAX_DRIVES } from './protocol';

export interface WebServerConfig {
  port: number;
  host: string;
  disksDir: string;
}

export class WebServer {
  private app: express.Application;
  private httpServer: any;
  private io: SocketIOServer;
  private config: WebServerConfig;
  private driveManager: DriveManager;
  private serialManager: SerialPortManager;
  private statusInterval: NodeJS.Timeout | null = null;

  constructor(
    config: WebServerConfig,
    driveManager: DriveManager,
    serialManager: SerialPortManager
  ) {
    this.config = config;
    this.driveManager = driveManager;
    this.serialManager = serialManager;

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
      console.log('Web client connected:', socket.id);

      // Send initial status
      socket.emit('status', this.getStatus());

      // Handle disconnect
      socket.on('disconnect', () => {
        console.log('Web client disconnected:', socket.id);
      });

      // Handle status request
      socket.on('request-status', () => {
        socket.emit('status', this.getStatus());
      });
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
