/**
 * Tests for the generic DB settings store and the multi-client feature flag.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Database } from '../src/database';
import { getMultiClientServing, setMultiClientServing } from '../src/services/feature-flags';

async function makeDb(): Promise<Database> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-set-'));
  const db = new Database(path.join(dir, 'test.db'));
  await db.initialize();
  return db;
}

describe('settings store', () => {
  test('getSetting returns null when unset', async () => {
    const db = await makeDb();
    expect(await db.getSetting('nope')).toBeNull();
  });

  test('setSetting then getSetting round-trips and upserts', async () => {
    const db = await makeDb();
    await db.setSetting('k', 'v1');
    expect(await db.getSetting('k')).toBe('v1');
    await db.setSetting('k', 'v2');
    expect(await db.getSetting('k')).toBe('v2');
  });
});

describe('multi-client feature flag', () => {
  test('defaults to false when unset', async () => {
    const db = await makeDb();
    expect(await getMultiClientServing(db)).toBe(false);
  });

  test('enable then disable round-trips', async () => {
    const db = await makeDb();
    await setMultiClientServing(db, true);
    expect(await getMultiClientServing(db)).toBe(true);
    await setMultiClientServing(db, false);
    expect(await getMultiClientServing(db)).toBe(false);
  });
});
