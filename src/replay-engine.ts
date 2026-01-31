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

    try {
      // Read entire file into buffer
      const fileBuffer = await fs.readFile(options.filePath);
      const totalBytes = fileBuffer.length;

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

      let bytesSent = 0;
      let lastEmittedPercent = -1;
      let lastEmitTime = Date.now();

      for (let offset = 0; offset < totalBytes; offset += chunkSize) {
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

        // Extract chunk
        const end = Math.min(offset + chunkSize, totalBytes);
        const chunk = fileBuffer.subarray(offset, end);

        // Write chunk with backpressure (write + drain)
        await this.terminalManager.write(chunk);
        bytesSent = end;

        // Inter-byte delay
        if (interByteDelayMs > 0) {
          await delay(interByteDelayMs);
        }

        // Inter-line delay: check if chunk contains CR or LF
        if (interLineDelayMs > 0) {
          let hasNewline = false;
          for (let i = 0; i < chunk.length; i++) {
            if (chunk[i] === 0x0D || chunk[i] === 0x0A) {
              hasNewline = true;
              break;
            }
          }
          if (hasNewline) {
            await delay(interLineDelayMs);
          }
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
        bytesSent: 0,
        totalBytes: 0,
        percentComplete: 0,
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
