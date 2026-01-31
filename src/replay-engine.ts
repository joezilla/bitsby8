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

    const dbg = (msg: string) => console.log(`[REPLAY ${Date.now()}] ${msg}`);

    try {
      // Read entire file into buffer
      const fileBuffer = await fs.readFile(options.filePath);
      totalBytes = fileBuffer.length;

      dbg(`START file=${options.fileName} size=${totalBytes} chunkSize=${chunkSize} interByte=${interByteDelayMs} interLine=${interLineDelayMs}`);

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

      // Calculate baud-rate pacing based on serial framing.
      const { baudRate, dataBits, stopBits, parity } = this.terminalManager.getConfig();
      const bitsPerByte = 1 + dataBits + (parity !== 'none' ? 1 : 0) + stopBits;
      const msPerByte = (bitsPerByte * 1000) / baudRate;

      dbg(`SERIAL baud=${baudRate} bits/byte=${bitsPerByte} ms/byte=${msPerByte.toFixed(3)}`);

      let lastEmittedPercent = -1;
      let lastEmitTime = Date.now();
      let offset = 0;
      let loopIter = 0;
      let lastLoopLogTime = Date.now();

      while (offset < totalBytes) {
        loopIter++;

        // Check cancellation
        if (this.cancelled) {
          dbg(`CANCELLED at offset=${offset} bytesSent=${bytesSent}`);
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

        // Write chunk without drain — drain is called at line boundaries
        // below to flush data to the USB hardware.
        const chunk = fileBuffer.subarray(offset, end);
        const hex = chunk.length <= 8
          ? Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join(' ')
          : `${chunk.length}B`;

        const writeStart = Date.now();
        dbg(`WRITE iter=${loopIter} offset=${offset} len=${chunk.length} newline=${hitNewline} hex=[${hex}]`);
        await this.terminalManager.write(chunk, false);
        const writeMs = Date.now() - writeStart;
        dbg(`WRITE-DONE iter=${loopIter} took=${writeMs}ms`);

        bytesSent = end;
        offset = end;

        // Inter-byte/chunk delay
        if (interByteDelayMs > 0) {
          const delayStart = Date.now();
          await delay(interByteDelayMs);
          dbg(`INTER-BYTE-DELAY iter=${loopIter} requested=${interByteDelayMs}ms actual=${Date.now() - delayStart}ms`);
        }

        // At line boundaries: drain + inter-line delay.
        // USB serial drivers may stop actively polling the kernel
        // TX buffer when it has been empty for a few cycles.  Periodic
        // tcdrain() calls (via drain()) re-activate the driver's output
        // handling, preventing data from accumulating unsent in the
        // kernel buffer.  The drain runs during the inter-line delay
        // window so it adds no extra latency in the normal case.
        if (hitNewline) {
          const drainTimeout = Math.max(interLineDelayMs, 100);
          const drainStart = Date.now();
          dbg(`DRAIN iter=${loopIter} timeout=${drainTimeout}ms`);
          const drainResult = await this.terminalManager.drain(drainTimeout);
          const drainElapsed = Date.now() - drainStart;
          dbg(`DRAIN-DONE iter=${loopIter} result=${drainResult} took=${drainElapsed}ms`);

          if (interLineDelayMs > 0 && drainElapsed < interLineDelayMs) {
            const remaining = interLineDelayMs - drainElapsed;
            const lineDelayStart = Date.now();
            await delay(remaining);
            dbg(`LINE-DELAY iter=${loopIter} requested=${remaining}ms actual=${Date.now() - lineDelayStart}ms`);
          }
        } else {
          // Mid-line: enforce minimum transmission time at baud rate to
          // prevent overrunning the receiver's input buffer.
          const transmitMs = chunk.length * msPerByte;
          if (interByteDelayMs <= 0 && transmitMs > 1) {
            const paceStart = Date.now();
            await delay(Math.ceil(transmitMs));
            dbg(`BAUD-PACE iter=${loopIter} requested=${Math.ceil(transmitMs)}ms actual=${Date.now() - paceStart}ms`);
          }
        }

        // Periodic loop summary (every 2s of wall time) to avoid log flood
        const loopNow = Date.now();
        if (loopNow - lastLoopLogTime >= 2000) {
          dbg(`PROGRESS offset=${offset}/${totalBytes} (${Math.round((offset / totalBytes) * 100)}%) iter=${loopIter} elapsed=${loopNow - lastLoopLogTime}ms since last log`);
          lastLoopLogTime = loopNow;
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

      dbg(`COMPLETED total=${totalBytes} iterations=${loopIter}`);

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
      dbg(`ERROR bytesSent=${bytesSent}/${totalBytes} err=${errorMessage}`);
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
