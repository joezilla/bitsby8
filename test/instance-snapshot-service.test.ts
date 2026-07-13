/**
 * Tests for instance disk/media snapshot + restore (Bitsby8 Story 3.4). Uses a
 * fake InstanceManager + real files/DB (no sim): snapshot copies each bound
 * drive's current disk, restore writes it back onto the instance's splinter path
 * and records it. The full CP/M round-trip is proven by a node e2e.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Database } from '../src/database';
import { Dependencies } from '../src/types';
import { getMountRegistry } from '../src/mount-registry';
import {
  snapshotInstance,
  listInstanceSnapshots,
  restoreInstanceSnapshot,
  deleteInstanceSnapshot,
} from '../src/services/instance-snapshot-service';

const CLIENT = 'inst:abc-123';

async function makeDeps(): Promise<{ deps: Dependencies; disksDir: string; base: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-isnap-'));
  const disksDir = path.join(dir, 'disks');
  await fs.mkdir(disksDir, { recursive: true });
  const base = path.join(disksDir, 'boot.dsk');
  await fs.writeFile(base, Buffer.from('ORIGINAL-DISK-BYTES'.padEnd(512, '.')));
  const db = new Database(path.join(dir, 'test.db'));
  await db.initialize();
  const stops: string[] = [];
  const starts: string[] = [];
  const instanceManager = {
    get: (id: string) => ({ id, clientId: CLIENT, profileRef: 'preset:imsai-cpm', status: 'stopped' }),
    stop: async (id: string) => { stops.push(id); },
    start: async (id: string) => { starts.push(id); },
    _stops: stops,
    _starts: starts,
  };
  const deps = { database: db, config: { disksDir }, instanceManager } as unknown as Dependencies;
  return { deps, disksDir, base };
}

beforeEach(() => getMountRegistry().clear(0));
afterEach(() => getMountRegistry().clear(0));

describe('instance snapshot + restore', () => {
  test('snapshot captures the bound disk; restore writes it onto the splinter + records it', async () => {
    const { deps, disksDir, base } = await makeDeps();
    getMountRegistry().set(0, base, false);

    const snap = await snapshotInstance(deps, 'inst-1', 'first');
    expect(snap.label).toBe('first');
    expect(snap.profileRef).toBe('preset:imsai-cpm');
    expect(snap.disks).toEqual([{ drive: 0, filename: 'boot.dsk' }]);

    // The snapshot copy matches the disk bytes.
    const snapFile = path.join(disksDir, '.instance-snapshots', snap.id, 'drive0.img');
    expect((await fs.readFile(snapFile)).equals(await fs.readFile(base))).toBe(true);

    // Restore writes it onto the instance's splinter path and records it.
    const res = await restoreInstanceSnapshot(deps, snap.id);
    expect(res.restored).toEqual([0]);
    const splinter = await deps.database.getClientSplinter(CLIENT, 0);
    expect(splinter).toBeTruthy();
    expect(splinter!.base_filename).toBe('boot.dsk');
    expect((await fs.readFile(splinter!.path)).equals(await fs.readFile(base))).toBe(true);
  });

  test('a running instance is stopped and restarted around a restore', async () => {
    const { deps, base } = await makeDeps();
    getMountRegistry().set(0, base, false);
    // Make the instance report running for this test.
    (deps.instanceManager as unknown as { get: (id: string) => { status: string } }).get = (id: string) =>
      ({ id, clientId: CLIENT, profileRef: 'p', status: 'running' }) as never;
    const snap = await snapshotInstance(deps, 'inst-1');
    await restoreInstanceSnapshot(deps, snap.id);
    const im = deps.instanceManager as unknown as { _stops: string[]; _starts: string[] };
    expect(im._stops).toContain('inst-1');
    expect(im._starts).toContain('inst-1');
  });

  test('snapshot prefers the instance splinter over the base when it has written', async () => {
    const { deps, base } = await makeDeps();
    getMountRegistry().set(0, base, false);
    // Simulate the instance having written: a recorded splinter with divergent bytes.
    const splinterPath = base + '.splinter';
    await fs.writeFile(splinterPath, Buffer.from('INSTANCE-WROTE-THIS'.padEnd(512, '.')));
    await deps.database.upsertClientSplinter(CLIENT, 0, 'boot.dsk', splinterPath, true);

    const snap = await snapshotInstance(deps, 'inst-1');
    const snapFile = path.join(deps.config!.disksDir, '.instance-snapshots', snap.id, 'drive0.img');
    expect((await fs.readFile(snapFile)).equals(await fs.readFile(splinterPath))).toBe(true);
  });

  test('list + delete', async () => {
    const { deps, base } = await makeDeps();
    getMountRegistry().set(0, base, false);
    const a = await snapshotInstance(deps, 'inst-1', 'a');
    await snapshotInstance(deps, 'inst-1', 'b');
    expect((await listInstanceSnapshots(deps, 'inst-1')).length).toBe(2);
    await deleteInstanceSnapshot(deps, a.id);
    expect((await listInstanceSnapshots(deps, 'inst-1')).map((s) => s.label)).toEqual(['b']);
    // files gone
    await expect(fs.access(path.join(deps.config!.disksDir, '.instance-snapshots', a.id))).rejects.toBeTruthy();
  });

  test('snapshot with no bound disks is a 409', async () => {
    const { deps } = await makeDeps();
    await expect(snapshotInstance(deps, 'inst-1')).rejects.toMatchObject({ statusCode: 409 });
  });
});
