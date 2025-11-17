/**
 * Serial Port Communication Module
 * Handles communication with FDC+ controller via serial port
 */

import { SerialPort } from 'serialport';
import { BaudRate, TIMEOUT_BYTE, TIMEOUT_BUFFER } from './protocol';
import { ByteUtils } from './protocol';

/**
 * Serial Port Manager for FDC+ communication
 */
export class SerialPortManager {
  private port: SerialPort | null;
  private device: string | null;
  private baudRate: BaudRate;
  private dataBuffer: Buffer;
  private dataResolvers: Array<(value: number) => void>;

  constructor() {
    this.port = null;
    this.device = null;
    this.baudRate = BaudRate.B460800;
    this.dataBuffer = Buffer.alloc(0);
    this.dataResolvers = [];
  }

  /**
   * Open serial port with specified device and baud rate
   */
  async openPort(device: string, baudRate: BaudRate): Promise<void> {
    if (!device) {
      throw new Error('Device path is required');
    }

    this.device = device;
    this.baudRate = baudRate;

    return new Promise((resolve, reject) => {
      this.port = new SerialPort(
        {
          path: device,
          baudRate: baudRate,
          dataBits: 8,
          stopBits: 1,
          parity: 'none',
          // Critical: Disable ALL flow control to match C version
          rtscts: false,         // No RTS/CTS hardware flow control
          xon: false,            // No XON/XOFF software flow control
          xoff: false,
          xany: false,
          // Non-blocking I/O
          autoOpen: true,
          lock: false,
        },
        (error) => {
          if (error) {
            reject(error);
          } else {
            // Flush input buffer to match C version's tcflush(fd, TCIFLUSH)
            this.port?.flush((flushErr) => {
              if (flushErr) {
                console.warn('Flush warning:', flushErr.message);
              }
            });
            resolve();
          }
        }
      );

      // Setup error handler
      this.port.on('error', (err) => {
        console.error('Serial port error:', err);
      });

      // Setup data handler to buffer incoming data
      this.port.on('data', (data: Buffer) => {
        // Append new data to buffer
        this.dataBuffer = Buffer.concat([this.dataBuffer, data]);

        // Resolve any pending byte requests
        while (this.dataBuffer.length > 0 && this.dataResolvers.length > 0) {
          const resolver = this.dataResolvers.shift();
          const byte = this.dataBuffer[0];
          this.dataBuffer = this.dataBuffer.slice(1);
          if (resolver) {
            resolver(byte);
          }
        }
      });
    });
  }

  /**
   * Close serial port
   */
  async closePort(): Promise<void> {
    if (!this.port || !this.port.isOpen) {
      return;
    }

    // Clear buffers and resolvers
    this.dataBuffer = Buffer.alloc(0);
    this.dataResolvers = [];

    return new Promise((resolve, reject) => {
      this.port!.close((error) => {
        if (error) {
          reject(error);
        } else {
          this.port = null;
          resolve();
        }
      });
    });
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
   * Get baud rate
   */
  getBaudRate(): BaudRate {
    return this.baudRate;
  }

  /**
   * Receive a single byte with timeout
   */
  async receiveByte(timeoutMs: number = TIMEOUT_BYTE): Promise<number> {
    if (!this.port || !this.port.isOpen) {
      throw new Error('Serial port not open');
    }

    return new Promise((resolve, reject) => {
      // If data is already buffered, return immediately
      if (this.dataBuffer.length > 0) {
        const byte = this.dataBuffer[0];
        this.dataBuffer = this.dataBuffer.slice(1);
        resolve(byte);
        return;
      }

      // Setup timeout
      const timer = setTimeout(() => {
        // Remove resolver from queue
        const index = this.dataResolvers.indexOf(resolverFn);
        if (index >= 0) {
          this.dataResolvers.splice(index, 1);
        }
        reject(new Error('Timeout receiving byte'));
      }, timeoutMs);

      // Create resolver function
      const resolverFn = (byte: number) => {
        clearTimeout(timer);
        resolve(byte);
      };

      // Add to resolver queue
      this.dataResolvers.push(resolverFn);
    });
  }

  /**
   * Receive buffer with checksum verification
   */
  async receiveBuffer(
    length: number,
    timeoutMs: number = TIMEOUT_BUFFER
  ): Promise<Buffer> {
    if (!this.port || !this.port.isOpen) {
      throw new Error('Serial port not open');
    }

    const buffer = Buffer.alloc(length);
    let bytesReceived = 0;

    // Receive requested length
    while (bytesReceived < length) {
      try {
        const byte = await this.receiveByte(timeoutMs);
        buffer[bytesReceived++] = byte;
      } catch (error) {
        throw new Error(
          `Timeout receiving buffer at byte ${bytesReceived}/${length}`
        );
      }
    }

    // Receive checksum (2 bytes: LSB, MSB)
    let checksumLsb: number;
    let checksumMsb: number;

    try {
      checksumLsb = await this.receiveByte(1000);
      checksumMsb = await this.receiveByte(1000);
    } catch (error) {
      throw new Error('Timeout receiving checksum');
    }

    const receivedChecksum = ByteUtils.WORD(checksumLsb, checksumMsb);
    const calculatedChecksum = this.calculateChecksum(buffer);

    if (receivedChecksum !== calculatedChecksum) {
      throw new Error(
        `Checksum mismatch: received 0x${receivedChecksum.toString(16)}, ` +
          `calculated 0x${calculatedChecksum.toString(16)}`
      );
    }

    return buffer;
  }

  /**
   * Send buffer with checksum appended
   */
  async sendBuffer(
    buffer: Buffer,
    timeoutMs: number = TIMEOUT_BUFFER
  ): Promise<void> {
    if (!this.port || !this.port.isOpen) {
      throw new Error('Serial port not open');
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Timeout sending buffer'));
      }, timeoutMs);

      // Calculate checksum
      const checksum = this.calculateChecksum(buffer);
      const checksumLsb = ByteUtils.LSB(checksum);
      const checksumMsb = ByteUtils.MSB(checksum);

      // Create buffer with checksum appended
      const dataWithChecksum = Buffer.alloc(buffer.length + 2);
      buffer.copy(dataWithChecksum, 0);
      dataWithChecksum[buffer.length] = checksumLsb;
      dataWithChecksum[buffer.length + 1] = checksumMsb;

      // Send data
      this.port!.write(dataWithChecksum, (error) => {
        clearTimeout(timer);

        if (error) {
          reject(error);
        } else {
          // Wait for data to be transmitted (drain)
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
   * Calculate 16-bit checksum
   */
  calculateChecksum(buffer: Buffer): number {
    let checksum = 0;

    for (let i = 0; i < buffer.length; i++) {
      checksum += buffer[i];
    }

    // Ensure 16-bit result
    return checksum & 0xffff;
  }

  /**
   * Flush serial port buffers
   */
  async flush(): Promise<void> {
    if (!this.port || !this.port.isOpen) {
      return;
    }

    // Clear our internal buffer
    this.dataBuffer = Buffer.alloc(0);

    return new Promise((resolve, reject) => {
      this.port!.flush((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
}

/**
 * Global serial port manager instance (singleton)
 */
let serialPortManagerInstance: SerialPortManager | null = null;

export function getSerialPortManager(): SerialPortManager {
  if (!serialPortManagerInstance) {
    serialPortManagerInstance = new SerialPortManager();
  }
  return serialPortManagerInstance;
}
