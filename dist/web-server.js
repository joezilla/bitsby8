"use strict";
/**
 * Web Server Module
 * Provides REST API and WebSocket interface for remote management
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebServer = void 0;
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs/promises"));
const terminal_serial_1 = require("./terminal-serial");
const protocol_1 = require("./protocol");
class WebServer {
    app;
    httpServer;
    io;
    config;
    driveManager;
    serialManager;
    terminalManager;
    preferredTerminalSettings;
    statusInterval = null;
    constructor(config, driveManager, serialManager, terminalManager, preferredTerminalSettings) {
        this.config = config;
        this.driveManager = driveManager;
        this.serialManager = serialManager;
        this.terminalManager = terminalManager;
        this.preferredTerminalSettings = preferredTerminalSettings || {};
        // Create Express app
        this.app = (0, express_1.default)();
        this.httpServer = (0, http_1.createServer)(this.app);
        // Create Socket.IO server
        this.io = new socket_io_1.Server(this.httpServer, {
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
    setupMiddleware() {
        this.app.use((0, cors_1.default)());
        this.app.use(express_1.default.json());
        this.app.use(express_1.default.static(path.join(__dirname, '../public')));
    }
    /**
     * Setup REST API routes
     */
    setupRoutes() {
        // Health check
        this.app.get('/api/health', (_req, res) => {
            res.json({ status: 'ok', timestamp: new Date().toISOString() });
        });
        // Get server status
        this.app.get('/api/status', (_req, res) => {
            res.json(this.getStatus());
        });
        // Get drive status
        this.app.get('/api/drives', (_req, res) => {
            res.json(this.getDrivesStatus());
        });
        // Mount disk image to drive
        this.app.post('/api/drives/:id/mount', async (req, res) => {
            try {
                const driveId = parseInt(req.params.id);
                const { filename } = req.body;
                if (!filename) {
                    res.status(400).json({ error: 'Filename is required' });
                    return;
                }
                if (driveId < 0 || driveId >= protocol_1.MAX_DRIVES) {
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
            }
            catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        // Unmount drive
        this.app.post('/api/drives/:id/unmount', async (req, res) => {
            try {
                const driveId = parseInt(req.params.id);
                if (driveId < 0 || driveId >= protocol_1.MAX_DRIVES) {
                    res.status(400).json({ error: 'Invalid drive ID' });
                    return;
                }
                await this.driveManager.unmountDrive(driveId);
                // Broadcast status update
                this.broadcastStatus();
                res.json({ success: true, drive: driveId });
            }
            catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        // Set drive read-only status
        this.app.put('/api/drives/:id/readonly', (req, res) => {
            try {
                const driveId = parseInt(req.params.id);
                const { readonly } = req.body;
                if (driveId < 0 || driveId >= protocol_1.MAX_DRIVES) {
                    res.status(400).json({ error: 'Invalid drive ID' });
                    return;
                }
                this.driveManager.writeProtect(driveId, readonly);
                // Broadcast status update
                this.broadcastStatus();
                res.json({ success: true, drive: driveId, readonly });
            }
            catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        // List available disk images
        this.app.get('/api/images', async (_req, res) => {
            try {
                const images = await this.listDiskImages();
                res.json({ images });
            }
            catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        // Terminal API endpoints
        // Get terminal status
        this.app.get('/api/terminal/status', (_req, res) => {
            res.json(this.getTerminalStatus());
        });
        // List available serial ports
        this.app.get('/api/terminal/ports', async (_req, res) => {
            try {
                const ports = await terminal_serial_1.TerminalSerialManager.listPorts();
                res.json({ ports });
            }
            catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        // Open terminal serial port
        this.app.post('/api/terminal/open', async (req, res) => {
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
            }
            catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        // Close terminal serial port
        this.app.post('/api/terminal/close', async (_req, res) => {
            try {
                await this.terminalManager.closePort();
                // Broadcast terminal status update
                this.io.emit('terminal:status', this.getTerminalStatus());
                res.json({ success: true });
            }
            catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        // Update terminal configuration
        this.app.put('/api/terminal/config', async (req, res) => {
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
            }
            catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        // Serve the web interface
        this.app.get('/', (_req, res) => {
            res.sendFile(path.join(__dirname, '../public/index.html'));
        });
    }
    /**
     * Setup WebSocket handlers
     */
    setupWebSocket() {
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
            socket.on('terminal:write', async (data) => {
                try {
                    if (this.terminalManager.isOpen()) {
                        await this.terminalManager.write(Buffer.from(data));
                    }
                }
                catch (error) {
                    socket.emit('terminal:error', { message: error.message });
                }
            });
            // Handle terminal control signals
            socket.on('terminal:control', async (signal) => {
                try {
                    if (this.terminalManager.isOpen()) {
                        if (signal.type === 'dtr') {
                            await this.terminalManager.setDTR(signal.value);
                        }
                        else if (signal.type === 'rts') {
                            await this.terminalManager.setRTS(signal.value);
                        }
                    }
                }
                catch (error) {
                    socket.emit('terminal:error', { message: error.message });
                }
            });
        });
        // Setup terminal data handler to broadcast incoming serial data to all clients
        this.terminalManager.onData((data) => {
            this.io.emit('terminal:data', Array.from(data));
        });
        // Setup terminal error handler
        this.terminalManager.onError((error) => {
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
    getStatus() {
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
    getDrivesStatus() {
        const drives = [];
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
    getTerminalStatus() {
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
    async listDiskImages() {
        try {
            // Ensure disks directory exists
            await fs.mkdir(this.config.disksDir, { recursive: true });
            const files = await fs.readdir(this.config.disksDir);
            // Filter for disk image files
            return files.filter((file) => file.match(/\.(dsk|img|ima)$/i)).sort();
        }
        catch (error) {
            console.error('Error listing disk images:', error);
            return [];
        }
    }
    /**
     * Broadcast status update to all connected clients
     */
    broadcastStatus() {
        this.io.emit('status', this.getStatus());
    }
    /**
     * Start the web server
     */
    async start() {
        return new Promise((resolve, reject) => {
            try {
                this.httpServer.listen(this.config.port, this.config.host, () => {
                    console.log(`Web interface available at http://${this.config.host}:${this.config.port}`);
                    // Start periodic status broadcasting
                    this.statusInterval = setInterval(() => {
                        this.broadcastStatus();
                    }, 1000); // Update every second
                    resolve();
                });
            }
            catch (error) {
                reject(error);
            }
        });
    }
    /**
     * Stop the web server
     */
    async stop() {
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
exports.WebServer = WebServer;
//# sourceMappingURL=web-server.js.map