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
  // Default behavior when the guest writes to a read-only image:
  //   'error'     — refuse the write (write-protect; the historical behavior)
  //   'transient' — back the image with a throwaway copy-on-write scratch so
  //                 the write succeeds and the master stays pristine
  // Absent = 'error'. A per-image policy (disk_policies table) overrides this.
  readonlyWritePolicy: z.enum(['error', 'transient']).optional(),
});

export const WebSchema = z.object({
  web: z.boolean().optional(),
  webPort: z.number().int().min(1).max(65535).optional(),
  webHost: z.string().optional(),
  // Machine-only token. Curl scripts and MCP-over-HTTP clients pass
  // this in Authorization: Bearer. Stored as-is (opaque string).
  apiKey: z.string().nullable().optional(),
  // Human login credential for the UI. Stored as a bcrypt hash string
  // (never plaintext). PUT /api/config/web pre-hashes the field before
  // it hits this schema, so anything written to the override file at
  // rest is already a bcrypt digest.
  adminPassword: z.string().nullable().optional(),
});

export const McpSchema = z.object({
  enableMcpHttp: z.boolean().optional(),
});

// Disk-serving transport toggles. `enableWsTransport` gates the
// TCP-based (WebSocket) FDC transport at /fdc-ws that lets a virtual
// Altair FDC client take over disk serving without a physical serial
// port. Absent = on: the feature is enabled by default, and only an
// explicit `false` turns it off.
export const DiskServingSchema = z.object({
  enableWsTransport: z.boolean().optional(),
});

export const TerminalSchema = z.object({
  terminalPort: z.string().optional(),
  terminalBaud: z.number().int().positive().optional(),
  terminalAutoconnect: z.boolean().optional(),
  terminalBackspaceMode: z.enum(['del', 'bs']).optional(),
  terminalLocalEcho: z.boolean().optional(),
  terminalCrMode: z.enum(['cr', 'crlf']).optional(),
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

// system.updateCheck: opt-out for the GitHub release poll.
// Operator-level toggle — not yet surfaced in the config UI.
export const SystemSchema = z.object({
  updateCheck: z
    .object({
      enabled: z.boolean().optional(),
      intervalHours: z.number().int().min(1).optional(),
    })
    .optional(),
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

// Variant used to parse the runtime override file. `enabled` is optional
// with no default here — otherwise Zod would inject `enabled: false` when
// the override document names `gpioLeds` without an explicit `enabled`
// key, which then wins in the shallow merge and silently disables LEDs
// the baseline had turned on.
const GpioSchemaOverride = z
  .object({
    enabled: z.boolean().optional(),
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
    ...McpSchema.shape,
    ...DiskServingSchema.shape,
    ...TerminalSchema.shape,
    ...LoggingSchema.shape,
    ...DataSchema.shape,
    gpioLeds: GpioSchema.optional(),
    system: SystemSchema.optional(),
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

/**
 * Permissive schema used to parse the runtime override file.
 *
 * Same shape as `ConfigSchema` but with the `gpioLeds` sub-schema
 * variant that does NOT default `enabled` to false. The override file
 * is a *partial* document — missing keys mean "fall through to the
 * baseline" — so we can't have Zod materialise defaults during load.
 *
 * The cross-cutting `superRefine` (GPIO pin dedup) intentionally isn't
 * attached here: overrides on their own are half-configs; the merged
 * baseline+override doc is what needs the dedup check, and that's
 * validated separately at write time.
 */
export const OverrideConfigSchema = z
  .object({
    ...SerialSchema.shape,
    ...WebSchema.shape,
    ...McpSchema.shape,
    ...DiskServingSchema.shape,
    ...TerminalSchema.shape,
    ...LoggingSchema.shape,
    ...DataSchema.shape,
    gpioLeds: GpioSchemaOverride.optional(),
    system: SystemSchema.optional(),
  })
  .passthrough();

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
      // Corrupted primary — try to rescue from the rotating backups
      // so a bad save doesn't brick startup. Otherwise re-throw.
      const rescued = await tryLoadFromBackup(absolutePath);
      if (rescued) return rescued;
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
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      // File existed but was corrupt/invalid. Try backups before
      // giving up on this location — better a stale-but-valid config
      // than dropping to defaults on every startup after a bad save.
      const rescued = await tryLoadFromBackup(absolutePath);
      if (rescued) return rescued;
      console.warn(`Warning: Could not read ${location}: ${(error as Error).message}`);
    }
  }

  return null;
}

/**
 * Try `<filePath>.bak.1`, `.bak.2`, `.bak.3` in order and return the
 * first one that parses cleanly. Used when the primary config file
 * fails to load — an atomic-write crash between rename phases would
 * be one way to end up here, but the more common one is that an
 * operator hand-edited the config file and left it invalid.
 */
async function tryLoadFromBackup(filePath: string): Promise<LoadedConfig | null> {
  for (let i = 1; i <= 3; i++) {
    const bak = `${filePath}.bak.${i}`;
    try {
      const content = await fs.readFile(bak, 'utf-8');
      const config = parseConfigContent(content, bak);
      console.warn(`WARN: primary config file at ${filePath} was invalid — loaded from ${bak}.`);
      console.warn('      Save from the web UI to promote this backup to the primary file.');
      // The daemon still writes to `filePath` on the next save, so
      // treat that as the effective config path. `writePartialConfig`
      // will atomically overwrite the corrupted primary at that point.
      return { config, filePath };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      // Backup existed but is also invalid — keep walking.
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
// Runtime override layer
// ---------------------------------------------------------------------------

/**
 * Standard filename for the runtime override file inside `dataDir`.
 * Deliberately distinct from any name in `DEFAULT_CONFIG_LOCATIONS` so
 * a dev-mode override in the repo CWD is never re-detected as a
 * baseline on the next startup.
 */
export const OVERRIDE_FILENAME = 'fdcsds.overrides.json';

/**
 * A parsed override document. Fields are all optional — an override
 * only names the keys the operator has explicitly changed. Missing
 * keys fall through to the baseline during effective-config merge.
 */
export type OverrideConfig = Partial<ConfigFile>;

export interface LoadedOverride {
  config: OverrideConfig;
  filePath: string;
}

/**
 * Load the runtime override file from a specific path.
 *
 * Returns `null` cleanly when the file doesn't exist — a fresh install
 * has never saved any config through the UI, and that's a valid
 * steady state (effective config == baseline). Backup rescue mirrors
 * `loadConfigFile`.
 */
export async function loadOverridesFile(overridePath: string): Promise<LoadedOverride | null> {
  const absolutePath = path.resolve(overridePath);
  try {
    const content = await fs.readFile(absolutePath, 'utf-8');
    return { config: parseOverrideContent(content, absolutePath), filePath: absolutePath };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    // Corrupt primary — try the rotating backups so a bad save doesn't
    // permanently mask the /etc baseline. Any exception during backup
    // rescue is swallowed in favour of "no override" — losing overrides
    // is recoverable, dropping the daemon to nothing is not.
    const rescued = await tryLoadOverrideFromBackup(absolutePath);
    if (rescued) return rescued;
    console.warn(
      `Warning: override file ${absolutePath} is invalid and no backup rescued — continuing with baseline only. Reason: ${(error as Error).message}`,
    );
    return null;
  }
}

async function tryLoadOverrideFromBackup(filePath: string): Promise<LoadedOverride | null> {
  for (let i = 1; i <= 3; i++) {
    const bak = `${filePath}.bak.${i}`;
    try {
      const content = await fs.readFile(bak, 'utf-8');
      const config = parseOverrideContent(content, bak);
      console.warn(`WARN: override file at ${filePath} was invalid — loaded from ${bak}.`);
      return { config, filePath };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      // corrupt backup — try the next one
    }
  }
  return null;
}

function parseOverrideContent(content: string, filePath: string): OverrideConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`Invalid JSON in override file ${filePath}: ${(error as Error).message}`);
  }
  const result = OverrideConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const at = issue.path.join('.') || '(root)';
    throw new Error(`Override error in ${filePath}: ${issue.message} at "${at}"`);
  }
  return result.data as OverrideConfig;
}

/**
 * Compute the effective runtime config by layering an override document
 * on top of a baseline. Shallow at the top level: `gpioLeds` in the
 * override replaces the baseline gpioLeds wholesale, matching how the
 * UI's GPIO save handler ships the full subtree.
 *
 * Uses `Object.hasOwn` so an explicit `null` in the override (e.g.
 * unsetting `drive1`) beats a non-null baseline value. A truthiness
 * check would swallow that intentional erasure.
 */
export function mergeConfigLayers(
  baseline: ConfigFile | null,
  overrides: OverrideConfig | null,
): ConfigFile {
  const b = (baseline ?? {}) as Record<string, unknown>;
  const o = (overrides ?? {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...b };
  for (const key of Object.keys(o)) {
    if (Object.hasOwn(o, key)) {
      merged[key] = o[key];
    }
  }
  return merged as ConfigFile;
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
  if (cmdLineOptions.mcpHttp !== undefined) merged.enableMcpHttp = cmdLineOptions.mcpHttp;

  if (cmdLineOptions.terminalOnly !== undefined) merged.terminalOnly = cmdLineOptions.terminalOnly;
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
    enableMcpHttp: false,
    enableWsTransport: true,
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
