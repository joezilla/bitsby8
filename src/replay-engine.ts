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
 * Line ending format for replay output.
 * 'cr'   — Convert all line endings to CR (0x0D).  Most vintage BASIC interpreters.
 * 'lf'   — Convert all line endings to LF (0x0A).  Unix systems.
 * 'crlf' — Convert all line endings to CR+LF (0x0D 0x0A).  DOS / Windows / some terminals.
 * 'raw'  — Send bytes exactly as stored on disk (no conversion).
 */
export type LineEnding = 'cr' | 'lf' | 'crlf' | 'raw';

/**
 * Options for raw file replay
 */
export interface ReplayOptions {
  filePath: string;
  fileName: string;
  chunkSize?: number;
  interByteDelayMs?: number;
  interLineDelayMs?: number;
  lineEnding?: LineEnding;
  verbose?: boolean;
}

/**
 * Convert all line endings (CRLF, bare CR, bare LF) in a buffer to the
 * target format.  Returns the original buffer unchanged when target is 'raw'.
 */
export function convertLineEndings(buffer: Buffer, target: LineEnding): Buffer {
  if (target === 'raw') return buffer;

  const targetBytes = target === 'cr'   ? Buffer.from([0x0D])
                    : target === 'lf'   ? Buffer.from([0x0A])
                    :                      Buffer.from([0x0D, 0x0A]);

  const chunks: Buffer[] = [];
  let lastEnd = 0;

  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0x0D) {
      chunks.push(buffer.subarray(lastEnd, i));
      chunks.push(targetBytes);
      // Skip LF in CRLF pair
      if (i + 1 < buffer.length && buffer[i + 1] === 0x0A) {
        i++;
      }
      lastEnd = i + 1;
    } else if (buffer[i] === 0x0A) {
      chunks.push(buffer.subarray(lastEnd, i));
      chunks.push(targetBytes);
      lastEnd = i + 1;
    }
  }

  if (lastEnd < buffer.length) {
    chunks.push(buffer.subarray(lastEnd));
  }

  return Buffer.concat(chunks);
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
    const lineEnding: LineEnding = options.lineEnding ?? 'raw';

    // Validate terminal port is open
    if (!this.terminalManager.isOpen()) {
      throw new Error('Terminal serial port is not open');
    }

    this.running = true;
    this.cancelled = false;
    let bytesSent = 0;
    let totalBytes = 0;

    const verbose = options.verbose ?? false;
    const dbg = verbose
      ? (msg: string) => console.log(`[REPLAY ${Date.now()}] ${msg}`)
      : () => {};

    try {
      // Read file and apply line ending conversion
      const rawBuffer = await fs.readFile(options.filePath);
      const fileBuffer = convertLineEndings(rawBuffer, lineEnding);
      totalBytes = fileBuffer.length;

      dbg(`START file=${options.fileName} rawSize=${rawBuffer.length} size=${totalBytes} lineEnding=${lineEnding} chunkSize=${chunkSize} interByte=${interByteDelayMs} interLine=${interLineDelayMs}`);

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

        if (verbose) {
          const hex = chunk.length <= 8
            ? Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join(' ')
            : `${chunk.length}B`;
          dbg(`WRITE iter=${loopIter} offset=${offset} len=${chunk.length} newline=${hitNewline} hex=[${hex}]`);
        }

        const writeStart = verbose ? Date.now() : 0;
        await this.terminalManager.write(chunk, false);
        if (verbose) dbg(`WRITE-DONE iter=${loopIter} took=${Date.now() - writeStart}ms`);

        bytesSent = end;
        offset = end;

        // Inter-byte/chunk delay
        if (interByteDelayMs > 0) {
          const delayStart = verbose ? Date.now() : 0;
          await delay(interByteDelayMs);
          if (verbose) dbg(`INTER-BYTE-DELAY iter=${loopIter} requested=${interByteDelayMs}ms actual=${Date.now() - delayStart}ms`);
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
            const lineDelayStart = verbose ? Date.now() : 0;
            await delay(remaining);
            if (verbose) dbg(`LINE-DELAY iter=${loopIter} requested=${remaining}ms actual=${Date.now() - lineDelayStart}ms`);
          }
        } else {
          // Mid-line: enforce minimum transmission time at baud rate to
          // prevent overrunning the receiver's input buffer.
          const transmitMs = chunk.length * msPerByte;
          if (interByteDelayMs <= 0 && transmitMs > 1) {
            const paceStart = verbose ? Date.now() : 0;
            await delay(Math.ceil(transmitMs));
            if (verbose) dbg(`BAUD-PACE iter=${loopIter} requested=${Math.ceil(transmitMs)}ms actual=${Date.now() - paceStart}ms`);
          }
        }

        // Periodic loop summary (every 2s of wall time) to avoid log flood
        if (verbose) {
          const loopNow = Date.now();
          if (loopNow - lastLoopLogTime >= 2000) {
            dbg(`PROGRESS offset=${offset}/${totalBytes} (${Math.round((offset / totalBytes) * 100)}%) iter=${loopIter} elapsed=${loopNow - lastLoopLogTime}ms since last log`);
            lastLoopLogTime = loopNow;
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
