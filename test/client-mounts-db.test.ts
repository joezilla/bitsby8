/**
 * Tests for the per-client drive-bay override + label tables (client_mounts,
 * client_labels) and the known-client-id enumeration.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Database } from '../src/database';

async function makeDb(): Promise<Database> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-cm-'));
  const db = new Database(path.join(dir, 'test.db'));
  await db.initialize();
  return db;
}

describe('client_mounts', () => {
  test('get returns null when unset; set/get round-trips', async () => {
    const db = await makeDb();
    expect(await db.getClientMount('a', 0)).toBeNull();
    await db.setClientMount('a', 0, 'game.dsk', true);
    const row = await db.getClientMount('a', 0);
    expect(row).toMatchObject({ client_id: 'a', drive: 0, filename: 'game.dsk', readonly: 1 });
  });

  test('set upserts on the same (client, drive)', async () => {
    const db = await makeDb();
    await db.setClientMount('a', 0, 'game.dsk', true);
    await db.setClientMount('a', 0, 'other.dsk', false);
    const row = await db.getClientMount('a', 0);
    expect(row).toMatchObject({ filename: 'other.dsk', readonly: 0 });
    expect(await db.listClientMounts('a')).toHaveLength(1);
  });

  test('listClientMounts scopes by client or returns all', async () => {
    const db = await makeDb();
    await db.setClientMount('a', 0, 'a0.dsk', false);
    await db.setClientMount('a', 1, 'a1.dsk', false);
    await db.setClientMount('b', 0, 'b0.dsk', false);
    expect(await db.listClientMounts('a')).toHaveLength(2);
    expect(await db.listClientMounts()).toHaveLength(3);
  });

  test('delete clears one drive override', async () => {
    const db = await makeDb();
    await db.setClientMount('a', 0, 'game.dsk', false);
    await db.deleteClientMount('a', 0);
    expect(await db.getClientMount('a', 0)).toBeNull();
  });

  test('deleteForBase / renameBase cascade', async () => {
    const db = await makeDb();
    await db.setClientMount('a', 0, 'game.dsk', false);
    await db.setClientMount('b', 1, 'game.dsk', false);
    await db.setClientMount('c', 0, 'keep.dsk', false);

    await db.renameClientMountsBase('game.dsk', 'renamed.dsk');
    expect((await db.getClientMount('a', 0))!.filename).toBe('renamed.dsk');

    await db.deleteClientMountsForBase('renamed.dsk');
    expect(await db.getClientMount('a', 0)).toBeNull();
    expect(await db.getClientMount('b', 1)).toBeNull();
    expect(await db.getClientMount('c', 0)).not.toBeNull();
  });

  test('deleteForClient removes all of a client\'s overrides', async () => {
    const db = await makeDb();
    await db.setClientMount('a', 0, 'x.dsk', false);
    await db.setClientMount('a', 1, 'y.dsk', false);
    await db.deleteClientMountsForClient('a');
    expect(await db.listClientMounts('a')).toHaveLength(0);
  });
});

describe('client_labels + known ids', () => {
  test('label set/get/delete', async () => {
    const db = await makeDb();
    expect(await db.getClientLabel('a')).toBeNull();
    await db.setClientLabel('a', 'Lab Altair');
    expect((await db.getClientLabel('a'))!.name).toBe('Lab Altair');
    await db.deleteClientLabel('a');
    expect(await db.getClientLabel('a')).toBeNull();
  });

  test('listKnownClientIds unions mounts, splinters, and labels (distinct)', async () => {
    const db = await makeDb();
    await db.setClientMount('a', 0, 'x.dsk', false);
    await db.upsertClientSplinter('b', 0, 'x.dsk', '/tmp/b.img', true);
    await db.setClientLabel('c', 'C');
    await db.setClientLabel('a', 'A'); // duplicate id across tables
    const ids = (await db.listKnownClientIds()).sort();
    expect(ids).toEqual(['a', 'b', 'c']);
  });
});
