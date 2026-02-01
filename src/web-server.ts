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
import { existsSync, createReadStream } from 'fs';
import { DriveManager } from './drive';
import { SerialPortManager } from './serial';
import { TerminalSerialManager } from './terminal-serial';
import { BaudRate, MAX_DRIVES } from './protocol';
import { ConfigFile } from './config';
import { FdcServer } from './server';
import { Database } from './database';
import { ReplayEngine, ReplayProgress } from './replay-engine';
import { XmodemSender } from './xmodem-sender';
import playSound from 'play-sound';

export interface WebServerConfig {
  port: number;
  host: string;
  disksDir: string;
  cassettesDir: string;
  scriptsDir: string;
  uploadsDir?: string;
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
  private server: FdcServer | null;
  private runtimeConfig: ConfigFile | null;
  private statusInterval: NodeJS.Timeout | null = null;
  private database: Database;
  private audioPlayer: any = null;
  private currentAudioProcess: any = null;
  private diskServingEnabled: boolean = false;
  private serverTask: Promise<void> | null = null;
  private replayEngine: ReplayEngine | null = null;
  private xmodemSender: XmodemSender | null = null;

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
    }
  ) {
    this.config = config;
    this.driveManager = driveManager;
    this.serialManager = serialManager;
    this.terminalManager = terminalManager;
    this.preferredTerminalSettings = preferredTerminalSettings || {};
    this.server = options?.server || null;
    this.runtimeConfig = options?.runtimeConfig || null;
    // Disk serving is enabled if a server was provided (not in terminal-only mode)
    this.diskServingEnabled = this.server !== null;
    // Note: serverTask will be set when startServer() is called

    // Use provided database or create new one
    if (options?.database) {
      this.database = options.database;
    } else {
      const dbPath = path.join(process.cwd(), 'fdcplus.db');
      this.database = new Database(dbPath);
    }

    // Audio player will be lazy-loaded when first needed
    // (prevents ERR_INVALID_STATE errors on systems without audio)

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

    // Resolve public directory regardless of build location
    const repoPublic = path.resolve(process.cwd(), 'public');
    const distPublic = path.resolve(__dirname, '../public');

    const publicDir = existsSync(repoPublic) ? repoPublic : distPublic;
    if (existsSync(publicDir)) {
      this.app.use(express.static(publicDir));
    } else {
      // If both paths fail, still continue to allow APIs/websocket use
      console.warn('Warning: public assets directory not found');
    }
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

    // Get current configuration
    this.app.get('/api/config', (_req: Request, res: Response) => {
      // Return current runtime configuration
      const config: any = {
        // Serial options - use empty string as default
        port: this.runtimeConfig?.port || '',
        baud: this.runtimeConfig?.baud,

        // Web interface
        web: this.runtimeConfig?.web,
        webPort: this.runtimeConfig?.webPort,
        webHost: this.runtimeConfig?.webHost,

        // Terminal options
        terminalPort: this.runtimeConfig?.terminalPort,
        terminalBaud: this.runtimeConfig?.terminalBaud,
        terminalAutoconnect: this.runtimeConfig?.terminalAutoconnect,

        // Display options
        verbose: this.runtimeConfig?.verbose,
        debug: this.runtimeConfig?.debug,
        logFile: this.runtimeConfig?.logFile,

        // GPIO LED options
        gpioLeds: this.runtimeConfig?.gpioLeds,
      };
      res.json(config);
    });

    // Update configuration
    this.app.post('/api/config', async (req: Request, res: Response): Promise<void> => {
      try {
        const updates = req.body;

        // Update runtime config if available
        if (this.runtimeConfig) {
          // Update web options (these can take effect without restart)
          if (updates.verbose !== undefined) {
            this.runtimeConfig.verbose = updates.verbose;
            if (this.server) {
              this.server.toggleVerbose();
            }
          }

          // Other options require restart, just notify the user
          // In a real implementation, we'd save to config file here
        }

        res.json({ success: true, message: 'Configuration updated. Some changes may require restart.' });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // List available serial ports for the primary connection
    this.app.get('/api/serial/ports', async (_req: Request, res: Response): Promise<void> => {
      try {
        const ports = await TerminalSerialManager.listPorts();

        // Format port information for UI
        const formattedPorts = ports.map(port => ({
          path: port.path,
          resolvedPath: port.resolvedPath,
          persistentPaths: port.persistentPaths,
          manufacturer: port.metadata.manufacturer,
          serialNumber: port.metadata.serialNumber,
          pnpId: port.metadata.pnpId,
          vendorId: port.metadata.vendorId,
          productId: port.metadata.productId,
          // Recommend persistent path if available
          recommended: port.persistentPaths.byId || port.persistentPaths.byPath || port.path,
        }));

        res.json({ ports: formattedPorts });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Update primary serial configuration (device + baud)
    this.app.put('/api/serial/config', async (req: Request, res: Response): Promise<void> => {
      const { device, baudRate } = req.body || {};

      if (!device) {
        res.status(400).json({ error: 'Device path is required' });
        return;
      }

      const parsedBaud = typeof baudRate === 'string' ? parseInt(baudRate, 10) : baudRate;
      if (!parsedBaud || !Object.values(BaudRate).includes(parsedBaud as BaudRate)) {
        res.status(400).json({ error: 'Valid baudRate is required' });
        return;
      }

      const needsChange =
        !this.serialManager.isOpen() ||
        this.serialManager.getDevice() !== device ||
        this.serialManager.getBaudRate() !== (parsedBaud as BaudRate);

      try {
        if (this.server) {
          this.server.pause();
          await new Promise(resolve => setTimeout(resolve, 25));
        }

        if (needsChange) {
          await this.serialManager.closePort().catch(() => {});
          await this.serialManager.openPort(device, parsedBaud as BaudRate);
        }

        if (this.runtimeConfig) {
          this.runtimeConfig.port = device;
          this.runtimeConfig.baud = parsedBaud;
        }

        this.broadcastStatus();

        res.json({
          success: true,
          serial: {
            device,
            baudRate: parsedBaud,
            connected: this.serialManager.isOpen(),
          },
        });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      } finally {
        if (this.server) {
          this.server.resume();
        }
      }
    });

    // Enable disk serving
    this.app.post('/api/disk-serving/enable', async (_req: Request, res: Response): Promise<void> => {
      try {
        if (this.diskServingEnabled) {
          res.json({ success: true, message: 'Disk serving is already enabled', enabled: true });
          return;
        }

        await this.enableDiskServing();
        res.json({ success: true, message: 'Disk serving enabled', enabled: true });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Disable disk serving
    this.app.post('/api/disk-serving/disable', async (_req: Request, res: Response): Promise<void> => {
      try {
        if (!this.diskServingEnabled) {
          res.json({ success: true, message: 'Disk serving is already disabled', enabled: false });
          return;
        }

        await this.disableDiskServing();
        res.json({ success: true, message: 'Disk serving disabled', enabled: false });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
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

        // Save to database
        try {
          const readonly = this.driveManager.isReadOnly(driveId);
          await this.database.saveDriveAssignment(driveId, filename, readonly);
        } catch (dbError) {
          console.error('Failed to save drive assignment to database:', dbError);
          // Continue anyway - mount succeeded even if DB save failed
        }

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

        // Clear from database
        try {
          await this.database.clearDriveAssignment(driveId);
        } catch (dbError) {
          console.error('Failed to clear drive assignment from database:', dbError);
          // Continue anyway - unmount succeeded even if DB clear failed
        }

        // Broadcast status update
        this.broadcastStatus();

        res.json({ success: true, drive: driveId });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Set drive read-only status
    this.app.put('/api/drives/:id/readonly', async (req: Request, res: Response): Promise<void> => {
      try {
        const driveId = parseInt(req.params.id);
        const { readonly } = req.body;

        if (driveId < 0 || driveId >= MAX_DRIVES) {
          res.status(400).json({ error: 'Invalid drive ID' });
          return;
        }

        // Update write protection (may remount file with correct mode)
        await this.driveManager.writeProtect(driveId, readonly);

        // Update database if drive is mounted
        try {
          const driveState = this.driveManager.getDriveState(driveId);
          if (driveState && driveState.mounted && driveState.filename) {
            const filename = path.basename(driveState.filename);
            await this.database.saveDriveAssignment(driveId, filename, readonly);
          }
        } catch (dbError) {
          console.error('Failed to update drive assignment in database:', dbError);
          // Continue anyway - readonly change succeeded even if DB update failed
        }

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

    // Get detailed disk image information (with file sizes)
    this.app.get('/api/images/details', async (_req: Request, res: Response): Promise<void> => {
      try {
        const images = await this.listDiskImagesWithDetails();
        res.json({ images });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Configure multer for disk image uploads
    const storage = multer.diskStorage({
      destination: (_req, _file, cb) => {
        cb(null, this.config.disksDir);
      },
      filename: (_req, file, cb) => {
        // Use original filename
        cb(null, file.originalname);
      },
    });

    const upload = multer({
      storage: storage,
      fileFilter: (_req, file, cb) => {
        // Only accept .dsk, .img, .ima files
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.dsk' || ext === '.img' || ext === '.ima') {
          cb(null, true);
        } else {
          cb(new Error('Only .dsk, .img, and .ima files are allowed'));
        }
      },
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB max file size
      },
    });

    // Upload disk image
    this.app.post(
      '/api/images/upload',
      upload.single('diskImage'),
      async (req: Request, res: Response): Promise<void> => {
        try {
          if (!req.file) {
            res.status(400).json({ error: 'No file uploaded' });
            return;
          }

          res.json({
            success: true,
            filename: req.file.filename,
            size: req.file.size,
          });
        } catch (error) {
          res.status(500).json({ error: (error as Error).message });
        }
      }
    );

    // Clone disk image
    this.app.post('/api/images/:filename/clone', async (req: Request, res: Response): Promise<void> => {
      try {
        const filename = req.params.filename;

        if (!filename) {
          res.status(400).json({ error: 'Filename is required' });
          return;
        }

        // Validate filename (prevent path traversal)
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
          res.status(400).json({ error: 'Invalid filename' });
          return;
        }

        const sourcePath = path.join(this.config.disksDir, filename);

        // Check if source file exists
        if (!existsSync(sourcePath)) {
          res.status(404).json({ error: 'File not found' });
          return;
        }

        // Generate new filename
        const ext = path.extname(filename);
        const baseName = path.basename(filename, ext);
        let copyNumber = 1;
        let newFilename = `${baseName}-copy${ext}`;
        let newPath = path.join(this.config.disksDir, newFilename);

        // Find available filename
        while (existsSync(newPath)) {
          copyNumber++;
          newFilename = `${baseName}-copy${copyNumber}${ext}`;
          newPath = path.join(this.config.disksDir, newFilename);
        }

        // Copy the file
        await fs.copyFile(sourcePath, newPath);

        res.json({ success: true, filename: newFilename });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Create new blank disk image
    this.app.post('/api/images/create', async (req: Request, res: Response): Promise<void> => {
      try {
        const { filename, format, extension } = req.body;

        // Validate required parameters
        if (!filename || !format || !extension) {
          res.status(400).json({ error: 'Filename, format, and extension are required' });
          return;
        }

        // Validate filename (prevent path traversal, allow only safe characters)
        const safeFilenameRegex = /^[a-zA-Z0-9_\-. ]+$/;
        if (!safeFilenameRegex.test(filename)) {
          res.status(400).json({
            error: 'Invalid filename. Only letters, numbers, spaces, underscores, hyphens, and periods allowed.',
          });
          return;
        }

        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
          res.status(400).json({ error: 'Invalid filename' });
          return;
        }

        // Validate extension
        const validExtensions = ['.dsk', '.img', '.ima'];
        if (!validExtensions.includes(extension.toLowerCase())) {
          res.status(400).json({ error: 'Invalid extension. Must be .dsk, .img, or .ima' });
          return;
        }

        // Calculate disk size based on format
        const TRACK_SIZE = 137 * 32; // 4,384 bytes per track
        let trackCount: number;
        let formatLabel: string;

        switch (format) {
          case '8inch':
            trackCount = 77;
            formatLabel = '8-inch (330K)';
            break;
          case 'minidisk':
            trackCount = 17;
            formatLabel = 'Minidisk (75K)';
            break;
          case '8mb':
            trackCount = 1863;
            formatLabel = '8MB';
            break;
          default:
            res.status(400).json({ error: 'Invalid format. Must be 8inch, minidisk, or 8mb' });
            return;
        }

        const diskSize = trackCount * TRACK_SIZE;

        // Construct full filename and path
        const fullFilename = filename.endsWith(extension) ? filename : `${filename}${extension}`;
        const filePath = path.join(this.config.disksDir, fullFilename);

        // Check if file already exists
        if (existsSync(filePath)) {
          res.status(409).json({ error: 'File already exists' });
          return;
        }

        // Create blank disk image (all zeros)
        const zeroBuffer = Buffer.alloc(diskSize, 0);
        await fs.writeFile(filePath, zeroBuffer);

        res.json({
          success: true,
          filename: fullFilename,
          size: diskSize,
          format: formatLabel,
        });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Delete disk image
    this.app.delete('/api/images/:filename', async (req: Request, res: Response): Promise<void> => {
      try {
        const filename = req.params.filename;

        if (!filename) {
          res.status(400).json({ error: 'Filename is required' });
          return;
        }

        // Validate filename (prevent path traversal)
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
          res.status(400).json({ error: 'Invalid filename' });
          return;
        }

        const filePath = path.join(this.config.disksDir, filename);

        // Check if file exists
        if (!existsSync(filePath)) {
          res.status(404).json({ error: 'File not found' });
          return;
        }

        // Check if the file is currently mounted on any drive
        for (let i = 0; i < MAX_DRIVES; i++) {
          const driveState = this.driveManager.getDriveState(i);
          if (driveState && driveState.mounted && driveState.filename) {
            const mountedFilename = path.basename(driveState.filename);
            if (mountedFilename === filename) {
              res.status(409).json({
                error: `Cannot delete: File is currently mounted on drive ${i}`,
              });
              return;
            }
          }
        }

        // Delete the file
        await fs.unlink(filePath);

        // Also delete notes from database
        await this.database.deleteDiskNote(filename);

        res.json({ success: true, filename });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Update disk image notes/description
    this.app.put('/api/images/:filename/notes', async (req: Request, res: Response): Promise<void> => {
      try {
        const filename = req.params.filename;
        const { description, notes } = req.body;

        if (!filename) {
          res.status(400).json({ error: 'Filename is required' });
          return;
        }

        // Validate filename (prevent path traversal)
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
          res.status(400).json({ error: 'Invalid filename' });
          return;
        }

        // Check if file exists
        const filePath = path.join(this.config.disksDir, filename);
        if (!existsSync(filePath)) {
          res.status(404).json({ error: 'File not found' });
          return;
        }

        // Update notes in database
        await this.database.upsertDiskNote(
          filename,
          description || '',
          notes || ''
        );

        res.json({ success: true, filename });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Cassette API endpoints

    // Get detailed cassette information (with file sizes)
    this.app.get('/api/cassettes/details', async (_req: Request, res: Response): Promise<void> => {
      try {
        const cassettes = await this.listCassettesWithDetails();
        res.json({ cassettes });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Configure multer for cassette uploads
    const cassetteStorage = multer.diskStorage({
      destination: (_req, _file, cb) => {
        cb(null, this.config.cassettesDir);
      },
      filename: (_req, file, cb) => {
        // Use original filename
        cb(null, file.originalname);
      },
    });

    const cassetteUpload = multer({
      storage: cassetteStorage,
      fileFilter: (_req, file, cb) => {
        // Only accept .wav files
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.wav') {
          cb(null, true);
        } else {
          cb(new Error('Only .wav files are allowed'));
        }
      },
      limits: {
        fileSize: 100 * 1024 * 1024, // 100MB max file size for audio
      },
    });

    // Upload cassette
    this.app.post(
      '/api/cassettes/upload',
      cassetteUpload.single('cassette'),
      async (req: Request, res: Response): Promise<void> => {
        try {
          if (!req.file) {
            res.status(400).json({ error: 'No file uploaded' });
            return;
          }

          res.json({
            success: true,
            filename: req.file.filename,
            size: req.file.size,
          });
        } catch (error) {
          res.status(500).json({ error: (error as Error).message });
        }
      }
    );

    // Delete cassette
    this.app.delete('/api/cassettes/:filename', async (req: Request, res: Response): Promise<void> => {
      try {
        const filename = req.params.filename;

        if (!filename) {
          res.status(400).json({ error: 'Filename is required' });
          return;
        }

        // Validate filename (prevent path traversal)
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
          res.status(400).json({ error: 'Invalid filename' });
          return;
        }

        const filePath = path.join(this.config.cassettesDir, filename);

        // Check if file exists
        if (!existsSync(filePath)) {
          res.status(404).json({ error: 'File not found' });
          return;
        }

        // Delete the file
        await fs.unlink(filePath);

        // Also delete notes from database
        await this.database.deleteCassetteNote(filename);

        res.json({ success: true, filename });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Update cassette notes/description
    this.app.put('/api/cassettes/:filename/notes', async (req: Request, res: Response): Promise<void> => {
      try {
        const filename = req.params.filename;
        const { description, notes } = req.body;

        if (!filename) {
          res.status(400).json({ error: 'Filename is required' });
          return;
        }

        // Validate filename (prevent path traversal)
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
          res.status(400).json({ error: 'Invalid filename' });
          return;
        }

        // Check if file exists
        const filePath = path.join(this.config.cassettesDir, filename);
        if (!existsSync(filePath)) {
          res.status(404).json({ error: 'File not found' });
          return;
        }

        // Update notes in database
        await this.database.upsertCassetteNote(
          filename,
          description || '',
          notes || ''
        );

        res.json({ success: true, filename });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Stream cassette file for client-side playback
    this.app.get('/api/cassettes/:filename/stream', (req: Request, res: Response) => {
      try {
        const filename = req.params.filename;

        if (!filename) {
          res.status(400).json({ error: 'Filename is required' });
          return;
        }

        // Validate filename (prevent path traversal)
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
          res.status(400).json({ error: 'Invalid filename' });
          return;
        }

        const filePath = path.join(this.config.cassettesDir, filename);

        // Check if file exists
        if (!existsSync(filePath)) {
          res.status(404).json({ error: 'File not found' });
          return;
        }

        // Stream the file
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

        const stream = createReadStream(filePath);
        stream.pipe(res);

        stream.on('error', (err) => {
          console.error('Stream error:', err);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Error streaming file' });
          }
        });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Play cassette server-side
    this.app.post('/api/cassettes/:filename/play', (req: Request, res: Response) => {
      try {
        const filename = req.params.filename;

        if (!filename) {
          res.status(400).json({ error: 'Filename is required' });
          return;
        }

        // Validate filename (prevent path traversal)
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
          res.status(400).json({ error: 'Invalid filename' });
          return;
        }

        const filePath = path.join(this.config.cassettesDir, filename);

        // Check if file exists
        if (!existsSync(filePath)) {
          res.status(404).json({ error: 'File not found' });
          return;
        }

        // Stop any currently playing audio
        if (this.currentAudioProcess && this.currentAudioProcess.kill) {
          this.currentAudioProcess.kill();
          this.currentAudioProcess = null;
        }

        // Get audio player (lazy-loaded on first use)
        const audioPlayer = this.getAudioPlayer();

        // Play the audio file
        this.currentAudioProcess = audioPlayer.play(filePath, (err: any) => {
          if (err && !err.killed) {
            console.error('Audio playback error:', err);
          }
          this.currentAudioProcess = null;
        });

        res.json({ success: true, message: 'Playback started', filename });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Stop server-side playback
    this.app.post('/api/cassettes/stop', (_req: Request, res: Response) => {
      try {
        if (this.currentAudioProcess && this.currentAudioProcess.kill) {
          this.currentAudioProcess.kill();
          this.currentAudioProcess = null;
          res.json({ success: true, message: 'Playback stopped' });
        } else {
          res.json({ success: true, message: 'No audio playing' });
        }
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

        // Format port information for UI
        const formattedPorts = ports.map(port => ({
          path: port.path,
          resolvedPath: port.resolvedPath,
          persistentPaths: port.persistentPaths,
          manufacturer: port.metadata.manufacturer,
          serialNumber: port.metadata.serialNumber,
          pnpId: port.metadata.pnpId,
          vendorId: port.metadata.vendorId,
          productId: port.metadata.productId,
          // Recommend persistent path if available
          recommended: port.persistentPaths.byId || port.persistentPaths.byPath || port.path,
        }));

        res.json({ ports: formattedPorts });
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

    // Script API endpoints

    // List all scripts (all files in scripts dir)
    this.app.get('/api/scripts', async (_req: Request, res: Response): Promise<void> => {
      try {
        await fs.mkdir(this.config.scriptsDir, { recursive: true });
        const files = await fs.readdir(this.config.scriptsDir);
        // Return all files with name and size
        const scripts = await Promise.all(
          files.filter(f => !f.startsWith('.')).map(async (name) => {
            try {
              const stat = await fs.stat(path.join(this.config.scriptsDir, name));
              return { name, size: stat.size };
            } catch {
              return { name, size: 0 };
            }
          })
        );
        scripts.sort((a, b) => a.name.localeCompare(b.name));
        res.json({ scripts });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Get script content
    this.app.get('/api/scripts/:name', async (req: Request, res: Response): Promise<void> => {
      try {
        const name = req.params.name;

        if (!name) {
          res.status(400).json({ error: 'Invalid script name' });
          return;
        }

        // Validate filename (prevent path traversal)
        if (name.includes('..') || name.includes('/') || name.includes('\\')) {
          res.status(400).json({ error: 'Invalid script name' });
          return;
        }

        const scriptPath = path.join(this.config.scriptsDir, name);

        if (!existsSync(scriptPath)) {
          res.status(404).json({ error: 'Script not found' });
          return;
        }

        const stat = await fs.stat(scriptPath);

        // For text files, return content; for binary, return metadata only
        if (name.endsWith('.txt')) {
          const content = await fs.readFile(scriptPath, 'utf-8');
          res.json({ name, content, size: stat.size, binary: false });
        } else {
          res.json({ name, size: stat.size, binary: true });
        }
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Create new text script
    this.app.post('/api/scripts', async (req: Request, res: Response): Promise<void> => {
      try {
        const { name, content } = req.body;

        if (!name) {
          res.status(400).json({ error: 'Script name is required' });
          return;
        }

        // Validate filename (prevent path traversal)
        if (name.includes('..') || name.includes('/') || name.includes('\\')) {
          res.status(400).json({ error: 'Invalid script name' });
          return;
        }

        await fs.mkdir(this.config.scriptsDir, { recursive: true });

        const scriptPath = path.join(this.config.scriptsDir, name);

        if (existsSync(scriptPath)) {
          res.status(409).json({ error: 'Script already exists' });
          return;
        }

        await fs.writeFile(scriptPath, content || '', 'utf-8');
        res.json({ success: true, name });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Update script
    this.app.put('/api/scripts/:name', async (req: Request, res: Response): Promise<void> => {
      try {
        const name = req.params.name;
        const { content } = req.body;

        if (!name) {
          res.status(400).json({ error: 'Invalid script name' });
          return;
        }

        // Validate filename (prevent path traversal)
        if (name.includes('..') || name.includes('/') || name.includes('\\')) {
          res.status(400).json({ error: 'Invalid script name' });
          return;
        }

        const scriptPath = path.join(this.config.scriptsDir, name);

        if (!existsSync(scriptPath)) {
          res.status(404).json({ error: 'Script not found' });
          return;
        }

        await fs.writeFile(scriptPath, content || '', 'utf-8');
        res.json({ success: true, name });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Delete script
    this.app.delete('/api/scripts/:name', async (req: Request, res: Response): Promise<void> => {
      try {
        const name = req.params.name;

        if (!name) {
          res.status(400).json({ error: 'Invalid script name' });
          return;
        }

        // Validate filename (prevent path traversal)
        if (name.includes('..') || name.includes('/') || name.includes('\\')) {
          res.status(400).json({ error: 'Invalid script name' });
          return;
        }

        const scriptPath = path.join(this.config.scriptsDir, name);

        if (!existsSync(scriptPath)) {
          res.status(404).json({ error: 'Script not found' });
          return;
        }

        await fs.unlink(scriptPath);
        res.json({ success: true, name });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Script file upload (any file type, stored in scripts dir)
    const scriptUploadStorage = multer.diskStorage({
      destination: async (_req, _file, cb) => {
        await fs.mkdir(this.config.scriptsDir, { recursive: true });
        cb(null, this.config.scriptsDir);
      },
      filename: (_req, file, cb) => {
        cb(null, file.originalname);
      },
    });

    const scriptUpload = multer({
      storage: scriptUploadStorage,
      fileFilter: (_req, file, cb) => {
        // Validate filename (prevent path traversal)
        if (file.originalname.includes('..') || file.originalname.includes('/') || file.originalname.includes('\\')) {
          cb(new Error('Invalid filename'));
          return;
        }
        cb(null, true);
      },
      limits: {
        fileSize: 1 * 1024 * 1024, // 1MB max
      },
    });

    this.app.post(
      '/api/scripts/upload',
      scriptUpload.single('file'),
      async (req: Request, res: Response): Promise<void> => {
        try {
          if (!req.file) {
            res.status(400).json({ error: 'No file uploaded' });
            return;
          }

          res.json({
            success: true,
            name: req.file.filename,
            size: req.file.size,
          });
        } catch (error) {
          res.status(500).json({ error: (error as Error).message });
        }
      }
    );

    // Replay API endpoints

    // Start raw replay or XMODEM send
    this.app.post('/api/replay/start', async (req: Request, res: Response): Promise<void> => {
      try {
        const { scriptName, mode, chunkSize, interByteDelayMs, interLineDelayMs, lineEnding, useCrc } = req.body;

        if (!scriptName) {
          res.status(400).json({ error: 'scriptName is required' });
          return;
        }

        // Check for active transfer
        if ((this.replayEngine && this.replayEngine.isRunning()) ||
            (this.xmodemSender && this.xmodemSender.isRunning())) {
          res.status(409).json({ error: 'A transfer is already in progress' });
          return;
        }

        // Validate filename
        if (scriptName.includes('..') || scriptName.includes('/') || scriptName.includes('\\')) {
          res.status(400).json({ error: 'Invalid script name' });
          return;
        }

        const filePath = path.join(this.config.scriptsDir, scriptName);
        if (!existsSync(filePath)) {
          res.status(404).json({ error: 'File not found' });
          return;
        }

        if (mode === 'xmodem') {
          this.startXmodemSend(filePath, scriptName, useCrc);
        } else {
          this.startRawReplay(filePath, scriptName, chunkSize, interByteDelayMs, interLineDelayMs, lineEnding);
        }

        res.json({ success: true, mode: mode || 'raw', scriptName });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    // Cancel active replay/xmodem
    this.app.post('/api/replay/cancel', (_req: Request, res: Response) => {
      if (this.replayEngine && this.replayEngine.isRunning()) {
        this.replayEngine.cancel();
        res.json({ success: true, message: 'Replay cancel requested' });
      } else if (this.xmodemSender && this.xmodemSender.isRunning()) {
        this.xmodemSender.cancel();
        res.json({ success: true, message: 'XMODEM cancel requested' });
      } else {
        res.json({ success: true, message: 'No active transfer' });
      }
    });

    // Get current transfer state
    this.app.get('/api/replay/status', (_req: Request, res: Response) => {
      if (this.replayEngine && this.replayEngine.isRunning()) {
        res.json({ active: true, mode: 'raw', progress: this.replayEngine.getLastProgress() });
      } else if (this.xmodemSender && this.xmodemSender.isRunning()) {
        res.json({ active: true, mode: 'xmodem', progress: this.xmodemSender.getLastProgress() });
      } else {
        // Return last progress if available (for recently completed transfers)
        const lastReplay = this.replayEngine?.getLastProgress();
        const lastXmodem = this.xmodemSender?.getLastProgress();
        const lastProgress = lastReplay || lastXmodem;
        res.json({ active: false, progress: lastProgress || null });
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

      // Replay Socket.IO handlers

      // Send current replay status on connect (if transfer is active)
      if (this.replayEngine && this.replayEngine.isRunning()) {
        const progress = this.replayEngine.getLastProgress();
        if (progress) {
          socket.emit('replay:status', { active: true, mode: 'raw', progress });
        }
      } else if (this.xmodemSender && this.xmodemSender.isRunning()) {
        const progress = this.xmodemSender.getLastProgress();
        if (progress) {
          socket.emit('replay:status', { active: true, mode: 'xmodem', progress });
        }
      }

      // Start replay/XMODEM via Socket.IO
      socket.on('replay:start', async (data: {
        scriptName: string;
        mode?: string;
        chunkSize?: number;
        interByteDelayMs?: number;
        interLineDelayMs?: number;
        lineEnding?: string;
        useCrc?: boolean;
      }) => {
        try {
          const { scriptName, mode, chunkSize, interByteDelayMs, interLineDelayMs, lineEnding, useCrc } = data;

          if (!scriptName) {
            socket.emit('replay:progress', {
              state: 'error', bytesSent: 0, totalBytes: 0,
              percentComplete: 0, fileName: '', error: 'scriptName is required',
            });
            return;
          }

          // Check for active transfer
          if ((this.replayEngine && this.replayEngine.isRunning()) ||
              (this.xmodemSender && this.xmodemSender.isRunning())) {
            socket.emit('replay:progress', {
              state: 'error', bytesSent: 0, totalBytes: 0,
              percentComplete: 0, fileName: scriptName, error: 'A transfer is already in progress',
            });
            return;
          }

          // Validate filename
          if (scriptName.includes('..') || scriptName.includes('/') || scriptName.includes('\\')) {
            socket.emit('replay:progress', {
              state: 'error', bytesSent: 0, totalBytes: 0,
              percentComplete: 0, fileName: scriptName, error: 'Invalid script name',
            });
            return;
          }

          const filePath = path.join(this.config.scriptsDir, scriptName);
          if (!existsSync(filePath)) {
            socket.emit('replay:progress', {
              state: 'error', bytesSent: 0, totalBytes: 0,
              percentComplete: 0, fileName: scriptName, error: 'File not found',
            });
            return;
          }

          if (mode === 'xmodem') {
            this.startXmodemSend(filePath, scriptName, useCrc);
          } else {
            this.startRawReplay(filePath, scriptName, chunkSize, interByteDelayMs, interLineDelayMs, lineEnding);
          }
        } catch (error) {
          socket.emit('replay:progress', {
            state: 'error', bytesSent: 0, totalBytes: 0,
            percentComplete: 0, fileName: data?.scriptName || '', error: (error as Error).message,
          });
        }
      });

      // Cancel active transfer via Socket.IO
      socket.on('replay:cancel', () => {
        this.cancelActiveTransfer();
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
        configuredPort: this.runtimeConfig?.port || this.serialManager.getDevice(),
        configuredBaudRate: this.runtimeConfig?.baud || this.serialManager.getBaudRate(),
      },
      diskServing: {
        enabled: this.diskServingEnabled,
        running: this.server !== null && this.serverTask !== null,
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
   * Enable disk serving - creates and starts FdcServer if needed
   */
  private async enableDiskServing(): Promise<void> {
    if (this.diskServingEnabled) {
      return; // Already enabled
    }

    // Ensure we have a port configured
    if (!this.runtimeConfig?.port && !this.serialManager.getDevice()) {
      throw new Error('No serial port configured. Please configure a port first.');
    }

    // Ensure serial port is open
    if (!this.serialManager.isOpen()) {
      const port = this.runtimeConfig?.port || this.serialManager.getDevice();
      const baud = this.runtimeConfig?.baud || this.serialManager.getBaudRate() || 230400;

      if (!port) {
        throw new Error('No serial port configured');
      }

      await this.serialManager.openPort(port, baud as any);
    }

    // Create FdcServer if it doesn't exist
    if (!this.server) {
      const { createDefaultConfig } = await import('./protocol');
      const config = createDefaultConfig();
      config.port = this.serialManager.getDevice() || null;
      config.baudRate = this.serialManager.getBaudRate() || 230400;
      config.verbose = this.runtimeConfig?.verbose || false;
      config.debug = this.runtimeConfig?.debug || false;

      this.server = new FdcServer(
        this.driveManager,
        this.serialManager,
        config
      );
    }

    // Start the server with error handling
    console.log('Starting FDC server for disk serving...');
    this.serverTask = this.server.start().catch((error) => {
      console.error('FDC server error:', error);
      this.serverTask = null;
      this.diskServingEnabled = false;
      this.broadcastStatus();
      // Don't rethrow here - just log and update state
    });

    this.diskServingEnabled = true;

    // Give it a moment to start
    await new Promise(resolve => setTimeout(resolve, 100));
    console.log('Disk serving enabled');
    this.broadcastStatus();
  }

  /**
   * Disable disk serving - stops FdcServer and closes serial port
   */
  private async disableDiskServing(): Promise<void> {
    if (!this.diskServingEnabled) {
      return; // Already disabled
    }

    // Stop the server
    if (this.server) {
      this.server.stop();
      this.serverTask = null;
    }

    // Close the serial port
    await this.serialManager.closePort();

    this.diskServingEnabled = false;

    console.log('Disk serving disabled');
    this.broadcastStatus();
  }

  /**
   * Lazy-load audio player (only initialized when first needed)
   * Prevents ERR_INVALID_STATE errors on systems without audio support
   */
  private getAudioPlayer(): any {
    if (!this.audioPlayer) {
      try {
        this.audioPlayer = playSound({});
      } catch (error) {
        console.error('Failed to initialize audio player:', error);
        console.error('Server-side audio playback will not be available');
        // Return a dummy player that does nothing
        this.audioPlayer = {
          play: () => {
            throw new Error('Audio player initialization failed - playback not available');
          }
        };
      }
    }
    return this.audioPlayer;
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
   * List available disk images with file details (name, size, description, notes)
   */
  private async listDiskImagesWithDetails(): Promise<Array<{ name: string; size: number; description: string; notes: string }>> {
    try {
      // Ensure disks directory exists
      await fs.mkdir(this.config.disksDir, { recursive: true });

      const files = await fs.readdir(this.config.disksDir);

      // Filter for disk image files
      const diskFiles = files.filter((file) =>
        file.match(/\.(dsk|img|ima)$/i)
      );

      // Get all notes from database
      const notesMap = await this.database.getAllDiskNotes();

      // Get file stats for each disk image
      const fileDetails = await Promise.all(
        diskFiles.map(async (file) => {
          try {
            const filePath = path.join(this.config.disksDir, file);
            const stats = await fs.stat(filePath);
            const note = notesMap.get(file);
            return {
              name: file,
              size: stats.size,
              description: note?.description || '',
              notes: note?.notes || '',
            };
          } catch (error) {
            console.error(`Error getting stats for ${file}:`, error);
            return {
              name: file,
              size: 0,
              description: '',
              notes: '',
            };
          }
        })
      );

      // Sort by name
      return fileDetails.sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      console.error('Error listing disk images with details:', error);
      return [];
    }
  }

  /**
   * List available cassettes with file details (name, size, duration, description, notes)
   */
  private async listCassettesWithDetails(): Promise<Array<{ name: string; size: number; duration?: number; description: string; notes: string }>> {
    try {
      // Ensure cassettes directory exists
      await fs.mkdir(this.config.cassettesDir, { recursive: true });

      const files = await fs.readdir(this.config.cassettesDir);

      // Filter for WAV files
      const wavFiles = files.filter((file) =>
        file.match(/\.wav$/i)
      );

      // Get all notes from database
      const notesMap = await this.database.getAllCassetteNotes();

      // Get file stats for each cassette
      const fileDetails = await Promise.all(
        wavFiles.map(async (file) => {
          try {
            const filePath = path.join(this.config.cassettesDir, file);
            const stats = await fs.stat(filePath);
            const note = notesMap.get(file);

            // Note: We're not parsing WAV headers for duration in this simple implementation
            // Duration could be added later by parsing the WAV file header
            return {
              name: file,
              size: stats.size,
              description: note?.description || '',
              notes: note?.notes || '',
            };
          } catch (error) {
            console.error(`Error getting stats for ${file}:`, error);
            return {
              name: file,
              size: 0,
              description: '',
              notes: '',
            };
          }
        })
      );

      // Sort by name
      return fileDetails.sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      console.error('Error listing cassettes with details:', error);
      return [];
    }
  }

  /**
   * Start a raw file replay via the replay engine.
   */
  private startRawReplay(
    filePath: string,
    fileName: string,
    chunkSize?: number,
    interByteDelayMs?: number,
    interLineDelayMs?: number,
    lineEnding?: string,
  ): void {
    if (!this.replayEngine) {
      this.replayEngine = new ReplayEngine(this.terminalManager);
      this.replayEngine.on('progress', (progress: ReplayProgress) => {
        this.io.emit('replay:progress', progress);
      });
    }

    this.replayEngine.replay({
      filePath,
      fileName,
      chunkSize,
      interByteDelayMs,
      interLineDelayMs,
      lineEnding: lineEnding as 'cr' | 'lf' | 'crlf' | 'raw' | undefined,
    }).catch((err) => {
      console.error('Replay error:', err);
    });
  }

  /**
   * Start an XMODEM file send.
   */
  private startXmodemSend(
    filePath: string,
    fileName: string,
    useCrc?: boolean,
  ): void {
    if (!this.xmodemSender) {
      this.xmodemSender = new XmodemSender(this.terminalManager);
      this.xmodemSender.on('progress', (progress: ReplayProgress) => {
        this.io.emit('replay:progress', progress);
      });
    }

    this.xmodemSender.send({
      filePath,
      fileName,
      useCrc,
    }).catch((err) => {
      console.error('XMODEM error:', err);
    });
  }

  /**
   * Cancel any active replay or XMODEM transfer.
   */
  public cancelActiveTransfer(): void {
    if (this.replayEngine && this.replayEngine.isRunning()) {
      this.replayEngine.cancel();
    }
    if (this.xmodemSender && this.xmodemSender.isRunning()) {
      this.xmodemSender.cancel();
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
    // Initialize database if not already initialized
    if (!this.database.isInitialized()) {
      try {
        await this.database.initialize();
      } catch (error) {
        console.error('Failed to initialize database:', error);
        throw error;
      }
    }

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
   * Start the FDC server (if one was provided in constructor)
   * Must be called after start() to begin disk serving
   */
  async startServer(): Promise<void> {
    if (!this.server) {
      throw new Error('No FDC server configured');
    }

    if (this.serverTask) {
      console.warn('FDC server is already running');
      return;
    }

    console.log('Starting FDC server...');
    this.serverTask = this.server.start().catch((error) => {
      console.error('FDC server error:', error);
      this.serverTask = null;
      this.diskServingEnabled = false;
      this.broadcastStatus();
      // Rethrow to propagate error
      throw error;
    });

    // Give it a moment to start
    await new Promise(resolve => setTimeout(resolve, 100));
    console.log('FDC server started');
    this.broadcastStatus();
  }

  /**
   * Stop the web server
   */
  async stop(): Promise<void> {
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = null;
    }

    // Disconnect all Socket.IO clients
    this.io.disconnectSockets(true);

    return new Promise((resolve) => {
      // Close HTTP server first
      this.httpServer.close(() => {
        // Then close Socket.IO
        this.io.close(() => {
          console.log('Web server stopped');
          resolve();
        });
      });
    });
  }
}
