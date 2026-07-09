/**
 * Tests for the per-image read-only-write policy store (src/database.ts,
 * disk_policies table) that drives transient copy-on-write backing.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Database } from '../src/database';

async function makeDb(): Promise<Database> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-pol-'));
  const db = new Database(path.join(dir, 'test.db'));
  await db.initialize();
  return db;
}

describe('disk policies', () => {
  test('defaults to inherit when no row exists', async () => {
    const db = await makeDb();
    expect(await db.getDiskPolicy('game.dsk')).toBe('inherit');
  });

  test('set and read back error / transient', async () => {
    const db = await makeDb();
    await db.setDiskPolicy('game.dsk', 'transient');
    expect(await db.getDiskPolicy('game.dsk')).toBe('transient');
    await db.setDiskPolicy('game.dsk', 'error');
    expect(await db.getDiskPolicy('game.dsk')).toBe('error');
  });

  test("setting 'inherit' clears the row (falls back to the global default)", async () => {
    const db = await makeDb();
    await db.setDiskPolicy('game.dsk', 'transient');
    await db.setDiskPolicy('game.dsk', 'inherit');
    expect(await db.getDiskPolicy('game.dsk')).toBe('inherit');
  });

  test('rename moves the policy to the new filename', async () => {
    const db = await makeDb();
    await db.setDiskPolicy('game.dsk', 'transient');
    await db.renameDiskPolicy('game.dsk', 'game2.dsk');
    expect(await db.getDiskPolicy('game.dsk')).toBe('inherit');
    expect(await db.getDiskPolicy('game2.dsk')).toBe('transient');
  });

  test('delete removes the policy', async () => {
    const db = await makeDb();
    await db.setDiskPolicy('game.dsk', 'transient');
    await db.deleteDiskPolicy('game.dsk');
    expect(await db.getDiskPolicy('game.dsk')).toBe('inherit');
  });
});
