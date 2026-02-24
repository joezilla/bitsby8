/**
 * Configuration File Module
 * Handles loading and parsing of configuration files
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { GpioLedConfig } from './gpio';

/**
 * Configuration file structure
 */
export interface ConfigFile {
  // Serial port options
  port?: string;
  baud?: number;

  // Drive mounts
  drive0?: string;
  drive1?: string;
  drive2?: string;
  drive3?: string;

  // Read-only drives
  readonly?: number[];

  // Display options
  verbose?: boolean;
  debug?: boolean;
  logFile?: string;   // Log file path (for file-based logging)

  // Web interface options
  web?: boolean;
  webPort?: number;
  webHost?: string;

  // Terminal options
  terminalPort?: string;
  terminalBaud?: number;
  terminalAutoconnect?: boolean;

  // Data directory
  dataDir?: string;

  // GPIO LED options
  gpioLeds?: GpioLedConfig;
}

/**
 * Default configuration file locations to search
 * Ordered by priority (highest to lowest)
 * Local configs take precedence over system-wide configs
 */
export const DEFAULT_CONFIG_LOCATIONS = [
  '.fdcsds.config',
  '.config/fdcsds.json',
  'fdcsds.config.json',
  '/etc/fdcplus/fdcsds.config', // System-wide default config (lowest priority)
];

/**
 * Load configuration from file
 */
export async function loadConfigFile(configPath?: string): Promise<ConfigFile | null> {
  // If specific path provided, try only that
  if (configPath) {
    try {
      const absolutePath = path.resolve(configPath);
      const content = await fs.readFile(absolutePath, 'utf-8');
      return parseConfigContent(content, absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Config file not found: ${configPath}`);
      }
      throw new Error(`Failed to read config file ${configPath}: ${(error as Error).message}`);
    }
  }

  // Try default locations
  for (const location of DEFAULT_CONFIG_LOCATIONS) {
    try {
      const absolutePath = path.resolve(location);
      const content = await fs.readFile(absolutePath, 'utf-8');
      console.log(`Loaded configuration from: ${location}`);
      return parseConfigContent(content, absolutePath);
    } catch (error) {
      // Silently continue to next location
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`Warning: Could not read ${location}: ${(error as Error).message}`);
      }
    }
  }

  // No config file found in default locations
  return null;
}

/**
 * Parse configuration file content
 */
function parseConfigContent(content: string, filePath: string): ConfigFile {
  try {
    const config = JSON.parse(content);
    return validateConfig(config);
  } catch (error) {
    throw new Error(`Invalid JSON in config file ${filePath}: ${(error as Error).message}`);
  }
}

/**
 * Validate and normalize configuration
 */
function validateConfig(config: any): ConfigFile {
  const validated: ConfigFile = {};

  // Serial port options
  if (config.port !== undefined) {
    if (typeof config.port !== 'string') {
      throw new Error('Config error: "port" must be a string');
    }
    validated.port = config.port;
  }

  if (config.baud !== undefined) {
    if (typeof config.baud !== 'number') {
      throw new Error('Config error: "baud" must be a number');
    }
    validated.baud = config.baud;
  }

  // Drive mounts
  for (let i = 0; i <= 3; i++) {
    const key = `drive${i}` as keyof ConfigFile;
    if (config[key] !== undefined) {
      if (typeof config[key] !== 'string') {
        throw new Error(`Config error: "${key}" must be a string`);
      }
      (validated as any)[key] = config[key];
    }
  }

  // Read-only drives
  if (config.readonly !== undefined) {
    if (!Array.isArray(config.readonly)) {
      throw new Error('Config error: "readonly" must be an array');
    }
    if (!config.readonly.every((n: any) => typeof n === 'number' && n >= 0 && n <= 3)) {
      throw new Error('Config error: "readonly" must contain numbers 0-3');
    }
    validated.readonly = config.readonly;
  }

  // Display options
  if (config.verbose !== undefined) {
    if (typeof config.verbose !== 'boolean') {
      throw new Error('Config error: "verbose" must be a boolean');
    }
    validated.verbose = config.verbose;
  }

  if (config.debug !== undefined) {
    if (typeof config.debug !== 'boolean') {
      throw new Error('Config error: "debug" must be a boolean');
    }
    validated.debug = config.debug;
  }

  if (config.logFile !== undefined) {
    if (typeof config.logFile !== 'string') {
      throw new Error('Config error: "logFile" must be a string');
    }
    validated.logFile = config.logFile;
  }

  // Web interface options
  if (config.web !== undefined) {
    if (typeof config.web !== 'boolean') {
      throw new Error('Config error: "web" must be a boolean');
    }
    validated.web = config.web;
  }

  if (config.webPort !== undefined) {
    if (typeof config.webPort !== 'number') {
      throw new Error('Config error: "webPort" must be a number');
    }
    validated.webPort = config.webPort;
  }

  if (config.webHost !== undefined) {
    if (typeof config.webHost !== 'string') {
      throw new Error('Config error: "webHost" must be a string');
    }
    validated.webHost = config.webHost;
  }

  // Terminal options
  if (config.terminalPort !== undefined) {
    if (typeof config.terminalPort !== 'string') {
      throw new Error('Config error: "terminalPort" must be a string');
    }
    validated.terminalPort = config.terminalPort;
  }

  if (config.terminalBaud !== undefined) {
    if (typeof config.terminalBaud !== 'number') {
      throw new Error('Config error: "terminalBaud" must be a number');
    }
    validated.terminalBaud = config.terminalBaud;
  }

  if (config.terminalAutoconnect !== undefined) {
    if (typeof config.terminalAutoconnect !== 'boolean') {
      throw new Error('Config error: "terminalAutoconnect" must be a boolean');
    }
    validated.terminalAutoconnect = config.terminalAutoconnect;
  }

  // Data directory
  if (config.dataDir !== undefined) {
    if (typeof config.dataDir !== 'string') {
      throw new Error('Config error: "dataDir" must be a string');
    }
    validated.dataDir = config.dataDir;
  }

  // GPIO LED options
  if (config.gpioLeds !== undefined) {
    if (typeof config.gpioLeds !== 'object' || config.gpioLeds === null) {
      throw new Error('Config error: "gpioLeds" must be an object');
    }
    // Pass through gpioLeds configuration (detailed validation will be done by GPIO controller)
    validated.gpioLeds = config.gpioLeds;
  }

  return validated;
}

/**
 * Merge command line options with config file
 * Command line options take precedence
 */
export function mergeConfig(configFile: ConfigFile | null, cmdLineOptions: any): any {
  const merged = { ...configFile };

  // Override with command line options if provided
  if (cmdLineOptions.dataDir !== undefined) merged.dataDir = cmdLineOptions.dataDir;
  if (cmdLineOptions.port !== undefined) merged.port = cmdLineOptions.port;
  if (cmdLineOptions.baud !== undefined) merged.baud = cmdLineOptions.baud;

  if (cmdLineOptions.drive0 !== undefined) merged.drive0 = cmdLineOptions.drive0;
  if (cmdLineOptions.drive1 !== undefined) merged.drive1 = cmdLineOptions.drive1;
  if (cmdLineOptions.drive2 !== undefined) merged.drive2 = cmdLineOptions.drive2;
  if (cmdLineOptions.drive3 !== undefined) merged.drive3 = cmdLineOptions.drive3;

  if (cmdLineOptions.readonly !== undefined && cmdLineOptions.readonly.length > 0) {
    merged.readonly = cmdLineOptions.readonly;
  }

  if (cmdLineOptions.verbose !== undefined) merged.verbose = cmdLineOptions.verbose;
  if (cmdLineOptions.debug !== undefined) merged.debug = cmdLineOptions.debug;
  if (cmdLineOptions.logFile !== undefined) merged.logFile = cmdLineOptions.logFile;

  if (cmdLineOptions.web !== undefined) merged.web = cmdLineOptions.web;
  if (cmdLineOptions.webPort !== undefined) merged.webPort = parseInt(cmdLineOptions.webPort);
  if (cmdLineOptions.webHost !== undefined) merged.webHost = cmdLineOptions.webHost;

  if (cmdLineOptions.terminalPort !== undefined) merged.terminalPort = cmdLineOptions.terminalPort;
  if (cmdLineOptions.terminalBaud !== undefined) merged.terminalBaud = parseInt(cmdLineOptions.terminalBaud);
  if (cmdLineOptions.terminalAutoconnect !== undefined) merged.terminalAutoconnect = cmdLineOptions.terminalAutoconnect;

  // GPIO LED options
  if (cmdLineOptions.gpioLeds !== undefined) {
    if (!merged.gpioLeds) {
      merged.gpioLeds = { enabled: false };
    }
    merged.gpioLeds.enabled = cmdLineOptions.gpioLeds;
  }
  if (cmdLineOptions.gpioActiveLow !== undefined) {
    if (!merged.gpioLeds) {
      merged.gpioLeds = { enabled: false };
    }
    merged.gpioLeds.activeLow = cmdLineOptions.gpioActiveLow;
  }

  return merged;
}

/**
 * Create example configuration file
 */
export function getExampleConfig(): string {
  const example = {
    // Data directory for disks, cassettes, scripts, uploads, and database
    // When set, all dynamic content paths resolve relative to this directory
    // When null/unset, defaults to the current working directory
    dataDir: null as string | null,

    // Serial port for FDC+ controller (required)
    // Volatile path (may change after reboot):
    port: "/dev/ttyUSB0",
    // Persistent path (recommended on Linux, survives reboots):
    // port: "/dev/serial/by-id/usb-FTDI_FT232R_USB_UART_ABC123-if00-port0",
    baud: 230400,

    // Disk images to mount on startup
    drive0: "disks/cpm22.dsk",
    drive1: "disks/games.dsk",
    drive2: null,
    drive3: null,

    // Read-only drives (array of drive numbers 0-3)
    readonly: [0],

    // Display options
    verbose: false,
    debug: false,
    logFile: null,   // Optional: log file path (e.g., "/var/log/fdcsds.log" or "fdcsds.log")

    // Web interface
    web: true,
    webPort: 3000,
    webHost: "localhost",

    // Terminal serial port (optional second serial port)
    // Use persistent path on Linux for stability:
    terminalPort: "/dev/ttyUSB1",
    // terminalPort: "/dev/serial/by-id/usb-Prolific_USB-Serial_Controller-if00-port0",
    terminalBaud: 9600,
    terminalAutoconnect: false,

    // GPIO LED status indicators (Raspberry Pi only)
    gpioLeds: {
      enabled: true,
      blinkDuration: 100,
      activityBlinkDuration: 50,  // Shorter blink for activity LED
      activeLow: false,
      activityLed: 4,  // GPIO4 (Pin 7) - General drive activity indicator
      drive0: {
        enable: 17,
        headLoad: 27,
        readOnly: 22
      },
      drive1: {
        enable: 23,
        headLoad: 24,
        readOnly: 25
      },
      drive2: {
        enable: 5,
        headLoad: 6,
        readOnly: 13
      },
      drive3: {
        enable: 19,
        headLoad: 26,
        readOnly: 12
      },
      terminal: {
        rx: 16,
        tx: 20,
        connected: 21
      }
    }
  };

  return JSON.stringify(example, null, 2);
}

/**
 * Resolve the data directory path.
 * Returns path.resolve(dataDir) if set, otherwise process.cwd().
 */
export function resolveDataDir(dataDir?: string): string {
  if (dataDir) {
    return path.resolve(dataDir);
  }
  return process.cwd();
}

/**
 * Resolve a drive image path relative to the data directory.
 * Absolute paths are returned as-is; relative paths resolve against dataDir.
 */
export function resolveDrivePath(drivePath: string, dataDir: string): string {
  if (path.isAbsolute(drivePath)) {
    return drivePath;
  }
  return path.resolve(dataDir, drivePath);
}
