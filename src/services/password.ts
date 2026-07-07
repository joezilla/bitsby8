/**
 * Password hashing thin wrapper.
 *
 * bcryptjs (pure JS) rather than native `bcrypt` — the .deb targets
 * Raspberry Pi (ARM), and native modules have been a recurring
 * postinst-rebuild pain point (see the better-sqlite3 rebuild block
 * in debian/postinst). bcryptjs runs everywhere Node runs, zero
 * dependencies, no ABI matching.
 *
 * Cost factor 10 was chosen deliberately:
 *   - ~50-80ms on a Pi 4, ~150-250ms on a Pi Zero 2.
 *   - Cost 12 pushes Pi Zero login latency close to 1 second, which
 *     feels broken.
 *   - Hashing is invoked once at config-save and once per login;
 *     never in a hot path.
 *
 * Both functions are async and use bcryptjs' `setImmediate`-based
 * scheduling so the event loop isn't blocked while we hash on the Pi
 * Zero's single core.
 */

import bcrypt from 'bcryptjs';

export const BCRYPT_COST = 10;

/** Hash a plaintext password and return the bcrypt hash string. */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

/**
 * Verify a plaintext password against a stored bcrypt hash. Returns
 * false on any error (malformed hash, cost-parameter mismatch, etc.)
 * rather than throwing — auth failures shouldn't propagate as 500s.
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}
