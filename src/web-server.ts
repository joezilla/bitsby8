/**
 * Web Server Module
 * Provides REST API and WebSocket interface for remote management
 */

import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs/promises';
import { DriveManager } from './drive';
import { SerialPortManager } from './serial';
import { TerminalSerialManager } from './terminal-serial';
import { MAX_DRIVES } from './protocol';
import { getDatabase, DatabaseService } from './database';

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
  private db: DatabaseService;
  private upload: multer.Multer;

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

    // Initialize database
    this.db = getDatabase();

    // Configure multer for file uploads
    const storage = multer.diskStorage({
      destination: async (_req, _file, cb) => {
        try {
          await fs.mkdir(this.config.disksDir, { recursive: true });
          cb(null, this.config.disksDir);
        } catch (error) {
          cb(error as Error, this.config.disksDir);
        }
      },
      filename: (_req, file, cb) => {
        cb(null, file.originalname);
      }
    });

    this.upload = multer({
      storage,
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
      fileFilter: (_req, file, cb) => {
        const allowed = ['.dsk', '.img', '.ima'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) {
          cb(null, true);
        } else {
          cb(new Error('Invalid file type. Only .dsk, .img, and .ima files are allowed.'));
        }
      }
    });

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

    // Upload disk image
    this.app.post('/api/images/upload', this.upload.single('disk'), async (req: Request, res: Response): Promise<void> => {
      try {
        if (!req.file) {
          res.status(400).json({ error: 'No file uploaded' });
          return;
        }

        const filename = req.file.filename;
        const stats = await fs.stat(req.file.path);

        // Save metadata to database
        this.db.upsertDiskMetadata({
          filename,
          description: '',
          size: stats.size,
          uploadDate: new Date().toISOString()
        });

        res.json({ success: true, filename });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Delete disk image
    this.app.delete('/api/images/:filename', async (req: Request, res: Response): Promise<void> => {
      try {
        const filename = decodeURIComponent(req.params.filename);

        // Check if disk is in use (in startup mounts)
        if (this.db.isDiskInUse(filename)) {
          res.status(400).json({
            error: 'Disk is configured as a startup mount. Remove it from startup mounts first.'
          });
          return;
        }

        // Check if currently mounted
        for (let i = 0; i < MAX_DRIVES; i++) {
          const state = this.driveManager.getDriveState(i);
          if (state && state.filename && path.basename(state.filename) === filename) {
            res.status(400).json({
              error: 'Disk is currently mounted. Unmount it first.'
            });
            return;
          }
        }

        // Delete file
        const filePath = path.join(this.config.disksDir, filename);
        await fs.unlink(filePath);

        // Delete metadata
        this.db.deleteDiskMetadata(filename);

        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Get all disk metadata
    this.app.get('/api/disks/metadata', (_req: Request, res: Response): void => {
      try {
        const allMetadata = this.db.getAllDiskMetadata();

        // Convert array to object keyed by filename
        const metadataObj: Record<string, any> = {};
        allMetadata.forEach(meta => {
          metadataObj[meta.filename] = meta;
        });

        res.json(metadataObj);
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Update disk metadata
    this.app.put('/api/images/:filename/metadata', async (req: Request, res: Response): Promise<void> => {
      try {
        const filename = decodeURIComponent(req.params.filename);
        const { description } = req.body;

        const success = this.db.updateDiskDescription(filename, description || '');

        if (success) {
          res.json({ success: true });
        } else {
          res.status(404).json({ error: 'Disk not found' });
        }
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Get startup mounts
    this.app.get('/api/startup-mounts', (_req: Request, res: Response): void => {
      try {
        const mounts = this.db.getAllStartupMounts();
        res.json(mounts);
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Save startup mounts
    this.app.put('/api/startup-mounts', async (req: Request, res: Response): Promise<void> => {
      try {
        const { mounts } = req.body;

        if (!Array.isArray(mounts)) {
          res.status(400).json({ error: 'Invalid mounts data' });
          return;
        }

        // Update each drive's startup mount
        for (const mount of mounts) {
          this.db.setStartupMount(
            mount.driveId,
            mount.diskFilename || null,
            mount.readonly || false
          );
        }

        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Get configuration
    this.app.get('/api/config', async (_req: Request, res: Response): Promise<void> => {
      try {
        // For now, return empty config object
        // In a full implementation, this would load from config file and merge with DB overrides
        const config = this.db.getAllConfigOverrides();
        res.json(config);
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Save configuration
    this.app.put('/api/config', async (req: Request, res: Response): Promise<void> => {
      try {
        const config = req.body;

        // Save each config item as override
        for (const [key, value] of Object.entries(config)) {
          const type = typeof value === 'number' ? 'number' :
                       typeof value === 'boolean' ? 'boolean' :
                       typeof value === 'object' ? 'json' : 'string';
          this.db.setConfigOverride(key, value, type as any);
        }

        res.json({ success: true, message: 'Configuration saved. Some settings may require restart.' });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Serial port API endpoints

    // Get serial port status
    this.app.get('/api/serial/status', (_req: Request, res: Response) => {
      res.json({
        connected: this.serialManager.isOpen(),
        device: this.serialManager.getDevice(),
      });
    });

    // Connect to serial port
    this.app.post('/api/serial/connect', async (req: Request, res: Response): Promise<void> => {
      try {
        const { device, baudRate } = req.body;

        if (!device) {
          res.status(400).json({ error: 'Device path is required' });
          return;
        }

        if (!baudRate) {
          res.status(400).json({ error: 'Baud rate is required' });
          return;
        }

        // Check if already connected
        if (this.serialManager.isOpen()) {
          res.status(400).json({ error: 'Serial port is already connected. Disconnect first.' });
          return;
        }

        await this.serialManager.openPort(device, baudRate);

        // Broadcast status update
        this.io.emit('serial:status', {
          connected: true,
          device: this.serialManager.getDevice(),
        });

        res.json({ success: true, device, baudRate });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Disconnect from serial port
    this.app.post('/api/serial/disconnect', async (_req: Request, res: Response): Promise<void> => {
      try {
        if (!this.serialManager.isOpen()) {
          res.status(400).json({ error: 'Serial port is not connected' });
          return;
        }

        await this.serialManager.closePort();

        // Broadcast status update
        this.io.emit('serial:status', {
          connected: false,
          device: null,
        });

        res.json({ success: true });
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
