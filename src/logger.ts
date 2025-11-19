/**
 * Logger Module - File-based logging support
 *
 * Provides a simple logging system that can write to files
 * while also maintaining console output when appropriate.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Logger class for managing log output
 */
export class Logger {
  private static instance: Logger | null = null;
  private logStream: fs.WriteStream | null = null;
  private logFile: string | null = null;
  private consoleEnabled: boolean = true;

  // Store original console methods
  private originalConsoleLog: typeof console.log;
  private originalConsoleError: typeof console.error;
  private originalConsoleWarn: typeof console.warn;

  private constructor() {
    this.originalConsoleLog = console.log.bind(console);
    this.originalConsoleError = console.error.bind(console);
    this.originalConsoleWarn = console.warn.bind(console);
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /**
   * Initialize file-based logging
   * @param logFilePath Path to log file
   * @param consoleEnabled Whether to also output to console (default: true)
   */
  public async initialize(logFilePath: string, consoleEnabled: boolean = true): Promise<void> {
    if (this.logStream) {
      throw new Error('Logger already initialized');
    }

    this.logFile = path.resolve(logFilePath);
    this.consoleEnabled = consoleEnabled;

    // Ensure log directory exists
    const logDir = path.dirname(this.logFile);
    try {
      await fs.promises.mkdir(logDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw new Error(`Failed to create log directory ${logDir}: ${(error as Error).message}`);
      }
    }

    // Open log file for appending
    try {
      this.logStream = fs.createWriteStream(this.logFile, {
        flags: 'a',  // append mode
        encoding: 'utf8',
      });

      // Handle stream errors
      this.logStream.on('error', (error) => {
        this.originalConsoleError('Log file write error:', error);
      });

      // Write startup marker
      const startupMessage = `\n${'='.repeat(80)}\n` +
        `Log started: ${new Date().toISOString()}\n` +
        `${'='.repeat(80)}\n`;
      this.logStream.write(startupMessage);

      // Override console methods
      this.overrideConsoleMethods();

      this.log(`Logging initialized: ${this.logFile}`);
    } catch (error) {
      throw new Error(`Failed to open log file ${this.logFile}: ${(error as Error).message}`);
    }
  }

  /**
   * Override console methods to write to log file
   */
  private overrideConsoleMethods(): void {
    // Override console.log
    console.log = (...args: any[]) => {
      this.writeLog('LOG', args);
      if (this.consoleEnabled) {
        this.originalConsoleLog(...args);
      }
    };

    // Override console.error
    console.error = (...args: any[]) => {
      this.writeLog('ERROR', args);
      if (this.consoleEnabled) {
        this.originalConsoleError(...args);
      }
    };

    // Override console.warn
    console.warn = (...args: any[]) => {
      this.writeLog('WARN', args);
      if (this.consoleEnabled) {
        this.originalConsoleWarn(...args);
      }
    };
  }

  /**
   * Write log entry to file
   */
  private writeLog(level: string, args: any[]): void {
    if (!this.logStream) {
      return;
    }

    const timestamp = new Date().toISOString();
    const message = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');

    const logLine = `[${timestamp}] [${level}] ${message}\n`;
    this.logStream.write(logLine);
  }

  /**
   * Direct logging method (bypasses console override)
   */
  public log(message: string): void {
    if (this.logStream) {
      const timestamp = new Date().toISOString();
      this.logStream.write(`[${timestamp}] [INFO] ${message}\n`);
    }
    if (this.consoleEnabled) {
      this.originalConsoleLog(message);
    }
  }

  /**
   * Direct error logging method
   */
  public error(message: string, error?: Error): void {
    const fullMessage = error ? `${message}: ${error.message}` : message;
    if (this.logStream) {
      const timestamp = new Date().toISOString();
      this.logStream.write(`[${timestamp}] [ERROR] ${fullMessage}\n`);
      if (error && error.stack) {
        this.logStream.write(`[${timestamp}] [ERROR] Stack: ${error.stack}\n`);
      }
    }
    if (this.consoleEnabled) {
      this.originalConsoleError(fullMessage);
    }
  }

  /**
   * Flush log stream
   */
  public async flush(): Promise<void> {
    if (this.logStream) {
      return new Promise((resolve, reject) => {
        this.logStream!.write('', (error) => {
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
   * Close log file and restore console methods
   */
  public async close(): Promise<void> {
    if (this.logStream) {
      // Write shutdown marker
      const shutdownMessage = `${'='.repeat(80)}\n` +
        `Log ended: ${new Date().toISOString()}\n` +
        `${'='.repeat(80)}\n\n`;
      this.logStream.write(shutdownMessage);

      // Wait for writes to complete
      await this.flush();

      // Close stream
      return new Promise((resolve) => {
        this.logStream!.end(() => {
          this.logStream = null;
          resolve();
        });
      });
    }

    // Restore original console methods
    console.log = this.originalConsoleLog;
    console.error = this.originalConsoleError;
    console.warn = this.originalConsoleWarn;
  }

  /**
   * Check if logger is initialized
   */
  public isInitialized(): boolean {
    return this.logStream !== null;
  }

  /**
   * Get log file path
   */
  public getLogFile(): string | null {
    return this.logFile;
  }

  /**
   * Reset singleton (for testing)
   */
  public static resetInstance(): void {
    if (Logger.instance) {
      Logger.instance.close().catch(() => {});
      Logger.instance = null;
    }
  }
}

/**
 * Get the singleton logger instance
 */
export function getLogger(): Logger {
  return Logger.getInstance();
}
