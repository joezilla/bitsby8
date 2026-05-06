/**
 * Logger Module - Structured logging with pino
 *
 * Creates a pino logger instance and optionally overrides console methods
 * so all existing console.log/error/warn calls produce structured output.
 *
 * In development: pretty-printed, colorized output.
 * In production: JSON structured logs (or file output if logFile is set).
 */

import pino from 'pino';
import * as fs from 'fs';
import * as path from 'path';

let rootLogger: pino.Logger | null = null;

// Store original console methods for restore
const originalConsole = {
  log: console.log.bind(console),
  error: console.error.bind(console),
  warn: console.warn.bind(console),
};

export interface LoggerOptions {
  logFile?: string | null;
  consoleEnabled?: boolean;
  level?: string;
  pretty?: boolean;
}

/**
 * Initialize the global pino logger.
 *
 * @param options.logFile - Path to log file (optional). If set, logs go to file.
 * @param options.consoleEnabled - Whether to also output to console (default: true).
 * @param options.level - Log level (default: 'info').
 * @param options.pretty - Use pino-pretty for console output (default: true in dev).
 */
export async function initializeLogger(options: LoggerOptions = {}): Promise<void> {
  const {
    logFile = null,
    consoleEnabled = true,
    level = 'info',
    pretty = process.env.NODE_ENV !== 'production',
  } = options;

  // Build transport targets
  const targets: pino.TransportTargetOptions[] = [];

  if (consoleEnabled) {
    if (pretty) {
      targets.push({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
        level,
      });
    } else {
      targets.push({
        target: 'pino/file',
        options: { destination: 1 }, // stdout
        level,
      });
    }
  }

  if (logFile) {
    const logDir = path.dirname(path.resolve(logFile));
    try {
      await fs.promises.mkdir(logDir, { recursive: true });
    } catch { /* directory may exist */ }

    targets.push({
      target: 'pino/file',
      options: { destination: path.resolve(logFile) },
      level,
    });
  }

  if (targets.length === 0) {
    // No targets — create a silent logger
    rootLogger = pino({ level: 'silent' });
  } else if (targets.length === 1) {
    rootLogger = pino({
      level,
      transport: targets[0],
    });
  } else {
    rootLogger = pino({
      level,
      transport: { targets },
    });
  }

  // Override console methods to route through pino
  overrideConsole();
}

/**
 * Get the root pino logger. Creates a default one if not initialized.
 */
export function getPinoLogger(): pino.Logger {
  if (!rootLogger) {
    // Create a simple default logger (pretty in dev, JSON in prod)
    const pretty = process.env.NODE_ENV !== 'production';
    if (pretty) {
      rootLogger = pino({
        level: 'info',
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        },
      });
    } else {
      rootLogger = pino({ level: 'info' });
    }
    overrideConsole();
  }
  return rootLogger;
}

/**
 * Create a child logger with a module name.
 * Usage: const log = createLogger('drives');
 */
export function createLogger(module: string): pino.Logger {
  return getPinoLogger().child({ module });
}

/**
 * Override console.log/error/warn to route through pino.
 * This ensures all existing console calls across the codebase
 * produce structured log output.
 */
function overrideConsole(): void {
  if (!rootLogger) return;

  const pinoInst = rootLogger;

  console.log = (...args: any[]) => {
    pinoInst.info(formatArgs(args));
  };

  console.error = (...args: any[]) => {
    pinoInst.error(formatArgs(args));
  };

  console.warn = (...args: any[]) => {
    pinoInst.warn(formatArgs(args));
  };
}

/**
 * Format console-style arguments into a single message string.
 */
function formatArgs(args: any[]): string {
  return args.map(arg => {
    if (typeof arg === 'object' && arg !== null) {
      if (arg instanceof Error) {
        return arg.stack || arg.message;
      }
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  }).join(' ');
}

/**
 * Restore original console methods.
 */
export function restoreConsole(): void {
  console.log = originalConsole.log;
  console.error = originalConsole.error;
  console.warn = originalConsole.warn;
}

/**
 * Close the logger and restore console.
 */
export async function closeLogger(): Promise<void> {
  restoreConsole();
  if (rootLogger) {
    // Flush pino
    rootLogger.flush();
    rootLogger = null;
  }
}

// Legacy compatibility - the old Logger class API
// Used by index.ts and potentially other code that imports Logger directly
export class Logger {
  private static instance: Logger | null = null;
  private logFilePath: string | null = null;

  private constructor() {}

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  public async initialize(logFilePath: string, consoleEnabled: boolean = true): Promise<void> {
    this.logFilePath = logFilePath;
    await initializeLogger({
      logFile: logFilePath,
      consoleEnabled,
      level: 'info',
    });
  }

  public log(message: string): void {
    getPinoLogger().info(message);
  }

  public error(message: string, error?: Error): void {
    if (error) {
      getPinoLogger().error({ err: error }, message);
    } else {
      getPinoLogger().error(message);
    }
  }

  public async flush(): Promise<void> {
    getPinoLogger().flush();
  }

  public async close(): Promise<void> {
    await closeLogger();
  }

  public isInitialized(): boolean {
    return rootLogger !== null;
  }

  public getLogFile(): string | null {
    return this.logFilePath;
  }

  public static resetInstance(): void {
    if (Logger.instance) {
      Logger.instance.close().catch(() => {});
      Logger.instance = null;
    }
  }
}

/**
 * Get the singleton Logger instance (legacy API).
 * Used by index.ts and other code that expects the old Logger class.
 */
export function getLogger(): Logger {
  return Logger.getInstance();
}
