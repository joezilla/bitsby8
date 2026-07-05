/**
 * Configuration File Module
 *
 * Zod-backed schema + loader. Every writable knob lives in one of the
 * per-section schemas (Serial / Web / Terminal / Logging / GPIO / Data)
 * so the config API can validate a single section without accepting the
 * whole document, and the frontend can render field constraints
 * straight from `GET /api/config/schema`.
 *
 * `.passthrough()` at the top level and on `gpioLeds` preserves fields
 * we don't (yet) recognise — nothing gets wiped by a UI round-trip.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';
import { GpioLedConfig } from './gpio';

// ---------------------------------------------------------------------------
// Section schemas
// ---------------------------------------------------------------------------

export const SerialSchema = z.object({
  port: z.string().optional(),
  baud: z.number().int().positive().optional(),
  drive0: z.string().nullable().optional(),
  drive1: z.string().nullable().optional(),
  drive2: z.string().nullable().optional(),
  drive3: z.string().nullable().optional(),
  readonly: z.array(z.number().int().min(0).max(3)).optional(),
});

export const WebSchema = z.object({
  web: z.boolean().optional(),
  webPort: z.number().int().min(1).max(65535).optional(),
  webHost: z.string().optional(),
  apiKey: z.string().nullable().optional(),
});

export const TerminalSchema = z.object({
  terminalPort: z.string().optional(),
  terminalBaud: z.number().int().positive().optional(),
  terminalAutoconnect: z.boolean().optional(),
});

export const LoggingSchema = z.object({
  verbose: z.boolean().optional(),
  debug: z.boolean().optional(),
  logFile: z.string().nullable().optional(),
});

export const DataSchema = z.object({
  dataDir: z.string().nullable().optional(),
  terminalOnly: z.boolean().optional(),
});

// GPIO pin numbers are BCM (0-27 on Raspberry Pi). null = disabled.
const GpioPinSchema = z.number().int().min(0).max(27).nullable().optional();
const GpioDrivePinsSchema = z.object({
  enable: GpioPinSchema,
  headLoad: GpioPinSchema,
  readOnly: GpioPinSchema,
});
const GpioTerminalPinsSchema = z.object({
  rx: GpioPinSchema,
  tx: GpioPinSchema,
  connected: GpioPinSchema,
});
export const GpioSchema = z
  .object({
    enabled: z.boolean().default(false),
    activeLow: z.boolean().optional(),
    blinkDuration: z.number().int().positive().optional(),
    activityBlinkDuration: z.number().int().positive().optional(),
    activityLed: GpioPinSchema,
    drive0: GpioDrivePinsSchema.optional(),
    drive1: GpioDrivePinsSchema.optional(),
    drive2: GpioDrivePinsSchema.optional(),
    drive3: GpioDrivePinsSchema.optional(),
    terminal: GpioTerminalPinsSchema.optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Top-level schema
// ---------------------------------------------------------------------------

export const ConfigSchema = z
  .object({
    ...SerialSchema.shape,
    ...WebSchema.shape,
    ...TerminalSchema.shape,
    ...LoggingSchema.shape,
    ...DataSchema.shape,
    gpioLeds: GpioSchema.optional(),
  })
  .passthrough()
  .superRefine((cfg, ctx) => {
    const pins = collectGpioPins(cfg.gpioLeds);
    for (const [pin, paths] of pins) {
      if (paths.length > 1) {
        for (const p of paths) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: p,
            message: `GPIO pin ${pin} is used more than once (also at: ${paths.filter(o => o !== p).map(o => o.join('.')).join(', ')})`,
          });
        }
      }
    }
  });

export type ConfigFile = z.infer<typeof ConfigSchema>;

/** Map of pin → list of dotted paths that reference it. */
function collectGpioPins(gpio: unknown): Map<number, (string | number)[][]> {
  const pins = new Map<number, (string | number)[][]>();
  if (!gpio || typeof gpio !== 'object') return pins;
  const g = gpio as Record<string, unknown>;
  const addPin = (pin: unknown, at: (string | number)[]) => {
    if (typeof pin !== 'number') return;
    const existing = pins.get(pin) ?? [];
    existing.push(['gpioLeds', ...at]);
    pins.set(pin, existing);
  };
  addPin(g.activityLed, ['activityLed']);
  for (const key of ['drive0', 'drive1', 'drive2', 'drive3'] as const) {
    const drive = g[key];
    if (drive && typeof drive === 'object') {
      const d = drive as Record<string, unknown>;
      addPin(d.enable, [key, 'enable']);
      addPin(d.headLoad, [key, 'headLoad']);
      addPin(d.readOnly, [key, 'readOnly']);
    }
  }
  const term = g.terminal;
  if (term && typeof term === 'object') {
    const t = term as Record<string, unknown>;
    addPin(t.rx, ['terminal', 'rx']);
    addPin(t.tx, ['terminal', 'tx']);
    addPin(t.connected, ['terminal', 'connected']);
  }
  return pins;
}

// ---------------------------------------------------------------------------
// Config file locations (default search order, highest to lowest priority)
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG_LOCATIONS = [
  '.fdcsds.config',
  '.config/fdcsds.json',
  'fdcsds.config.json',
  '/etc/fdcplus/fdcsds.config', // System-wide default (lowest priority)
];

/**
 * The result of a successful config-file load. `filePath` is the
 * absolute path the config was actually read from — needed later so
 * writes go back to the same place.
 */
export interface LoadedConfig {
  config: ConfigFile;
  filePath: string;
}

/**
 * Load configuration from file.
 *
 * If `configPath` is given, only that path is tried; missing/invalid files
 * throw. Without a path, the default locations are searched in order and
 * the first readable one is returned. Returns `null` when no default
 * location has a config file (the daemon runs with all-defaults).
 */
export async function loadConfigFile(configPath?: string): Promise<LoadedConfig | null> {
  if (configPath) {
    const absolutePath = path.resolve(configPath);
    try {
      const content = await fs.readFile(absolutePath, 'utf-8');
      return { config: parseConfigContent(content, absolutePath), filePath: absolutePath };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Config file not found: ${configPath}`);
      }
      throw new Error(`Failed to read config file ${configPath}: ${(error as Error).message}`);
    }
  }

  for (const location of DEFAULT_CONFIG_LOCATIONS) {
    const absolutePath = path.resolve(location);
    try {
      const content = await fs.readFile(absolutePath, 'utf-8');
      console.log(`Loaded configuration from: ${location}`);
      return { config: parseConfigContent(content, absolutePath), filePath: absolutePath };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`Warning: Could not read ${location}: ${(error as Error).message}`);
      }
    }
  }

  return null;
}

function parseConfigContent(content: string, filePath: string): ConfigFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`Invalid JSON in config file ${filePath}: ${(error as Error).message}`);
  }
  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const at = issue.path.join('.') || '(root)';
    throw new Error(`Config error in ${filePath}: ${issue.message} at "${at}"`);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// CLI merge (unchanged semantics)
// ---------------------------------------------------------------------------

/**
 * Merge command line options over the loaded config file. CLI wins.
 */
export function mergeConfig(configFile: ConfigFile | null, cmdLineOptions: any): any {
  const merged: any = { ...(configFile ?? {}) };

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

  if (cmdLineOptions.gpioLeds !== undefined) {
    if (!merged.gpioLeds) merged.gpioLeds = { enabled: false };
    merged.gpioLeds.enabled = cmdLineOptions.gpioLeds;
  }
  if (cmdLineOptions.gpioActiveLow !== undefined) {
    if (!merged.gpioLeds) merged.gpioLeds = { enabled: false };
    merged.gpioLeds.activeLow = cmdLineOptions.gpioActiveLow;
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Example generator (used by `--generate-config` and by postinst)
// ---------------------------------------------------------------------------

export function getExampleConfig(): string {
  const example = {
    dataDir: null as string | null,
    port: '/dev/ttyUSB0',
    baud: 230400,
    drive0: 'disks/cpm22.dsk',
    drive1: 'disks/games.dsk',
    drive2: null,
    drive3: null,
    readonly: [0],
    verbose: false,
    debug: false,
    logFile: null,
    web: true,
    webPort: 3000,
    webHost: 'localhost',
    terminalPort: '/dev/ttyUSB1',
    terminalBaud: 9600,
    terminalAutoconnect: false,
    apiKey: null as string | null,
    gpioLeds: {
      enabled: true,
      blinkDuration: 100,
      activityBlinkDuration: 50,
      activeLow: false,
      activityLed: 4,
      drive0: { enable: 17, headLoad: 27, readOnly: 22 },
      drive1: { enable: 23, headLoad: 24, readOnly: 25 },
      drive2: { enable: 5, headLoad: 6, readOnly: 13 },
      drive3: { enable: 19, headLoad: 26, readOnly: 12 },
      terminal: { rx: 16, tx: 20, connected: 21 },
    },
  };

  return JSON.stringify(example, null, 2);
}

// ---------------------------------------------------------------------------
// Data-path helpers (unchanged)
// ---------------------------------------------------------------------------

export function resolveDataDir(dataDir?: string | null): string {
  if (dataDir) return path.resolve(dataDir);
  return process.cwd();
}

export function resolveDrivePath(drivePath: string, dataDir: string): string {
  if (path.isAbsolute(drivePath)) return drivePath;
  return path.resolve(dataDir, drivePath);
}

// ---------------------------------------------------------------------------
// GpioLedConfig re-export
// ---------------------------------------------------------------------------
// The `GpioLedConfig` interface in `src/gpio/gpio-controller.ts` is the
// runtime shape the controller expects. It happens to be structurally
// compatible with the Zod-inferred type here (both have optional
// per-drive pin maps and an optional `enabled: boolean`), so callers can
// pass a parsed `ConfigFile["gpioLeds"]` straight in.
export type { GpioLedConfig };
