/**
 * Configuration File Module
 *
 * Zod-backed schema + loader. Every writable knob lives in one of the
 * per-section schemas (Serial / Web / Terminal / Logging / Data)
 * so the config API can validate a single section without accepting the
 * whole document, and the frontend can render field constraints
 * straight from `GET /api/config/schema`.
 *
 * `.passthrough()` at the top level preserves fields we don't (yet)
 * recognise — nothing gets wiped by a UI round-trip.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';

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
    system: SystemSchema.optional(),
  })
  .passthrough();

/**
 * Permissive schema used to parse the runtime override file.
 *
 * Same shape as `ConfigSchema`. The override file is a *partial*
 * document — missing keys mean "fall through to the baseline" — so it
 * stays fully passthrough and doesn't materialise defaults during load.
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
    system: SystemSchema.optional(),
  })
  .passthrough();

export type ConfigFile = z.infer<typeof ConfigSchema>;

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
 * on top of a baseline. Shallow at the top level.
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
