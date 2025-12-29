/**
 * FDC+ Serial Drive Server
 * Main server loop and command processing
 */

import {
  CommandResponseBlock,
  FdcCommand,
  FdcError,
  Config,
  MAX_DRIVES,
  ByteUtils,
  TIMEOUT_BUFFER,
} from './protocol';
import { DriveManager } from './drive';
import { SerialPortManager } from './serial';
import { DisplayManager } from './ui/display';
import { getGpioLedController } from './gpio';

/**
 * FDC+ Server
 */
export class FdcServer {
  private driveManager: DriveManager;
  private serialManager: SerialPortManager;
  private displayManager: DisplayManager;
  private running: boolean;
  private verbose: boolean;
  private debug: boolean;
  private paused: boolean;
  private serialUnavailableNotified: boolean;

  constructor(
    driveManager: DriveManager,
    serialManager: SerialPortManager,
    displayManager: DisplayManager,
    config: Config
  ) {
    this.driveManager = driveManager;
    this.serialManager = serialManager;
    this.displayManager = displayManager;
    this.running = false;
    this.verbose = config.verbose;
    this.debug = config.debug;
    this.paused = false;
    this.serialUnavailableNotified = false;
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    this.running = true;

    // Main command loop
    while (this.running) {
      if (this.paused) {
        await new Promise(resolve => setTimeout(resolve, 50));
        continue;
      }
      if (!this.serialManager.isOpen()) {
        if (!this.serialUnavailableNotified) {
          this.displayManager.displayError('Serial port not open (waiting for connection)');
          this.serialUnavailableNotified = true;
        }
        await new Promise(resolve => setTimeout(resolve, 200));
        continue;
      } else {
        this.serialUnavailableNotified = false;
      }
      try {
        // Wait for command from FDC+ (1 second timeout per iteration)
        const cmdBuffer = await this.serialManager.receiveBuffer(8, 1000);

        // Parse command
        const cmd = CommandResponseBlock.fromBuffer(cmdBuffer);

        // Display verbose info
        if (this.verbose) {
          this.displayManager.displayBuffer('', cmdBuffer, 8);
        }

        // Process command
        await this.processCommand(cmd);
      } catch (error) {
        // Timeout is expected when no command is received
        if (error instanceof Error && error.message.includes('Timeout')) {
          // Clear command display
          this.displayManager.displayCommand('----');
          this.displayManager.displayBlock(-1, -1, -1);

          // Add small delay to prevent busy-wait CPU spinning
          await new Promise(resolve => setTimeout(resolve, 10));
        } else {
          // Log other errors
          console.error('Command receive error:', error);
          this.displayManager.displayError(
            'Command receive error',
            error as NodeJS.ErrnoException
          );
        }
      }
    }
  }

  /**
   * Stop the server
   */
  stop(): void {
    this.running = false;
  }

  /**
   * Toggle verbose mode
   */
  toggleVerbose(): void {
    this.verbose = !this.verbose;
  }

  /**
   * Pause command handling (used during live reconfiguration)
   */
  pause(): void {
    this.paused = true;
  }

  /**
   * Resume command handling
   */
  resume(): void {
    this.paused = false;
  }

  /**
   * Process a command
   */
  private async processCommand(cmd: CommandResponseBlock): Promise<void> {
    const command = cmd.getCommand();

    switch (command) {
      case FdcCommand.STAT:
        await this.handleStatCommand(cmd);
        break;

      case FdcCommand.READ:
        await this.handleReadCommand(cmd);
        break;

      case FdcCommand.WRIT:
        await this.handleWriteCommand(cmd);
        break;

      default:
        this.displayManager.displayError(
          `Unknown command: ${cmd.cmd}`,
          undefined
        );
        break;
    }
  }

  /**
   * Handle STAT command
   * Reports drive status and mounted disk state
   */
  private async handleStatCommand(cmd: CommandResponseBlock): Promise<void> {
    this.displayManager.displayCommand('STAT');

    // Extract parameters
    // param1: LSB = drive, MSB = head load
    // param2: track number
    const drive = ByteUtils.LSB(cmd.param1);
    const headLoad = ByteUtils.MSB(cmd.param1);
    const track = cmd.param2;

    // Save head load status and track for drive
    if (drive < MAX_DRIVES) {
      const driveState = this.driveManager.getDriveState(drive);
      if (driveState) {
        driveState.hdld = headLoad !== 0;
        driveState.track = track;

        // Debug logging
        // console.error(`[DEBUG] STAT: drive=${drive}, hdld=${driveState.hdld}, track=${driveState.track}`);

        this.displayManager.displayHead(drive, driveState.hdld);
        this.displayManager.displayTrack(drive, driveState.track);
        this.displayManager.displayBlock(drive, driveState.track, -1);

        // Update GPIO LEDs
        getGpioLedController().updateDriveStatus(drive, driveState);
      }
    } else {
      // Invalid drive - clear all head loads
      for (let i = 0; i < MAX_DRIVES; i++) {
        const driveState = this.driveManager.getDriveState(i);
        if (driveState) {
          driveState.hdld = false;
          // Update GPIO LEDs
          getGpioLedController().updateDriveStatus(i, driveState);
        }
      }
      this.displayManager.displayHead(drive, false);
      this.displayManager.displayBlock(drive, -1, -1);
    }

    // Build status word (bit map of mounted drives)
    let statusData = 0;
    for (let i = 0; i < MAX_DRIVES; i++) {
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
    await this.serialManager.sendBuffer(cmd.toBuffer(), TIMEOUT_BUFFER);
  }

  /**
   * Handle READ command
   * Reads track data from mounted disk image
   */
  private async handleReadCommand(cmd: CommandResponseBlock): Promise<void> {
    this.displayManager.displayCommand('READ');

    // Flash activity LED
    getGpioLedController().updateDriveActivity();

    // Extract parameters
    // param1: bits 0-11 = track, bits 12-15 = drive (high nibble of MSB)
    // param2: length
    const drive = ByteUtils.MSB(cmd.param1) >> 4;
    const track = cmd.param1 & 0x0fff;
    const length = cmd.param2;

    if (this.debug) {
      this.displayManager.displayDebug(
        `READ TRACK D:${drive.toString().padStart(2, '0')} ` +
          `T:${track.toString().padStart(2, '0')} ` +
          `L:${length.toString().padStart(4, '0')}`
      );
    }

    this.displayManager.displayBlock(drive, track, length);

    // Update drive track
    if (drive < MAX_DRIVES) {
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
      await this.serialManager.sendBuffer(trackData, TIMEOUT_BUFFER);
    } catch (error) {
      console.error(`Read track error - Drive ${drive}, Track ${track}:`, error);
      this.displayManager.displayError(
        'Read track error',
        error as NodeJS.ErrnoException
      );
    }
  }

  /**
   * Handle WRIT command
   * Writes track data to mounted disk image
   */
  private async handleWriteCommand(cmd: CommandResponseBlock): Promise<void> {
    this.displayManager.displayCommand('WRIT');

    // Flash activity LED
    getGpioLedController().updateDriveActivity();

    // Extract parameters (same as READ)
    const drive = ByteUtils.MSB(cmd.param1) >> 4;
    const track = cmd.param1 & 0x0fff;
    const length = cmd.param2;

    this.displayManager.displayBlock(drive, track, length);

    // Check if drive is valid
    if (drive >= MAX_DRIVES) {
      await this.sendWriteResponse(cmd, FdcError.NOT_READY);
      return;
    }

    // Update drive track
    const driveState = this.driveManager.getDriveState(drive);
    if (driveState) {
      driveState.track = track;
    }

    // Send initial OK response
    await this.sendWriteResponse(cmd, FdcError.OK);

    try {
      // Wait for track data
      const trackData = await this.serialManager.receiveBuffer(
        length,
        TIMEOUT_BUFFER
      );

      // Display verbose info
      if (this.verbose) {
        this.displayManager.displayBuffer('', trackData, length);
      }

      // Write track to disk
      await this.driveManager.writeTrack(drive, track, length, trackData);

      // Send WSTA (write status) response
      cmd.cmd = 'WSTA';
      await this.sendWriteResponse(cmd, FdcError.OK);
    } catch (error) {
      // Send error response with detailed error information
      const errDetails = error instanceof Error
        ? { message: error.message, code: (error as any).code, stack: error.stack }
        : error;
      console.error(`Write track error - Drive ${drive}, Track ${track}, Length ${length}:`, errDetails);
      this.displayManager.displayError(
        'Write track error',
        error as NodeJS.ErrnoException
      );

      cmd.cmd = 'WSTA';
      await this.sendWriteResponse(cmd, this.driveManager.fdcErrno);
    }
  }

  /**
   * Send write response
   */
  private async sendWriteResponse(
    cmd: CommandResponseBlock,
    response: FdcError
  ): Promise<void> {
    cmd.param1 = response;

    // Display verbose info
    if (this.verbose) {
      this.displayManager.displayBuffer('', cmd.toBuffer(), 8);
    }

    // Send response
    await this.serialManager.sendBuffer(cmd.toBuffer(), TIMEOUT_BUFFER);
  }
}
