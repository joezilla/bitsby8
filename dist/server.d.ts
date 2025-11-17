/**
 * FDC+ Serial Drive Server
 * Main server loop and command processing
 */
import { Config } from './protocol';
import { DriveManager } from './drive';
import { SerialPortManager } from './serial';
import { DisplayManager } from './ui/display';
/**
 * FDC+ Server
 */
export declare class FdcServer {
    private driveManager;
    private serialManager;
    private displayManager;
    private running;
    private verbose;
    private debug;
    constructor(driveManager: DriveManager, serialManager: SerialPortManager, displayManager: DisplayManager, config: Config);
    /**
     * Start the server
     */
    start(): Promise<void>;
    /**
     * Stop the server
     */
    stop(): void;
    /**
     * Toggle verbose mode
     */
    toggleVerbose(): void;
    /**
     * Process a command
     */
    private processCommand;
    /**
     * Handle STAT command
     * Reports drive status and mounted disk state
     */
    private handleStatCommand;
    /**
     * Handle READ command
     * Reads track data from mounted disk image
     */
    private handleReadCommand;
    /**
     * Handle WRIT command
     * Writes track data to mounted disk image
     */
    private handleWriteCommand;
    /**
     * Send write response
     */
    private sendWriteResponse;
}
//# sourceMappingURL=server.d.ts.map