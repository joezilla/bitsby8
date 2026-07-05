/**
 * Config-file persistence service.
 *
 * Atomic write-back to the daemon's loaded config file. Every UI save
 * flows through here. Guarantees:
 *
 *   - Preflight `fs.access(W_OK)` before touching anything → if the
 *     daemon can't write, the caller gets a `ConfigWriteError` with a
 *     specific code (mapped to HTTP 403 by the route layer). Never a
 *     500 from a mid-flight EACCES.
 *   - Zod-validate the merged document before it hits disk. Rejection
 *     is surfaced as issues the API can render inline.
 *   - Atomic write: `<file>.tmp` → `fsync` → `rename`. If we crash
 *     mid-rename the original file is untouched.
 *   - Rotating backups `<file>.bak.1..3`. `bak.1` is the newest.
 */

import * as fs from 'fs/promises';
import { constants as FS } from 'fs';
import * as path from 'path';
import { ConfigFile, ConfigSchema } from '../config';

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

/** Read the current on-disk config, returning both the parsed object and the raw text. */
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
 * Apply `patch` on top of the current config file at `filePath`, then
 * atomically write the result back. Returns the new (parsed) config and
 * the fresh `mtimeMs` so the caller can emit an ETag / If-Match token.
 *
 * `patch` is merged shallowly at the top level (drives, GPIO tree, etc.
 * are replaced wholesale, not deep-merged) — matches how per-section
 * PUTs are meant to work: the caller sends the section subtree it owns
 * and gets that subtree written verbatim.
 */
export async function writePartialConfig(
  filePath: string,
  patch: Partial<ConfigFile>,
): Promise<{ config: ConfigFile; mtimeMs: number }> {
  if (!filePath) {
    throw new ConfigWriteError(
      'NO_CONFIG_FILE',
      'No config file was loaded at startup — the daemon has nothing to write to. ' +
        'Start with --config <path> or drop a config file into one of the default locations.',
    );
  }

  await preflightWritable(filePath);
  const { config: current } = await readCurrentConfig(filePath);

  const merged = { ...current, ...patch } as unknown;
  const result = ConfigSchema.safeParse(merged);
  if (!result.success) {
    throw new ConfigWriteError(
      'VALIDATION_FAILED',
      result.error.issues[0].message,
      result.error.issues.map(i => ({ path: normalizeIssuePath(i.path), message: i.message })),
    );
  }

  await rotateBackups(filePath);
  await atomicWrite(filePath, JSON.stringify(result.data, null, 2) + '\n');

  const stat = await fs.stat(filePath);
  return { config: result.data, mtimeMs: stat.mtimeMs };
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
  // (someone might legitimately be recovering from a corrupted file).
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
        `Config file ${filePath} is not writable by the current user. ` +
          `On a .deb install run \`sudo chown fdcsds:fdcsds "${filePath}" && sudo chmod 664 "${filePath}"\`.`,
      );
    } else {
      throw err;
    }
  }
  try {
    await fs.access(path.dirname(filePath), FS.W_OK);
  } catch {
    throw new ConfigWriteError(
      'NOT_WRITABLE',
      `Config file ${filePath} is missing and its parent directory is not writable.`,
    );
  }
}

/**
 * Restore `.bak.1` on top of the live config file. Backups shift up
 * (`.bak.2` → `.bak.1`, `.bak.3` → `.bak.2`, oldest is dropped) so
 * repeated rollbacks walk further back through history.
 *
 * Fails with `NO_CONFIG_FILE` if there's no `.bak.1` — that only
 * happens on a brand-new install that's never been saved through the
 * UI, and there's nothing meaningful to roll back to in that case.
 */
export async function rollbackConfig(
  filePath: string,
): Promise<{ config: ConfigFile; mtimeMs: number }> {
  if (!filePath) {
    throw new ConfigWriteError('NO_CONFIG_FILE', 'No config file was loaded.');
  }
  const bak1 = `${filePath}.bak.1`;
  try {
    await fs.access(bak1);
  } catch {
    throw new ConfigWriteError(
      'NO_CONFIG_FILE',
      `No backup to roll back to at ${bak1}.`,
    );
  }
  await preflightWritable(filePath);

  // Validate the backup before we clobber the live file. A corrupt
  // .bak.1 means whichever earlier save wrote it must have been bad —
  // don't compound the problem by promoting garbage.
  let restored: ConfigFile;
  try {
    const raw = await fs.readFile(bak1, 'utf-8');
    const parsed = JSON.parse(raw);
    const result = ConfigSchema.safeParse(parsed);
    if (!result.success) {
      throw new ConfigWriteError(
        'VALIDATION_FAILED',
        `Backup at ${bak1} would not validate: ${result.error.issues[0].message}`,
        result.error.issues.map(i => ({ path: normalizeIssuePath(i.path), message: i.message })),
      );
    }
    restored = result.data;
  } catch (err) {
    if (err instanceof ConfigWriteError) throw err;
    throw new ConfigWriteError(
      'INVALID_JSON',
      `Backup at ${bak1} is unreadable: ${(err as Error).message}`,
    );
  }

  // Slide bak.2 → bak.1, bak.3 → bak.2 so the caller can roll back
  // further. Missing higher-numbered backups are fine.
  await atomicWrite(filePath, JSON.stringify(restored, null, 2) + '\n');
  for (let i = 1; i < MAX_BACKUPS; i++) {
    const from = `${filePath}.bak.${i + 1}`;
    const to = `${filePath}.bak.${i}`;
    try {
      await fs.rename(from, to);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // The old .bak.1 slot needs clearing if bak.2 didn't exist, so
        // a second consecutive rollback doesn't restore the same file.
        if (i === 1) {
          try { await fs.unlink(to); } catch { /* ignore */ }
        }
      } else {
        throw err;
      }
    }
  }

  const stat = await fs.stat(filePath);
  return { config: restored, mtimeMs: stat.mtimeMs };
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
