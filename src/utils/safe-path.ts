/**
 * Path safety utilities for preventing directory traversal and symlink escapes.
 */

import * as path from 'path';
import { existsSync, realpathSync } from 'fs';

/**
 * Resolve a filename within a root directory, verifying no symlink escapes the root.
 * Returns null if the file doesn't exist or resolves outside the root.
 */
export function safeResolvePath(root: string, filename: string): string | null {
  const joined = path.join(root, filename);
  if (!existsSync(joined)) return null;
  try {
    const resolvedRoot = realpathSync(root);
    const resolvedFile = realpathSync(joined);
    const normalizedRoot = resolvedRoot.endsWith(path.sep)
      ? resolvedRoot
      : resolvedRoot + path.sep;
    if (!resolvedFile.startsWith(normalizedRoot)) return null;
    return resolvedFile;
  } catch {
    return null;
  }
}

/**
 * Return a safe error message for HTTP responses, suppressing internal details.
 */
export function safeErrorMessage(error: unknown, fallback = 'Internal server error'): string {
  const msg = (error as Error)?.message ?? '';
  const safePatterns = [
    /^File not found/i,
    /^Disk image not found/i,
    /^Drive \d+ is/i,
    /^Cannot delete/i,
    /^Filename is required/i,
    /^Invalid filename/i,
    /^Invalid drive ID/i,
    /^Invalid script/i,
    /^No file uploaded/i,
    /^Only .* files are allowed/i,
    /^not found$/i,
    /^CP\/M/i,
    /^Script /i,
    /^Serial port/i,
    /^Port /i,
    /^No serial port/i,
    /^Baud rate/i,
    /^Server (is|not|already)/i,
    /^Replay/i,
    /^Already playing/i,
    /^No (active|current)/i,
  ];
  if (safePatterns.some((p) => p.test(msg))) return msg;
  return fallback;
}
