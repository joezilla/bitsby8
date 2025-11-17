"use strict";
/**
 * FDC+ Serial Drive Server
 * Main server loop and command processing
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FdcServer = void 0;
const protocol_1 = require("./protocol");
/**
 * FDC+ Server
 */
class FdcServer {
    driveManager;
    serialManager;
    displayManager;
    running;
    verbose;
    debug;
    constructor(driveManager, serialManager, displayManager, config) {
        this.driveManager = driveManager;
        this.serialManager = serialManager;
        this.displayManager = displayManager;
        this.running = false;
        this.verbose = config.verbose;
        this.debug = config.debug;
    }
    /**
     * Start the server
     */
    async start() {
        this.running = true;
        // Main command loop
        while (this.running) {
            try {
                // Wait for command from FDC+ (1 second timeout per iteration)
                const cmdBuffer = await this.serialManager.receiveBuffer(8, 1000);
                // Parse command
                const cmd = protocol_1.CommandResponseBlock.fromBuffer(cmdBuffer);
                // Display verbose info
                if (this.verbose) {
                    this.displayManager.displayBuffer('', cmdBuffer, 8);
                }
                // Process command
                await this.processCommand(cmd);
            }
            catch (error) {
                // Timeout is expected when no command is received
                if (error instanceof Error && error.message.includes('Timeout')) {
                    // Clear command display
                    this.displayManager.displayCommand('----');
                    this.displayManager.displayBlock(-1, -1, -1);
                }
                else {
                    // Log other errors
                    this.displayManager.displayError('Command receive error', error);
                }
            }
        }
    }
    /**
     * Stop the server
     */
    stop() {
        this.running = false;
    }
    /**
     * Toggle verbose mode
     */
    toggleVerbose() {
        this.verbose = !this.verbose;
    }
    /**
     * Process a command
     */
    async processCommand(cmd) {
        const command = cmd.getCommand();
        switch (command) {
            case protocol_1.FdcCommand.STAT:
                await this.handleStatCommand(cmd);
                break;
            case protocol_1.FdcCommand.READ:
                await this.handleReadCommand(cmd);
                break;
            case protocol_1.FdcCommand.WRIT:
                await this.handleWriteCommand(cmd);
                break;
            default:
                this.displayManager.displayError(`Unknown command: ${cmd.cmd}`, undefined);
                break;
        }
    }
    /**
     * Handle STAT command
     * Reports drive status and mounted disk state
     */
    async handleStatCommand(cmd) {
        this.displayManager.displayCommand('STAT');
        // Extract parameters
        // param1: LSB = drive, MSB = head load
        // param2: track number
        const drive = protocol_1.ByteUtils.LSB(cmd.param1);
        const headLoad = protocol_1.ByteUtils.MSB(cmd.param1);
        const track = cmd.param2;
        // Save head load status and track for drive
        if (drive < protocol_1.MAX_DRIVES) {
            const driveState = this.driveManager.getDriveState(drive);
            if (driveState) {
                driveState.hdld = headLoad !== 0;
                driveState.track = track;
                // Debug logging
                // console.error(`[DEBUG] STAT: drive=${drive}, hdld=${driveState.hdld}, track=${driveState.track}`);
                this.displayManager.displayHead(drive, driveState.hdld);
                this.displayManager.displayTrack(drive, driveState.track);
                this.displayManager.displayBlock(drive, driveState.track, -1);
            }
        }
        else {
            // Invalid drive - clear all head loads
            for (let i = 0; i < protocol_1.MAX_DRIVES; i++) {
                const driveState = this.driveManager.getDriveState(i);
                if (driveState) {
                    driveState.hdld = false;
                }
            }
            this.displayManager.displayHead(drive, false);
            this.displayManager.displayBlock(drive, -1, -1);
        }
        // Build status word (bit map of mounted drives)
        let statusData = 0;
        for (let i = 0; i < protocol_1.MAX_DRIVES; i++) {
            if (this.driveManager.isMounted(i)) {
                statusData |= 1 << i;
            }
        }
        // Update response
        cmd.param2 = statusData;
        // Display verbose info
        if (this.verbose) {
            this.displayManager.displayBuffer('', cmd.toBuffer(), 8);
        }
        // Send response
        await this.serialManager.sendBuffer(cmd.toBuffer(), protocol_1.TIMEOUT_BUFFER);
    }
    /**
     * Handle READ command
     * Reads track data from mounted disk image
     */
    async handleReadCommand(cmd) {
        this.displayManager.displayCommand('READ');
        // Extract parameters
        // param1: bits 0-11 = track, bits 12-15 = drive (high nibble of MSB)
        // param2: length
        const drive = protocol_1.ByteUtils.MSB(cmd.param1) >> 4;
        const track = cmd.param1 & 0x0fff;
        const length = cmd.param2;
        if (this.debug) {
            this.displayManager.displayDebug(`READ TRACK D:${drive.toString().padStart(2, '0')} ` +
                `T:${track.toString().padStart(2, '0')} ` +
                `L:${length.toString().padStart(4, '0')}`);
        }
        this.displayManager.displayBlock(drive, track, length);
        // Update drive track
        if (drive < protocol_1.MAX_DRIVES) {
            const driveState = this.driveManager.getDriveState(drive);
            if (driveState) {
                driveState.track = track;
                // Debug logging
                // console.error(`[DEBUG] READ: drive=${drive}, track=${driveState.track}, length=${length}`);
            }
        }
        try {
            // Read track data
            const trackData = await this.driveManager.readTrack(drive, track, length);
            // Display verbose info
            if (this.verbose) {
                this.displayManager.displayBuffer('', trackData, length);
            }
            // Send track data
            await this.serialManager.sendBuffer(trackData, protocol_1.TIMEOUT_BUFFER);
        }
        catch (error) {
            this.displayManager.displayError('Read track error', error);
        }
    }
    /**
     * Handle WRIT command
     * Writes track data to mounted disk image
     */
    async handleWriteCommand(cmd) {
        this.displayManager.displayCommand('WRIT');
        // Extract parameters (same as READ)
        const drive = protocol_1.ByteUtils.MSB(cmd.param1) >> 4;
        const track = cmd.param1 & 0x0fff;
        const length = cmd.param2;
        this.displayManager.displayBlock(drive, track, length);
        // Check if drive is valid
        if (drive >= protocol_1.MAX_DRIVES) {
            await this.sendWriteResponse(cmd, protocol_1.FdcError.NOT_READY);
            return;
        }
        // Update drive track
        const driveState = this.driveManager.getDriveState(drive);
        if (driveState) {
            driveState.track = track;
        }
        // Send initial OK response
        await this.sendWriteResponse(cmd, protocol_1.FdcError.OK);
        try {
            // Wait for track data
            const trackData = await this.serialManager.receiveBuffer(length, protocol_1.TIMEOUT_BUFFER);
            // Display verbose info
            if (this.verbose) {
                this.displayManager.displayBuffer('', trackData, length);
            }
            // Write track to disk
            await this.driveManager.writeTrack(drive, track, length, trackData);
            // Send WSTA (write status) response
            cmd.cmd = 'WSTA';
            await this.sendWriteResponse(cmd, protocol_1.FdcError.OK);
        }
        catch (error) {
            // Send error response
            this.displayManager.displayError('Write track error', error);
            cmd.cmd = 'WSTA';
            await this.sendWriteResponse(cmd, this.driveManager.fdcErrno);
        }
    }
    /**
     * Send write response
     */
    async sendWriteResponse(cmd, response) {
        cmd.param1 = response;
        // Display verbose info
        if (this.verbose) {
            this.displayManager.displayBuffer('', cmd.toBuffer(), 8);
        }
        // Send response
        await this.serialManager.sendBuffer(cmd.toBuffer(), protocol_1.TIMEOUT_BUFFER);
    }
}
exports.FdcServer = FdcServer;
//# sourceMappingURL=server.js.map