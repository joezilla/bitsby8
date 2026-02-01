/**
 * Terminal Serial Port Communication Module
 * Handles raw serial communication for VT102 terminal emulation
 */

import { SerialPort } from 'serialport';
import { getGpioLedController } from './gpio';
import { resolvePortPath, validatePortPath, listPortsWithPersistent, PortInfo } from './port-resolver';

/**
 * Terminal configuration interface
 */
export interface TerminalConfig {
  baudRate: 9600 | 19200 | 38400 | 57600 | 115200;
  dataBits: 5 | 6 | 7 | 8;
  stopBits: 1 | 2;
  parity: 'none' | 'even' | 'odd' | 'mark' | 'space';
  flowControl: 'none' | 'hardware' | 'software';
}

/**
 * Default terminal configuration
 */
export const DEFAULT_TERMINAL_CONFIG: TerminalConfig = {
  baudRate: 9600,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
  flowControl: 'none',
};

/**
 * Terminal Serial Port Manager
 * Provides raw serial port access for terminal emulation
 */
export class TerminalSerialManager {
  private port: SerialPort | null;
  private device: string | null;
  private resolvedDevice: string | null;
  private persistentPaths: { byId?: string; byPath?: string };
  private config: TerminalConfig;
  private dataCallback: ((data: Buffer) => void) | null;
  private dataInterceptor: ((data: Buffer) => void) | null;
  private errorCallback: ((error: Error) => void) | null;
  private closeCallback: (() => void) | null;
  private drainInProgress: boolean;

  constructor() {
    this.port = null;
    this.device = null;
    this.resolvedDevice = null;
    this.persistentPaths = {};
    this.config = { ...DEFAULT_TERMINAL_CONFIG };
    this.dataCallback = null;
    this.dataInterceptor = null;
    this.errorCallback = null;
    this.closeCallback = null;
    this.drainInProgress = false;
  }

  /**
   * Open terminal serial port
   */
  async openPort(device: string, config?: Partial<TerminalConfig>): Promise<void> {
    if (!device) {
      throw new Error('Device path is required');
    }

    if (this.port && this.port.isOpen) {
      throw new Error('Port is already open');
    }

    // Resolve and validate port path
    let portInfo;
    try {
      portInfo = await resolvePortPath(device);
    } catch (error) {
      throw new Error(`Failed to resolve port path ${device}: ${(error as Error).message}`);
    }

    // Check if port exists
    if (!portInfo.exists) {
      // Provide helpful error message with suggestions
      const validation = await validatePortPath(device);
      let errorMsg = `Port ${device} not found. Device may be unplugged or path may have changed.`;

      if (validation.suggestions && validation.suggestions.length > 0) {
        errorMsg += '\n\nAvailable ports:';
        const allPorts = await listPortsWithPersistent();
        for (const port of allPorts) {
          errorMsg += `\n  - ${port.path}`;
          if (port.metadata.manufacturer) {
            errorMsg += ` (${port.metadata.manufacturer})`;
          }
          if (port.persistentPaths.byId) {
            errorMsg += `\n    Persistent: ${port.persistentPaths.byId}`;
          }
        }
        errorMsg += '\n\nRecommendation: Update your config to use a persistent path (see above).';
      }

      throw new Error(errorMsg);
    }

    // Store both original and resolved paths
    this.device = device;
    this.resolvedDevice = portInfo.resolvedPath;
    this.persistentPaths = portInfo.persistentPaths;

    // Merge with default config
    this.config = { ...DEFAULT_TERMINAL_CONFIG, ...config };

    // Use resolved path for actual device opening
    const devicePath = portInfo.resolvedPath;

    return new Promise((resolve, reject) => {
      // Convert flow control to SerialPort options
      const flowControlOptions = this.getFlowControlOptions();

      this.port = new SerialPort(
        {
          path: devicePath,
          baudRate: this.config.baudRate,
          dataBits: this.config.dataBits,
          stopBits: this.config.stopBits,
          parity: this.config.parity,
          ...flowControlOptions,
          autoOpen: true,
          lock: false,
        },
        (error) => {
          if (error) {
            // Enhanced error handling
            if ((error as NodeJS.ErrnoException).code === 'EACCES') {
              reject(new Error(
                `Permission denied accessing ${devicePath}.\n` +
                `Run: sudo usermod -a -G dialout $USER\n` +
                `Then log out and back in.`
              ));
            } else {
              reject(error);
            }
          } else {
            // Update GPIO connected status
            getGpioLedController().updateTerminalConnected(true);
            resolve();
          }
        }
      );

      // Setup data handler - forward incoming data to interceptor or callback
      this.port.on('data', (data: Buffer) => {
        // Blink RX LED
        getGpioLedController().updateTerminalRx();

        if (this.dataInterceptor) {
          this.dataInterceptor(data);
        } else if (this.dataCallback) {
          this.dataCallback(data);
        }
      });

      // Setup error handler
      this.port.on('error', (err) => {
        console.error('Terminal serial port error:', err);
        if (this.errorCallback) {
          this.errorCallback(err);
        }
      });

      // Setup close handler
      this.port.on('close', () => {
        if (this.closeCallback) {
          this.closeCallback();
        }
      });
    });
  }

  /**
   * Close terminal serial port
   */
  async closePort(): Promise<void> {
    if (!this.port || !this.port.isOpen) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.port!.close((error) => {
        if (error) {
          reject(error);
        } else {
          this.port = null;
          // Update GPIO connected status
          getGpioLedController().updateTerminalConnected(false);
          resolve();
        }
      });
    });
  }

  /**
   * Write data to serial port.
   * @param drain  Wait for the OS transmit buffer to empty before resolving.
   *               Defaults to true.  Pass false when the caller handles its
   *               own pacing (e.g. baud-rate-timed replay) — some USB serial
   *               drivers stall on drain() when no new data is being written.
   */
  async write(data: Buffer | string, drain: boolean = true): Promise<void> {
    if (!this.port || !this.port.isOpen) {
      throw new Error('Serial port not open');
    }

    // Blink TX LED
    getGpioLedController().updateTerminalTx();

    const len = Buffer.isBuffer(data) ? data.length : data.length;
    const t0 = Date.now();

    return new Promise((resolve, reject) => {
      const streamOk = this.port!.write(data, (error) => {
        const cbMs = Date.now() - t0;
        if (error) {
          console.log(`[SERIAL ${Date.now()}] WRITE-CB len=${len} drain=${drain} err=${error.message} took=${cbMs}ms`);
          reject(error);
        } else if (drain) {
          const drainT0 = Date.now();
          this.port!.drain((drainError) => {
            const drainMs = Date.now() - drainT0;
            if (drainError) {
              console.log(`[SERIAL ${Date.now()}] WRITE-DRAIN-ERR len=${len} writeCb=${cbMs}ms drainErr=${drainError.message} drainTook=${drainMs}ms`);
              reject(drainError);
            } else {
              console.log(`[SERIAL ${Date.now()}] WRITE-DRAIN-OK len=${len} writeCb=${cbMs}ms drainTook=${drainMs}ms`);
              resolve();
            }
          });
        } else {
          if (cbMs > 50) {
            console.log(`[SERIAL ${Date.now()}] WRITE-CB-SLOW len=${len} drain=false took=${cbMs}ms streamOk=${streamOk}`);
          }
          resolve();
        }
      });

      if (!streamOk) {
        console.log(`[SERIAL ${Date.now()}] WRITE-BACKPRESSURE len=${len} drain=${drain} — stream returned false`);
      }
    });
  }

  /**
   * Drain the serial port output buffer with a timeout.
   * Calls tcdrain() to signal the OS/USB driver to flush pending data.
   * Only one drain may be in-flight at a time to prevent worker thread
   * exhaustion (tcdrain blocks a libuv worker thread until complete).
   * Returns true if drain completed, false if timed out or skipped.
   */
  async drain(timeoutMs: number = 5000): Promise<boolean> {
    if (!this.port || !this.port.isOpen) {
      console.log(`[SERIAL ${Date.now()}] DRAIN-SKIP port not open`);
      return false;
    }
    if (this.drainInProgress) {
      console.log(`[SERIAL ${Date.now()}] DRAIN-SKIP already in progress`);
      return false;
    }

    this.drainInProgress = true;
    const t0 = Date.now();

    return new Promise<boolean>((resolve) => {
      let completed = false;

      const timer = setTimeout(() => {
        if (!completed) {
          completed = true;
          console.log(`[SERIAL ${Date.now()}] DRAIN-TIMEOUT timeout=${timeoutMs}ms elapsed=${Date.now() - t0}ms`);
          // drain is still running in background — drainInProgress stays
          // true until the underlying tcdrain() finishes
          resolve(false);
        }
      }, timeoutMs);

      this.port!.drain((error) => {
        const elapsed = Date.now() - t0;
        this.drainInProgress = false;
        if (!completed) {
          completed = true;
          clearTimeout(timer);
          if (error) {
            console.log(`[SERIAL ${Date.now()}] DRAIN-ERR err=${error.message} took=${elapsed}ms`);
          } else {
            console.log(`[SERIAL ${Date.now()}] DRAIN-OK took=${elapsed}ms`);
          }
          resolve(!error);
        } else {
          // Drain completed after timeout
          console.log(`[SERIAL ${Date.now()}] DRAIN-LATE-COMPLETE took=${elapsed}ms (timed out at ${timeoutMs}ms)`);
        }
      });
    });
  }

  /**
   * Update port configuration (requires close and reopen)
   */
  async updateConfig(config: Partial<TerminalConfig>): Promise<void> {
    const wasOpen = this.isOpen();
    const device = this.device;

    if (wasOpen && device) {
      await this.closePort();
    }

    this.config = { ...this.config, ...config };

    if (wasOpen && device) {
      await this.openPort(device, this.config);
    }
  }

  /**
   * Set data callback for incoming data
   */
  onData(callback: (data: Buffer) => void): void {
    this.dataCallback = callback;
  }

  /**
   * Set error callback
   */
  onError(callback: (error: Error) => void): void {
    this.errorCallback = callback;
  }

  /**
   * Set close callback
   */
  onClose(callback: () => void): void {
    this.closeCallback = callback;
  }

  /**
   * Set a data interceptor that captures incoming serial data instead of the normal callback.
   * Used by XMODEM sender to read ACK/NAK responses during file transfer.
   */
  setDataInterceptor(fn: (data: Buffer) => void): void {
    this.dataInterceptor = fn;
  }

  /**
   * Clear the data interceptor, restoring normal data callback behavior.
   */
  clearDataInterceptor(): void {
    this.dataInterceptor = null;
  }

  /**
   * Check if port is open
   */
  isOpen(): boolean {
    return this.port !== null && this.port.isOpen;
  }

  /**
   * Get device path (original configured path)
   */
  getDevice(): string | null {
    return this.device;
  }

  /**
   * Get resolved device path (actual device after symlink resolution)
   */
  getResolvedDevice(): string | null {
    return this.resolvedDevice;
  }

  /**
   * Get persistent paths for current device
   */
  getPersistentPaths(): { byId?: string; byPath?: string } {
    return this.persistentPaths;
  }

  /**
   * Get current configuration
   */
  getConfig(): TerminalConfig {
    return { ...this.config };
  }

  /**
   * List available serial ports with persistent path information
   */
  static async listPorts(): Promise<PortInfo[]> {
    return listPortsWithPersistent();
  }

  /**
   * Set DTR (Data Terminal Ready) signal
   */
  async setDTR(value: boolean): Promise<void> {
    if (!this.port || !this.port.isOpen) {
      throw new Error('Serial port not open');
    }

    return new Promise((resolve, reject) => {
      this.port!.set({ dtr: value }, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Set RTS (Request To Send) signal
   */
  async setRTS(value: boolean): Promise<void> {
    if (!this.port || !this.port.isOpen) {
      throw new Error('Serial port not open');
    }

    return new Promise((resolve, reject) => {
      this.port!.set({ rts: value }, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Get flow control options for SerialPort constructor
   */
  private getFlowControlOptions(): { rtscts: boolean; xon: boolean; xoff: boolean } {
    switch (this.config.flowControl) {
      case 'hardware':
        return { rtscts: true, xon: false, xoff: false };
      case 'software':
        return { rtscts: false, xon: true, xoff: true };
      case 'none':
      default:
        return { rtscts: false, xon: false, xoff: false };
    }
  }
}

/**
 * Global terminal serial port manager instance (singleton)
 */
let terminalSerialManagerInstance: TerminalSerialManager | null = null;

export function getTerminalSerialManager(): TerminalSerialManager {
  if (!terminalSerialManagerInstance) {
    terminalSerialManagerInstance = new TerminalSerialManager();
  }
  return terminalSerialManagerInstance;
}
