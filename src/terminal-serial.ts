/**
 * Terminal Serial Port Communication Module
 * Handles raw serial communication for VT102 terminal emulation
 */

import { SerialPort } from 'serialport';
import { getGpioLedController } from './gpio';

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
  private config: TerminalConfig;
  private dataCallback: ((data: Buffer) => void) | null;
  private errorCallback: ((error: Error) => void) | null;
  private closeCallback: (() => void) | null;

  constructor() {
    this.port = null;
    this.device = null;
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

    // Merge with default config
    this.config = { ...DEFAULT_TERMINAL_CONFIG, ...config };
    this.device = device;

    return new Promise((resolve, reject) => {
      // Convert flow control to SerialPort options
      const flowControlOptions = this.getFlowControlOptions();

      this.port = new SerialPort(
        {
          path: device,
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
            reject(error);
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
   * Get device path
   */
  getDevice(): string | null {
    return this.device;
  }

  /**
   * Get current configuration
   */
  getConfig(): TerminalConfig {
    return { ...this.config };
  }

  /**
   * List available serial ports
   */
  static async listPorts(): Promise<Array<{ path: string; manufacturer?: string; serialNumber?: string; pnpId?: string }>> {
    return SerialPort.list();
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
