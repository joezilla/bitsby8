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
import { getGpioLedController } from './gpio';

/**
 * FDC+ Server
 */
export class FdcServer {
  private driveManager: DriveManager;
  private serialManager: SerialPortManager;
  private running: boolean;
  private verbose: boolean;
  private debug: boolean;
  private paused: boolean;
  private serialUnavailableNotified: boolean;

  constructor(
    driveManager: DriveManager,
    serialManager: SerialPortManager,
    config: Config
  ) {
    this.driveManager = driveManager;
    this.serialManager = serialManager;
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

    if (this.debug) {
      console.log('[DEBUG] FDC Server started, entering command loop');
    }

    // Main command loop
    while (this.running) {
      if (this.paused) {
        await new Promise(resolve => setTimeout(resolve, 50));
        continue;
      }
      if (!this.serialManager.isOpen()) {
        if (!this.serialUnavailableNotified) {
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

        // Process command
        await this.processCommand(cmd);
      } catch (error) {
        // Timeout is expected when no command is received
        if (error instanceof Error && error.message.includes('Timeout')) {
          // Add small delay to prevent busy-wait CPU spinning
          await new Promise(resolve => setTimeout(resolve, 10));
        } else {
          // Log other errors
          console.error('Command receive error:', error);
        }
      }
    }
  }

  /**
   * Stop the server
   */
  stop(): void {
    if (this.debug) {
      console.log('[DEBUG] FDC Server stopping');
    }
    this.running = false;
  }

  /**
   * Toggle verbose mode
   */
  toggleVerbose(): void {
    this.verbose = !this.verbose;
    if (this.debug) {
      console.log(`[DEBUG] Verbose mode toggled: ${this.verbose ? 'ON' : 'OFF'}`);
    }
  }

  /**
   * Pause command handling (used during live reconfiguration)
   */
  pause(): void {
    if (this.debug) {
      console.log('[DEBUG] FDC Server paused');
    }
    this.paused = true;
  }

  /**
   * Resume command handling
   */
  resume(): void {
    if (this.debug) {
      console.log('[DEBUG] FDC Server resumed');
    }
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
        console.error(`Unknown command: ${cmd.cmd}`);
        break;
    }
  }

  /**
   * Handle STAT command
   * Reports drive status and mounted disk state
   */
  private async handleStatCommand(cmd: CommandResponseBlock): Promise<void> {
    // Extract parameters
    // param1: LSB = drive, MSB = head load
    // param2: track number
    const drive = ByteUtils.LSB(cmd.param1);
    const headLoad = ByteUtils.MSB(cmd.param1);
    const track = cmd.param2;

    if (this.debug) {
      console.log(`[DEBUG] STAT command: drive=${drive}, headLoad=${headLoad}, track=${track}`);
    }

    // Save head load status and track for drive
    if (drive < MAX_DRIVES) {
      const driveState = this.driveManager.getDriveState(drive);
      if (driveState) {
        driveState.hdld = headLoad !== 0;
        driveState.track = track;

        if (this.debug) {
          console.log(`[DEBUG] STAT: drive=${drive}, hdld=${driveState.hdld}, track=${driveState.track}, mounted=${driveState.mounted}, readonly=${driveState.readonly}`);
        }

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

    // Send response
    await this.serialManager.sendBuffer(cmd.toBuffer(), TIMEOUT_BUFFER);
  }

  /**
   * Handle READ command
   * Reads track data from mounted disk image
   */
  private async handleReadCommand(cmd: CommandResponseBlock): Promise<void> {
    // Flash activity LED
    getGpioLedController().updateDriveActivity();

    // Extract parameters
    // param1: bits 0-11 = track, bits 12-15 = drive (high nibble of MSB)
    // param2: length
    const drive = ByteUtils.MSB(cmd.param1) >> 4;
    const track = cmd.param1 & 0x0fff;
    const length = cmd.param2;

    if (this.debug) {
      console.log(
        `[DEBUG] READ TRACK D:${drive.toString().padStart(2, '0')} ` +
          `T:${track.toString().padStart(2, '0')} ` +
          `L:${length.toString().padStart(4, '0')}`
      );
    }

    // Update drive track
    if (drive < MAX_DRIVES) {
      const driveState = this.driveManager.getDriveState(drive);
      if (driveState) {
        driveState.track = track;

        if (this.debug) {
          console.log(`[DEBUG] READ: drive=${drive}, track=${driveState.track}, length=${length}, mounted=${driveState.mounted}, filename=${driveState.filename}`);
        }
      }
    }

    try {
      // Read track data
      const trackData = await this.driveManager.readTrack(drive, track, length);

      if (this.debug) {
        console.log(`[DEBUG] READ completed: drive=${drive}, track=${track}, bytes read=${trackData.length}`);
      }

      // Send track data
      await this.serialManager.sendBuffer(trackData, TIMEOUT_BUFFER);
    } catch (error) {
      console.error(`Read track error - Drive ${drive}, Track ${track}:`, error);
    }
  }

  /**
   * Handle WRIT command
   * Writes track data to mounted disk image
   */
  private async handleWriteCommand(cmd: CommandResponseBlock): Promise<void> {
    // Flash activity LED
    getGpioLedController().updateDriveActivity();

    // Extract parameters (same as READ)
    const drive = ByteUtils.MSB(cmd.param1) >> 4;
    const track = cmd.param1 & 0x0fff;
    const length = cmd.param2;

    if (this.debug) {
      console.log(`[DEBUG] WRIT command: drive=${drive}, track=${track}, length=${length}`);
    }

    // Check if drive is valid
    if (drive >= MAX_DRIVES) {
      if (this.debug) {
        console.log(`[DEBUG] WRIT rejected: invalid drive ${drive} (>= MAX_DRIVES)`);
      }
      await this.sendWriteResponse(cmd, FdcError.NOT_READY);
      return;
    }

    // Update drive track
    const driveState = this.driveManager.getDriveState(drive);
    if (driveState) {
      driveState.track = track;
    }

    // Validate drive is writable before committing to receive data
    // This prevents EBADF errors after we've already told the FDC we're ready
    const canWrite = await this.driveManager.canWrite(drive);
    if (!canWrite) {
      console.warn(`WRIT command rejected - Drive ${drive} not writable (readonly=${driveState?.readonly}, mounted=${driveState?.mounted})`);
      if (this.debug) {
        console.log(`[DEBUG] WRIT rejected: drive ${drive} not writable, readonly=${driveState?.readonly}, mounted=${driveState?.mounted}, filename=${driveState?.filename}`);
      }
      await this.sendWriteResponse(cmd, FdcError.NOT_READY);
      return;
    }

    if (this.debug) {
      console.log(`[DEBUG] WRIT sending OK response, ready to receive ${length} bytes`);
    }

    // Send initial OK response - we're ready to receive track data
    await this.sendWriteResponse(cmd, FdcError.OK);

    try {
      // Wait for track data
      const trackData = await this.serialManager.receiveBuffer(
        length,
        TIMEOUT_BUFFER
      );

      if (this.debug) {
        console.log(`[DEBUG] WRIT received ${trackData.length} bytes of track data`);
      }

      // Write track to disk
      await this.driveManager.writeTrack(drive, track, length, trackData);

      if (this.debug) {
        console.log(`[DEBUG] WRIT completed: drive=${drive}, track=${track}, bytes written=${length}`);
      }

      // Send WSTA (write status) response
      cmd.cmd = 'WSTA';
      await this.sendWriteResponse(cmd, FdcError.OK);
    } catch (error) {
      // Send error response with detailed error information
      const errDetails = error instanceof Error
        ? { message: error.message, code: (error as any).code, stack: error.stack }
        : error;
      console.error(`Write track error - Drive ${drive}, Track ${track}, Length ${length}:`, errDetails);

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

    // Send response
    await this.serialManager.sendBuffer(cmd.toBuffer(), TIMEOUT_BUFFER);
  }
}
