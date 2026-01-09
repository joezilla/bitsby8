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
  private errorCallback: ((error: Error) => void) | null;
  private closeCallback: (() => void) | null;

  constructor() {
    this.port = null;
    this.device = null;
    this.resolvedDevice = null;
    this.persistentPaths = {};
    this.config = { ...DEFAULT_TERMINAL_CONFIG };
    this.dataCallback = null;
    this.errorCallback = null;
    this.closeCallback = null;
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

      // Setup data handler - forward all incoming data to callback
      this.port.on('data', (data: Buffer) => {
        // Blink RX LED
        getGpioLedController().updateTerminalRx();

        if (this.dataCallback) {
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
   * Write data to serial port
   */
  async write(data: Buffer | string): Promise<void> {
    if (!this.port || !this.port.isOpen) {
      throw new Error('Serial port not open');
    }

    // Blink TX LED
    getGpioLedController().updateTerminalTx();

    return new Promise((resolve, reject) => {
      this.port!.write(data, (error) => {
        if (error) {
          reject(error);
        } else {
          this.port!.drain((drainError) => {
            if (drainError) {
              reject(drainError);
            } else {
              resolve();
            }
          });
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
