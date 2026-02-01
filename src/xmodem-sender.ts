/**
 * XMODEM Send-Only Implementation
 * Custom TypeScript implementation for reliable error-checked file transfers
 * to vintage hardware running an XMODEM receiver. No npm dependencies.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import { TerminalSerialManager } from './terminal-serial';
import { ReplayProgress } from './replay-engine';

// XMODEM protocol constants
const SOH = 0x01;   // Start of header
const EOT = 0x04;   // End of transmission
const ACK = 0x06;   // Acknowledge
const NAK = 0x15;   // Negative acknowledge
const CAN = 0x18;   // Cancel
const C   = 0x43;   // 'C' — CRC mode request
const SUB = 0x1A;   // Ctrl-Z padding for last block

const BLOCK_SIZE = 128;
const MAX_RETRIES = 10;
const INIT_TIMEOUT_MS = 60000;  // 60s to wait for receiver initiation
const RESPONSE_TIMEOUT_MS = 10000;  // 10s to wait for ACK/NAK

/**
 * Options for XMODEM file send
 */
export interface XmodemSendOptions {
  filePath: string;
  fileName: string;
  useCrc?: boolean;
}

/**
 * CRC-16/XMODEM calculation (polynomial 0x1021, init 0x0000)
 */
export function crc16xmodem(data: Buffer): number {
  let crc = 0x0000;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i] << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc;
}

/**
 * Simple checksum: sum of all bytes mod 256
 */
export function checksumXmodem(data: Buffer): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum = (sum + data[i]) & 0xFF;
  }
  return sum;
}

export class XmodemSender extends EventEmitter {
  private terminalManager: TerminalSerialManager;
  private cancelled: boolean = false;
  private running: boolean = false;
  private lastProgress: ReplayProgress | null = null;
  private incomingBuffer: Buffer = Buffer.alloc(0);
  private dataResolvers: Array<(byte: number) => void> = [];

  constructor(terminalManager: TerminalSerialManager) {
    super();
    this.terminalManager = terminalManager;
  }

  /**
   * Send a file using XMODEM protocol.
   */
  async send(options: XmodemSendOptions): Promise<void> {
    if (this.running) {
      throw new Error('XMODEM transfer already in progress');
    }

    if (!this.terminalManager.isOpen()) {
      throw new Error('Terminal serial port is not open');
    }

    this.running = true;
    this.cancelled = false;
    this.incomingBuffer = Buffer.alloc(0);
    this.dataResolvers = [];

    // Set up data interceptor to capture incoming bytes
    this.terminalManager.setDataInterceptor((data: Buffer) => {
      this.handleIncomingData(data);
    });

    try {
      // Read entire file
      const fileBuffer = await fs.readFile(options.filePath);
      const totalBytes = fileBuffer.length;
      const totalBlocks = Math.ceil(totalBytes / BLOCK_SIZE);

      if (totalBytes === 0) {
        this.emitProgress({
          state: 'completed',
          bytesSent: 0,
          totalBytes: 0,
          percentComplete: 100,
          fileName: options.fileName,
        });
        return;
      }

      // Step 1: Wait for receiver initiation
      this.emitProgress({
        state: 'running',
        bytesSent: 0,
        totalBytes,
        percentComplete: 0,
        fileName: options.fileName,
      });

      const useCrcPreferred = options.useCrc !== false;
      let crcMode = false;

      const initByte = await this.waitForByte(INIT_TIMEOUT_MS, [C, NAK, CAN]);

      if (this.cancelled) {
        await this.sendCancel();
        this.emitProgress({
          state: 'cancelled',
          bytesSent: 0,
          totalBytes,
          percentComplete: 0,
          fileName: options.fileName,
        });
        return;
      }

      if (initByte === CAN) {
        this.emitProgress({
          state: 'cancelled',
          bytesSent: 0,
          totalBytes,
          percentComplete: 0,
          fileName: options.fileName,
          error: 'Receiver cancelled transfer',
        });
        return;
      }

      if (initByte === C && useCrcPreferred) {
        crcMode = true;
      } else {
        crcMode = false;
      }

      // Step 2: Send blocks
      let blockNum = 1;
      for (let blockIndex = 0; blockIndex < totalBlocks; blockIndex++) {
        if (this.cancelled) {
          await this.sendCancel();
          this.emitProgress({
            state: 'cancelled',
            bytesSent: blockIndex * BLOCK_SIZE,
            totalBytes,
            percentComplete: Math.round((blockIndex / totalBlocks) * 100),
            fileName: options.fileName,
          });
          return;
        }

        // Build data block (pad last block with SUB)
        const dataStart = blockIndex * BLOCK_SIZE;
        const dataEnd = Math.min(dataStart + BLOCK_SIZE, totalBytes);
        const dataBlock = Buffer.alloc(BLOCK_SIZE, SUB);
        fileBuffer.copy(dataBlock, 0, dataStart, dataEnd);

        let retries = 0;
        let blockSent = false;

        while (!blockSent && retries < MAX_RETRIES) {
          if (this.cancelled) {
            await this.sendCancel();
            this.emitProgress({
              state: 'cancelled',
              bytesSent: blockIndex * BLOCK_SIZE,
              totalBytes,
              percentComplete: Math.round((blockIndex / totalBlocks) * 100),
              fileName: options.fileName,
            });
            return;
          }

          // Assemble packet
          const packet = this.buildPacket(blockNum & 0xFF, dataBlock, crcMode);

          // Write entire packet
          await this.terminalManager.write(packet);

          // Wait for response
          try {
            const response = await this.waitForByte(RESPONSE_TIMEOUT_MS, [ACK, NAK, CAN]);

            if (response === ACK) {
              blockSent = true;
            } else if (response === CAN) {
              this.emitProgress({
                state: 'cancelled',
                bytesSent: blockIndex * BLOCK_SIZE,
                totalBytes,
                percentComplete: Math.round((blockIndex / totalBlocks) * 100),
                fileName: options.fileName,
                error: 'Receiver cancelled transfer',
              });
              return;
            } else {
              // NAK or unexpected — retry
              retries++;
            }
          } catch {
            // Timeout — retry
            retries++;
          }
        }

        if (!blockSent) {
          this.emitProgress({
            state: 'error',
            bytesSent: blockIndex * BLOCK_SIZE,
            totalBytes,
            percentComplete: Math.round((blockIndex / totalBlocks) * 100),
            fileName: options.fileName,
            error: `Block ${blockNum} failed after ${MAX_RETRIES} retries`,
          });
          return;
        }

        blockNum++;

        // Emit progress after each successful block
        const bytesSent = Math.min((blockIndex + 1) * BLOCK_SIZE, totalBytes);
        this.emitProgress({
          state: 'running',
          bytesSent,
          totalBytes,
          percentComplete: Math.round((bytesSent / totalBytes) * 100),
          fileName: options.fileName,
        });
      }

      // Step 3: Send EOT, wait for ACK
      let eotAcked = false;
      for (let retries = 0; retries < MAX_RETRIES; retries++) {
        await this.terminalManager.write(Buffer.from([EOT]));

        try {
          const response = await this.waitForByte(RESPONSE_TIMEOUT_MS, [ACK, NAK]);
          if (response === ACK) {
            eotAcked = true;
            break;
          }
          // NAK — retry EOT
        } catch {
          // Timeout — retry EOT
        }
      }

      if (!eotAcked) {
        this.emitProgress({
          state: 'error',
          bytesSent: totalBytes,
          totalBytes,
          percentComplete: 100,
          fileName: options.fileName,
          error: 'EOT not acknowledged after retries',
        });
        return;
      }

      // Completed
      this.emitProgress({
        state: 'completed',
        bytesSent: totalBytes,
        totalBytes,
        percentComplete: 100,
        fileName: options.fileName,
      });
    } catch (err) {
      const errorMessage = (err as Error).message || 'Unknown error';
      this.emitProgress({
        state: 'error',
        bytesSent: 0,
        totalBytes: 0,
        percentComplete: 0,
        fileName: options.fileName,
        error: errorMessage,
      });
      throw err;
    } finally {
      // Always restore normal terminal data flow
      this.terminalManager.clearDataInterceptor();
      this.running = false;
      this.incomingBuffer = Buffer.alloc(0);
      this.dataResolvers = [];
    }
  }

  /**
   * Cancel an active XMODEM transfer.
   */
  cancel(): void {
    if (this.running) {
      this.cancelled = true;
      // Resolve any pending byte waiters so they unblock
      for (const resolver of this.dataResolvers) {
        resolver(-1);
      }
      this.dataResolvers = [];
    }
  }

  /**
   * Check if a transfer is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the last emitted progress state.
   */
  getLastProgress(): ReplayProgress | null {
    return this.lastProgress;
  }

  /**
   * Build an XMODEM packet.
   */
  private buildPacket(blockNum: number, data: Buffer, crcMode: boolean): Buffer {
    const complement = (255 - blockNum) & 0xFF;

    if (crcMode) {
      const crc = crc16xmodem(data);
      const packet = Buffer.alloc(3 + BLOCK_SIZE + 2);
      packet[0] = SOH;
      packet[1] = blockNum;
      packet[2] = complement;
      data.copy(packet, 3);
      packet[3 + BLOCK_SIZE] = (crc >> 8) & 0xFF;
      packet[3 + BLOCK_SIZE + 1] = crc & 0xFF;
      return packet;
    } else {
      const checksum = checksumXmodem(data);
      const packet = Buffer.alloc(3 + BLOCK_SIZE + 1);
      packet[0] = SOH;
      packet[1] = blockNum;
      packet[2] = complement;
      data.copy(packet, 3);
      packet[3 + BLOCK_SIZE] = checksum;
      return packet;
    }
  }

  /**
   * Handle incoming serial data during XMODEM transfer.
   */
  private handleIncomingData(data: Buffer): void {
    // Append to buffer
    this.incomingBuffer = Buffer.concat([this.incomingBuffer, data]);

    // Resolve any pending byte waiters
    while (this.incomingBuffer.length > 0 && this.dataResolvers.length > 0) {
      const byte = this.incomingBuffer[0];
      this.incomingBuffer = this.incomingBuffer.subarray(1);
      const resolver = this.dataResolvers.shift()!;
      resolver(byte);
    }
  }

  /**
   * Wait for a specific byte from the serial port.
   * Returns the matched byte, or throws on timeout.
   */
  private waitForByte(timeoutMs: number, expectedBytes: number[]): Promise<number> {
    return new Promise((resolve, reject) => {
      let resolved = false;
      let timer: NodeJS.Timeout;

      const tryResolve = () => {
        // Check buffer first
        for (let i = 0; i < this.incomingBuffer.length; i++) {
          if (expectedBytes.includes(this.incomingBuffer[i])) {
            const byte = this.incomingBuffer[i];
            // Remove everything up to and including this byte
            this.incomingBuffer = this.incomingBuffer.subarray(i + 1);
            resolved = true;
            clearTimeout(timer);
            resolve(byte);
            return true;
          }
        }
        return false;
      };

      // Check buffer immediately
      if (tryResolve()) return;

      // Set timeout
      timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error(`Timeout waiting for response (${timeoutMs}ms)`));
        }
      }, timeoutMs);

      // Register a resolver that checks for expected bytes
      const byteHandler = (byte: number) => {
        if (resolved) return;

        if (byte === -1) {
          // Cancelled
          resolved = true;
          clearTimeout(timer);
          resolve(-1);
          return;
        }

        if (expectedBytes.includes(byte)) {
          resolved = true;
          clearTimeout(timer);
          resolve(byte);
        } else {
          // Not the byte we want — register again
          this.dataResolvers.push(byteHandler);
        }
      };

      this.dataResolvers.push(byteHandler);
    });
  }

  /**
   * Send CAN CAN to abort transfer on the receiver side.
   */
  private async sendCancel(): Promise<void> {
    try {
      await this.terminalManager.write(Buffer.from([CAN, CAN]));
    } catch {
      // Best effort — port may already be closed
    }
  }

  private emitProgress(progress: ReplayProgress): void {
    this.lastProgress = progress;
    this.emit('progress', progress);
  }
}
