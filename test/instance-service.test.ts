/**
 * Tests for the shared instance-service (Bitsby8 Story 1.7) — the surface both
 * REST and MCP call. Covers: the availability guard (409), unknown-preset (404),
 * driver provenance, and the console read/write request-response path an agent
 * drives. The real ESM boot is proven by the node e2e; here a console-capable
 * fake sim is injected via _setSimForTests.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Database } from '../src/database';
import { Dependencies } from '../src/types';
import { InstanceManager } from '../src/services/instance-manager';
import { MachineProfile } from '../src/services/resolver';
import { _setSimForTests, SimModule } from '../src/services/bundle-registry';
import {
  listMachinePresets,
  listInstances,
  listInstanceStatus,
  createTransientInstance,
  destroyInstance,
  setInstanceSpeed,
  writeInstanceConsole,
  readInstanceConsole,
} from '../src/services/instance-service';
import { getMountRegistry } from '../src/mount-registry';

/** A fake sim whose machine exposes a console channel (id 'sio') that loops
 * RX back to TX, so console write→read round-trips through the real ConsoleHub. */
function consoleFakeSim() {
  return {
    seedBundles: [
      {
        manifest: { name: 'x-card', version: '1.0.0', type: 'serial', configSchema: {} },
        cardFactory: (id: string) => ({ id, reset() {}, attach() {} }),
        claims: () => ({ ports: [] }),
      },
    ],
    withDefaults: (_m: unknown, c: Record<string, unknown> = {}) => ({ ...c }),
    buildMachine: () => {
      let tx: (b: number) => void = () => {};
      const card = {
        id: 'sio',
        channelA: {
          onTransmit: (cb: (b: number) => void) => { tx = cb; },
          enqueueRx: (b: number) => tx(b), // echo RX straight to TX
        },
      };
      let hz: number | 'max' = 'max';
      return {
        cpu: { pc: 0, halted: false, step: () => 1, reset() {} },
        bus: {}, pic: {}, cards: [card], spec: {},
        runner: {
          start() {},
          stop() {},
          setHz(h: number | 'max') { hz = h; },
          get effectiveHz() { return typeof hz === 'number' ? hz : 2000; },
          get targetHz() { return hz; },
        },
      };
    },
  } as unknown as SimModule;
}

async function makeDeps(withManager = true): Promise<Dependencies> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-isvc-'));
  const db = new Database(path.join(dir, 'test.db'));
  await db.initialize();
  const cm = {
    addInProcessClient: async (clientId: string) => ({
      channel: { send() {}, close() {}, onmessage: null, onclose: null, onerror: null, readyState: 1 },
      id: `conn-${clientId}`,
    }),
  };
  const deps = { database: db, connectionManager: cm } as unknown as Dependencies;
  if (withManager) deps.instanceManager = new InstanceManager(deps);
  return deps;
}

const profile: MachineProfile = {
  cpuKind: 'i8080',
  clock: 'max',
  resetVector: 0,
  consoleCardId: 'sio',
  memory: [{ id: 'ram', base: 0, size: 0x10000, kind: 'ram' }],
  cards: [{ id: 'sio', ref: 'x-card@1.0.0' }],
};

beforeEach(() => _setSimForTests(consoleFakeSim()));
afterEach(() => _setSimForTests(null));

describe('instance-service', () => {
  test('listMachinePresets exposes the built-in presets', () => {
    expect(listMachinePresets().map((p) => p.id)).toContain('imsai-cpm');
  });

  test('throws 409 when virtual instances are unavailable (no manager on deps)', async () => {
    const deps = await makeDeps(false);
    await expect(createTransientInstance(deps, { preset: 'imsai-cpm' }, 'mcp')).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(() => listInstances(deps)).toThrow();
  });

  test('unknown preset yields a 404', async () => {
    const deps = await makeDeps();
    await expect(createTransientInstance(deps, { preset: 'nope' }, 'mcp')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  test('neither preset nor profile yields a 400', async () => {
    const deps = await makeDeps();
    await expect(createTransientInstance(deps, {}, 'mcp')).rejects.toMatchObject({ statusCode: 400 });
  });

  test('status carries bound disks, uptime, and headless that clears on console attach', async () => {
    const deps = await makeDeps();
    getMountRegistry().set(0, '/disks/boot.dsk', true);
    try {
      const info = await createTransientInstance(deps, { profile }, 'mcp');
      const st = (await listInstanceStatus(deps))[0];
      expect(st.disks).toEqual([{ drive: 0, filename: 'boot.dsk', readonly: true, dirty: false }]);
      expect(st.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(st.headless).toBe(true); // no console subscriber yet

      const off = deps.instanceManager!.subscribeConsole(info.id, { onOutput() {} });
      expect((await listInstanceStatus(deps))[0].headless).toBe(false);
      off();
      expect((await listInstanceStatus(deps))[0].headless).toBe(true);

      await destroyInstance(deps, info.id);
    } finally {
      getMountRegistry().clear(0);
    }
  });

  test('a launch-time speed override sets the runner Hz (authentic 2 MHz)', async () => {
    const deps = await makeDeps();
    const info = await createTransientInstance(deps, { profile, speed: 2000000 }, 'api');
    expect(info.targetHz).toBe(2000000);
    expect(info.effectiveHz).toBe(2000000);
    await destroyInstance(deps, info.id);
  });

  test('an invalid speed is rejected (400)', async () => {
    const deps = await makeDeps();
    await expect(createTransientInstance(deps, { profile, speed: -5 as never }, 'api')).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  test('setInstanceSpeed changes a running instance live; 400 invalid; 409 when not running', async () => {
    const deps = await makeDeps();
    const info = await createTransientInstance(deps, { profile }, 'api');
    const changed = await setInstanceSpeed(deps, info.id, 4000000);
    expect(changed.targetHz).toBe(4000000);
    expect((await setInstanceSpeed(deps, info.id, 'max')).targetHz).toBe('max');
    await expect(setInstanceSpeed(deps, info.id, 'fast' as never)).rejects.toMatchObject({ statusCode: 400 });

    // A defined-but-not-running instance can't take a live speed change.
    const defined = await deps.instanceManager!.define(profile, 'inline', 'api');
    await expect(setInstanceSpeed(deps, defined.id, 2000000)).rejects.toMatchObject({ statusCode: 409 });
    await destroyInstance(deps, info.id);
  });

  test('create-transient records driver provenance and drives the console loop', async () => {
    const deps = await makeDeps();
    const info = await createTransientInstance(deps, { profile }, 'mcp');
    expect(info.driver).toBe('mcp'); // "driven by Claude Code (MCP)" provenance
    expect(info.profileRef).toBe('inline');
    expect(info.status).toBe('running');

    // Nothing to read yet.
    expect(readInstanceConsole(deps, info.id).data).toBe('');

    // Write "DIR\r" → the fake console echoes it back → read it since cursor 0.
    writeInstanceConsole(deps, info.id, 'DIR\r');
    const read = readInstanceConsole(deps, info.id, 0);
    expect(read.data).toBe('DIR\r');
    expect(read.cursor).toBe(4);

    // Cursor advances: a second write is only visible past the prior cursor.
    writeInstanceConsole(deps, info.id, 'A');
    expect(readInstanceConsole(deps, info.id, read.cursor).data).toBe('A');

    await destroyInstance(deps, info.id);
    expect(listInstances(deps)).toHaveLength(0);
  });
});
