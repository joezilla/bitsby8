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
