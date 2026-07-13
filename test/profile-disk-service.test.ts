/**
 * Tests for per-profile startup disk mounts (Bitsby8). CRUD over the
 * profile_disks side table, image-existence validation, name-scoping (shared
 * across versions), and the preset/inline guard.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Database } from '../src/database';
import { Dependencies } from '../src/types';
import {
  listProfileDisks,
  setProfileDisk,
  clearProfileDisk,
  profileNameOf,
} from '../src/services/profile-disk-service';

async function makeDeps(): Promise<{ deps: Dependencies; disksDir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-pdisk-'));
  const disksDir = path.join(dir, 'disks');
  await fs.mkdir(disksDir, { recursive: true });
  await fs.writeFile(path.join(disksDir, 'disk-a.dsk'), Buffer.alloc(16));
  await fs.writeFile(path.join(disksDir, 'disk-b.dsk'), Buffer.alloc(16));
  const db = new Database(path.join(dir, 'test.db'));
  await db.initialize();
  const deps = { database: db, config: { disksDir } } as unknown as Dependencies;
  return { deps, disksDir };
}

describe('profileNameOf', () => {
  test('strips @version, passes a bare name, rejects preset/inline', () => {
    expect(profileNameOf('altair-cpm@1.0.2')).toBe('altair-cpm');
    expect(profileNameOf('altair-cpm')).toBe('altair-cpm');
    expect(profileNameOf('preset:altair')).toBeNull();
    expect(profileNameOf('inline')).toBeNull();
  });
});

describe('profile startup disks', () => {
  test('set validates the image exists, then lists it back', async () => {
    const { deps } = await makeDeps();
    await expect(setProfileDisk(deps, 'foo@1.0.0', 0, 'missing.dsk', false)).rejects.toMatchObject({ statusCode: 404 });
    await setProfileDisk(deps, 'foo@1.0.0', 0, 'disk-a.dsk', true);
    expect(await listProfileDisks(deps, 'foo@1.0.0')).toEqual([{ drive: 0, filename: 'disk-a.dsk', readonly: true }]);
  });

  test('set replaces a drive; clear removes it', async () => {
    const { deps } = await makeDeps();
    await setProfileDisk(deps, 'foo@1.0.0', 0, 'disk-a.dsk', false);
    await setProfileDisk(deps, 'foo@1.0.0', 0, 'disk-b.dsk', true); // replace
    expect(await listProfileDisks(deps, 'foo@1.0.0')).toEqual([{ drive: 0, filename: 'disk-b.dsk', readonly: true }]);
    await clearProfileDisk(deps, 'foo@1.0.0', 0);
    expect(await listProfileDisks(deps, 'foo@1.0.0')).toEqual([]);
  });

  test('bindings are shared across a name’s versions (per-name scope)', async () => {
    const { deps } = await makeDeps();
    await setProfileDisk(deps, 'foo@1.0.0', 1, 'disk-a.dsk', false);
    // A different version of the same name sees the same binding.
    expect(await listProfileDisks(deps, 'foo@2.5.0')).toEqual([{ drive: 1, filename: 'disk-a.dsk', readonly: false }]);
    // A different name does not.
    expect(await listProfileDisks(deps, 'bar@1.0.0')).toEqual([]);
  });

  test('rejects an out-of-range drive and preset/inline refs', async () => {
    const { deps } = await makeDeps();
    await expect(setProfileDisk(deps, 'foo@1.0.0', 4, 'disk-a.dsk', false)).rejects.toMatchObject({ statusCode: 400 });
    await expect(setProfileDisk(deps, 'preset:x', 0, 'disk-a.dsk', false)).rejects.toMatchObject({ statusCode: 400 });
    await expect(listProfileDisks(deps, 'inline')).rejects.toMatchObject({ statusCode: 400 });
  });
});
