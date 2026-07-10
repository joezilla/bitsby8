/**
 * Operator-facing runtime feature flags, stored in the DB settings table (not
 * the config file) so they apply live and are managed from the UI. See
 * CLAUDE.md "Configuration conventions".
 */

import { Database } from '../database';

/** Gates the multi-client disk-serving capability (concurrent clients +
 *  per-client copy-on-write "splinter" images). Default OFF: the server
 *  behaves exactly as a single-client server until an operator enables it. */
export const MULTI_CLIENT_SERVING_KEY = 'multiClientServing';

export async function getMultiClientServing(db: Database): Promise<boolean> {
  return (await db.getSetting(MULTI_CLIENT_SERVING_KEY)) === 'true';
}

export async function setMultiClientServing(db: Database, enabled: boolean): Promise<void> {
  await db.setSetting(MULTI_CLIENT_SERVING_KEY, enabled ? 'true' : 'false');
}

/** Which client writes the base image directly (others splinter). A clientId,
 *  or 'serial' (the physical device, default), or 'none' (all splinter). */
export const WRITE_MASTER_KEY = 'writeMaster';

export async function getWriteMaster(db: Database): Promise<string> {
  return (await db.getSetting(WRITE_MASTER_KEY)) ?? 'serial';
}

export async function setWriteMaster(db: Database, value: string): Promise<void> {
  await db.setSetting(WRITE_MASTER_KEY, value);
}
