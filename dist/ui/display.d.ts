/**
 * Terminal UI Display Module
 * Uses blessed library for ncurses-like terminal UI
 */
/**
 * Display Manager for terminal UI
 */
export declare class DisplayManager {
    private screen;
    private boxes;
    constructor();
    /**
     * Initialize the display
     */
    init(): void;
    /**
     * Reset display (restore terminal)
     */
    reset(): void;
    /**
     * Get keyboard input (non-blocking)
     */
    getKey(): string | null;
    /**
     * Display port info
     */
    displayPort(portPath: string): void;
    /**
     * Display baud rate
     */
    displayBaud(baud: number): void;
    /**
     * Display current command
     */
    displayCommand(cmd: string): void;
    /**
     * Display block information (drive, track, length)
     */
    displayBlock(drive: number, track: number, length: number): void;
    /**
     * Display error message
     */
    displayError(message: string, errno?: NodeJS.ErrnoException): void;
    /**
     * Clear error message
     */
    clearError(): void;
    /**
     * Display debug message
     */
    displayDebug(message: string): void;
    /**
     * Display head status for a drive
     */
    displayHead(drive: number, headLoaded: boolean): void;
    /**
     * Display current track for a drive
     */
    displayTrack(drive: number, track: number): void;
    /**
     * Display mounted disk file for a drive
     */
    displayMount(drive: number, filename: string | null): void;
    /**
     * Display read-only status for a drive
     */
    displayRO(drive: number, readonly: boolean): void;
    /**
     * Display buffer contents (hex dump)
     */
    displayBuffer(label: string, buffer: Buffer, length: number): void;
    /**
     * Render the screen
     */
    private render;
}
export declare function getDisplayManager(): DisplayManager;
//# sourceMappingURL=display.d.ts.map