/**
 * Server-Side File Replay Engine
 * Reads files and writes bytes directly to serial port with backpressure (write+drain).
 * Supports configurable chunk sizes and inter-byte/inter-line delays.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import { TerminalSerialManager } from './terminal-serial';

/**
 * Progress state for replay/XMODEM transfers
 */
export interface ReplayProgress {
  state: 'running' | 'completed' | 'cancelled' | 'error';
  bytesSent: number;
  totalBytes: number;
  percentComplete: number;
  fileName: string;
  error?: string;
}

/**
 * Options for raw file replay
 */
export interface ReplayOptions {
  filePath: string;
  fileName: string;
  chunkSize?: number;
  interByteDelayMs?: number;
  interLineDelayMs?: number;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class ReplayEngine extends EventEmitter {
  private terminalManager: TerminalSerialManager;
  private cancelled: boolean = false;
  private running: boolean = false;
  private lastProgress: ReplayProgress | null = null;

  constructor(terminalManager: TerminalSerialManager) {
    super();
    this.terminalManager = terminalManager;
  }

  /**
   * Replay a file by writing its bytes to the serial port with backpressure.
   */
  async replay(options: ReplayOptions): Promise<void> {
    if (this.running) {
      throw new Error('Replay already in progress');
    }

    const chunkSize = Math.min(Math.max(options.chunkSize || 1, 1), 16);
    const interByteDelayMs = options.interByteDelayMs ?? 0;
    const interLineDelayMs = options.interLineDelayMs ?? 200;

    // Validate terminal port is open
    if (!this.terminalManager.isOpen()) {
      throw new Error('Terminal serial port is not open');
    }

    this.running = true;
    this.cancelled = false;
    let bytesSent = 0;
    let totalBytes = 0;

    try {
      // Read entire file into buffer
      const fileBuffer = await fs.readFile(options.filePath);
      totalBytes = fileBuffer.length;

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

      // Calculate baud-rate pacing to prevent overwhelming the receiver.
      // drain() may return before data has been physically transmitted
      // (common with USB serial adapters whose internal TX FIFO absorbs
      // data faster than the baud rate clocks it out), so we enforce
      // minimum transmission time based on baud rate and serial framing.
      const { baudRate, dataBits, stopBits, parity } = this.terminalManager.getConfig();
      const bitsPerByte = 1 + dataBits + (parity !== 'none' ? 1 : 0) + stopBits;
      const msPerByte = (bitsPerByte * 1000) / baudRate;

      let lastEmittedPercent = -1;
      let lastEmitTime = Date.now();
      let offset = 0;

      while (offset < totalBytes) {
        // Check cancellation
        if (this.cancelled) {
          this.emitProgress({
            state: 'cancelled',
            bytesSent,
            totalBytes,
            percentComplete: Math.round((bytesSent / totalBytes) * 100),
            fileName: options.fileName,
          });
          return;
        }

        // Determine chunk end, splitting at newline boundaries so the
        // receiver gets inter-line delay before post-newline data arrives
        let end = Math.min(offset + chunkSize, totalBytes);
        let hitNewline = false;

        for (let i = offset; i < end; i++) {
          if (fileBuffer[i] === 0x0A) {
            // LF: include it, then pause for inter-line delay
            end = i + 1;
            hitNewline = true;
            break;
          } else if (fileBuffer[i] === 0x0D) {
            // CR: check for CRLF pair — treat as single line ending
            if (i + 1 < totalBytes && fileBuffer[i + 1] === 0x0A) {
              end = i + 2;
            } else {
              end = i + 1;
            }
            hitNewline = true;
            break;
          }
        }

        // Write chunk without drain — baud-rate pacing below handles timing.
        // drain() can stall indefinitely on USB serial adapters when the
        // driver stops polling the device's TX buffer between writes.
        const chunk = fileBuffer.subarray(offset, end);
        const writeStart = Date.now();
        await this.terminalManager.write(chunk, false);

        // Enforce minimum transmission time at baud rate to prevent
        // overrunning the receiver's input buffer.
        const transmitMs = chunk.length * msPerByte;
        const writeElapsed = Date.now() - writeStart;
        if (writeElapsed < transmitMs) {
          await delay(Math.ceil(transmitMs - writeElapsed));
        }

        bytesSent = end;
        offset = end;

        // Inter-byte/chunk delay
        if (interByteDelayMs > 0) {
          await delay(interByteDelayMs);
        }

        // Inter-line delay: applied after chunks ending with a newline
        if (hitNewline && interLineDelayMs > 0) {
          await delay(interLineDelayMs);
        }

        // Throttled progress emission: every 1% change or every 100ms
        const currentPercent = Math.round((bytesSent / totalBytes) * 100);
        const now = Date.now();
        if (currentPercent !== lastEmittedPercent || (now - lastEmitTime) >= 100) {
          lastEmittedPercent = currentPercent;
          lastEmitTime = now;
          this.emitProgress({
            state: 'running',
            bytesSent,
            totalBytes,
            percentComplete: currentPercent,
            fileName: options.fileName,
          });
        }
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
        bytesSent,
        totalBytes,
        percentComplete: totalBytes > 0 ? Math.round((bytesSent / totalBytes) * 100) : 0,
        fileName: options.fileName,
        error: errorMessage,
      });
      throw err;
    } finally {
      this.running = false;
    }
  }

  /**
   * Cancel an active replay.
   */
  cancel(): void {
    if (this.running) {
      this.cancelled = true;
    }
  }

  /**
   * Check if a replay is currently running.
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

  private emitProgress(progress: ReplayProgress): void {
    this.lastProgress = progress;
    this.emit('progress', progress);
  }
}
