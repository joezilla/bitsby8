/**
 * Web Server Module
 * Provides REST API and WebSocket interface for remote management
 */
import { DriveManager } from './drive';
import { SerialPortManager } from './serial';
export interface WebServerConfig {
    port: number;
    host: string;
    disksDir: string;
}
export declare class WebServer {
    private app;
    private httpServer;
    private io;
    private config;
    private driveManager;
    private serialManager;
    private statusInterval;
    constructor(config: WebServerConfig, driveManager: DriveManager, serialManager: SerialPortManager);
    /**
     * Setup Express middleware
     */
    private setupMiddleware;
    /**
     * Setup REST API routes
     */
    private setupRoutes;
    /**
     * Setup WebSocket handlers
     */
    private setupWebSocket;
    /**
     * Get current server status
     */
    private getStatus;
    /**
     * Get drives status
     */
    private getDrivesStatus;
    /**
     * List available disk images in disks directory
     */
    private listDiskImages;
    /**
     * Broadcast status update to all connected clients
     */
    broadcastStatus(): void;
    /**
     * Start the web server
     */
    start(): Promise<void>;
    /**
     * Stop the web server
     */
    stop(): Promise<void>;
}
//# sourceMappingURL=web-server.d.ts.map