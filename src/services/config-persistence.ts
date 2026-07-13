/**
 * Config-file persistence service.
 *
 * Atomic write-back to the daemon's *runtime override* file. Every UI
 * save flows through here. Guarantees:
 *
 *   - Preflight `fs.access(W_OK)` before touching anything → if the
 *     daemon can't write, the caller gets a `ConfigWriteError` with a
 *     specific code (mapped to HTTP 403 by the route layer). Never a
 *     500 from a mid-flight EACCES.
 *   - Zod-validate the merged override, then Zod-validate the effective
 *     (baseline + override) doc before the file hits disk. The second
 *     validation is what catches any cross-layer rules spanning baseline
 *     and override.
 *   - Atomic write: `<file>.tmp` → `fsync` → `rename`. If we crash
 *     mid-rename the original file is untouched.
 *   - Rotating backups `<file>.bak.1..3`. `bak.1` is the newest.
 *
 * The daemon never writes to `/etc/fdcsds/fdcsds.config.json` (the
 * package baseline / dpkg conffile). All UI-driven changes land in
 * `${dataDir}/fdcsds.overrides.json`, layered on top of the baseline
 * at daemon startup by `mergeConfigLayers` in `src/config.ts`.
 */

import * as fs from 'fs/promises';
import { constants as FS } from 'fs';
import * as path from 'path';
import {
  ConfigFile,
  ConfigSchema,
  OverrideConfig,
  OverrideConfigSchema,
  mergeConfigLayers,
} from '../config';

export const MAX_BACKUPS = 3;

export type ConfigWriteErrorCode =
  | 'NO_CONFIG_FILE'
  | 'NOT_WRITABLE'
  | 'INVALID_JSON'
  | 'VALIDATION_FAILED'
  | 'WRITE_FAILED';

export class ConfigWriteError extends Error {
  constructor(
    public readonly code: ConfigWriteErrorCode,
    message: string,
    public readonly issues?: Array<{ path: (string | number)[]; message: string }>,
  ) {
    super(message);
    this.name = 'ConfigWriteError';
  }
}

/**
 * Read the current on-disk config file at `filePath`, validating against
 * the full `ConfigSchema` (i.e. treats the file as a complete config).
 * Retained for tests and any consumer that needs the strict view.
 */
export async function readCurrentConfig(
  filePath: string,
): Promise<{ config: ConfigFile; raw: string; mtimeMs: number }> {
  const raw = await fs.readFile(filePath, 'utf-8');
  const stat = await fs.stat(filePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ConfigWriteError(
      'INVALID_JSON',
      `Existing config file at ${filePath} is not valid JSON: ${(err as Error).message}`,
    );
  }
  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigWriteError(
      'VALIDATION_FAILED',
      `Existing config file failed validation: ${result.error.issues[0].message}`,
      result.error.issues.map(i => ({ path: normalizeIssuePath(i.path), message: i.message })),
    );
  }
  return { config: result.data, raw, mtimeMs: stat.mtimeMs };
}

/**
 * Read the current override file at `overrideFilePath` (permissive schema
 * — missing keys are valid). Returns an empty `{}` when the file doesn't
 * exist (a fresh install has never touched runtime overrides).
 */
async function readCurrentOverride(
  overrideFilePath: string,
): Promise<OverrideConfig> {
  let raw: string;
  try {
    raw = await fs.readFile(overrideFilePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ConfigWriteError(
      'INVALID_JSON',
      `Existing override file at ${overrideFilePath} is not valid JSON: ${(err as Error).message}`,
    );
  }
  const result = OverrideConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigWriteError(
      'VALIDATION_FAILED',
      `Existing override file failed validation: ${result.error.issues[0].message}`,
      result.error.issues.map(i => ({ path: normalizeIssuePath(i.path), message: i.message })),
    );
  }
  return result.data as OverrideConfig;
}

/**
 * Apply `patch` on top of the current override file at
 * `overrideFilePath`, then atomically write the result back.
 *
 * `patch` is merged shallowly at the top level over the current
 * override. The merged override is validated as a partial document; the
 * effective (baseline + newOverride) document is then validated against
 * the full `ConfigSchema` so any cross-layer rules fire.
 *
 * Returns the new *effective* config (what the daemon would see after a
 * restart) plus the override file's fresh mtime for ETag generation.
 */
export async function writePartialConfig(
  overrideFilePath: string,
  patch: Partial<ConfigFile>,
  baseline: ConfigFile | null,
): Promise<{ config: ConfigFile; mtimeMs: number }> {
  if (!overrideFilePath) {
    throw new ConfigWriteError(
      'NO_CONFIG_FILE',
      'No override file path was configured — the daemon has no writable location for runtime overrides.',
    );
  }

  await preflightWritable(overrideFilePath);
  const currentOverride = await readCurrentOverride(overrideFilePath);

  const mergedOverride = { ...currentOverride, ...patch } as OverrideConfig;

  const overrideResult = OverrideConfigSchema.safeParse(mergedOverride);
  if (!overrideResult.success) {
    throw new ConfigWriteError(
      'VALIDATION_FAILED',
      overrideResult.error.issues[0].message,
      overrideResult.error.issues.map(i => ({ path: normalizeIssuePath(i.path), message: i.message })),
    );
  }

  const effective = mergeConfigLayers(baseline, overrideResult.data as OverrideConfig);
  const effectiveResult = ConfigSchema.safeParse(effective);
  if (!effectiveResult.success) {
    throw new ConfigWriteError(
      'VALIDATION_FAILED',
      effectiveResult.error.issues[0].message,
      effectiveResult.error.issues.map(i => ({ path: normalizeIssuePath(i.path), message: i.message })),
    );
  }

  await rotateBackups(overrideFilePath);
  await atomicWrite(
    overrideFilePath,
    JSON.stringify(overrideResult.data, null, 2) + '\n',
  );

  const stat = await fs.stat(overrideFilePath);
  return { config: effectiveResult.data, mtimeMs: stat.mtimeMs };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Zod 4's issue paths are `PropertyKey[]` which include symbol; filter to string/number. */
function normalizeIssuePath(zPath: readonly PropertyKey[]): (string | number)[] {
  return zPath.map(seg => (typeof seg === 'string' || typeof seg === 'number' ? seg : String(seg)));
}

async function preflightWritable(filePath: string): Promise<void> {
  // The file itself must be writable OR the directory must accept a
  // temp file. Check the file; if it's missing, check the directory
  // (fresh install: override file doesn't exist yet).
  try {
    await fs.access(filePath, FS.W_OK);
    return;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      // Fall through to directory check.
    } else if (code === 'EACCES' || code === 'EPERM') {
      throw new ConfigWriteError(
        'NOT_WRITABLE',
        `Override file ${filePath} is not writable by the current user. ` +
          `On a .deb install run \`sudo chown fdcsds:fdcsds "${filePath}" && sudo chmod 664 "${filePath}"\`.`,
      );
    } else if (code === 'EROFS') {
      // On the .deb install the override lives under /var/lib/fdcsds
      // which should be writable by the fdcsds service user. If we
      // still see EROFS here it means the systemd unit's
      // `ReadWritePaths=` is missing the state directory.
      throw new ConfigWriteError(
        'NOT_WRITABLE',
        `Override file ${filePath} is on a read-only filesystem. ` +
          `Check that /var/lib/fdcsds is owned by the fdcsds service user and that ` +
          `the systemd unit lists it in ReadWritePaths=.`,
      );
    } else {
      throw err;
    }
  }
  try {
    await fs.access(path.dirname(filePath), FS.W_OK);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EROFS') {
      throw new ConfigWriteError(
        'NOT_WRITABLE',
        `Directory ${path.dirname(filePath)} is on a read-only filesystem. ` +
          `Check /var/lib/fdcsds is owned by the fdcsds service user and included in the systemd unit's ReadWritePaths=.`,
      );
    }
    throw new ConfigWriteError(
      'NOT_WRITABLE',
      `Override file ${filePath} is missing and its parent directory is not writable.`,
    );
  }
}

/**
 * Restore `.bak.1` on top of the live override file. Backups shift up
 * (`.bak.2` → `.bak.1`, `.bak.3` → `.bak.2`, oldest is dropped) so
 * repeated rollbacks walk further back through history.
 *
 * Returns the new effective config (baseline + restored override) so the
 * caller can hand it straight back to the client, and a friendly
 * "nothing to roll back" error when no backup exists.
 */
export async function rollbackConfig(
  overrideFilePath: string,
  baseline: ConfigFile | null,
): Promise<{ config: ConfigFile; mtimeMs: number }> {
  if (!overrideFilePath) {
    throw new ConfigWriteError('NO_CONFIG_FILE', 'No override file path was configured.');
  }
  const bak1 = `${overrideFilePath}.bak.1`;
  try {
    await fs.access(bak1);
  } catch {
    throw new ConfigWriteError(
      'NO_CONFIG_FILE',
      `No runtime changes to roll back — the daemon has not written a backup yet.`,
    );
  }
  await preflightWritable(overrideFilePath);

  let restored: OverrideConfig;
  try {
    const raw = await fs.readFile(bak1, 'utf-8');
    const parsed = JSON.parse(raw);
    const result = OverrideConfigSchema.safeParse(parsed);
    if (!result.success) {
      throw new ConfigWriteError(
        'VALIDATION_FAILED',
        `Backup at ${bak1} would not validate: ${result.error.issues[0].message}`,
        result.error.issues.map(i => ({ path: normalizeIssuePath(i.path), message: i.message })),
      );
    }
    restored = result.data as OverrideConfig;
  } catch (err) {
    if (err instanceof ConfigWriteError) throw err;
    throw new ConfigWriteError(
      'INVALID_JSON',
      `Backup at ${bak1} is unreadable: ${(err as Error).message}`,
    );
  }

  // Cross-layer validation on the restored effective doc so a
  // backup-with-pin-conflict-against-current-baseline doesn't silently
  // promote to live.
  const effective = mergeConfigLayers(baseline, restored);
  const effectiveResult = ConfigSchema.safeParse(effective);
  if (!effectiveResult.success) {
    throw new ConfigWriteError(
      'VALIDATION_FAILED',
      `Rolled-back effective config failed validation: ${effectiveResult.error.issues[0].message}`,
      effectiveResult.error.issues.map(i => ({ path: normalizeIssuePath(i.path), message: i.message })),
    );
  }

  await atomicWrite(overrideFilePath, JSON.stringify(restored, null, 2) + '\n');
  for (let i = 1; i < MAX_BACKUPS; i++) {
    const from = `${overrideFilePath}.bak.${i + 1}`;
    const to = `${overrideFilePath}.bak.${i}`;
    try {
      await fs.rename(from, to);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // Clear the old .bak.1 slot if bak.2 didn't exist, so a second
        // consecutive rollback doesn't restore the same file.
        if (i === 1) {
          try { await fs.unlink(to); } catch { /* ignore */ }
        }
      } else {
        throw err;
      }
    }
  }

  const stat = await fs.stat(overrideFilePath);
  return { config: effectiveResult.data, mtimeMs: stat.mtimeMs };
}

async function rotateBackups(filePath: string): Promise<void> {
  // shift 2 → 3, 1 → 2, current → 1. Missing files are OK.
  for (let i = MAX_BACKUPS - 1; i >= 1; i--) {
    const from = `${filePath}.bak.${i}`;
    const to = `${filePath}.bak.${i + 1}`;
    try {
      await fs.rename(from, to);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
  try {
    await fs.copyFile(filePath, `${filePath}.bak.1`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    // No existing file to back up — first write into an empty slot.
  }
}

async function atomicWrite(filePath: string, contents: string): Promise<void> {
  const tmp = `${filePath}.tmp`;
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(tmp, 'w', 0o664);
    await handle.writeFile(contents, 'utf-8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(tmp, filePath);
  } catch (err) {
    if (handle) {
      try { await handle.close(); } catch { /* ignore */ }
    }
    try { await fs.unlink(tmp); } catch { /* ignore */ }
    throw new ConfigWriteError(
      'WRITE_FAILED',
      `Atomic write to ${filePath} failed: ${(err as Error).message}`,
    );
  }
}
