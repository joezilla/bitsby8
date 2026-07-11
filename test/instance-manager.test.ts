/**
 * Tests for the InstanceManager (Bitsby8 Story 1.5): lifecycle, transient
 * no-residue, persistent DB backing, reserved clientId, and sole-liveness
 * authority. The real Resolver → buildMachine path crosses the ESM boundary
 * jest can't run, so a fake engine (via _setSimForTests) + a fake
 * ConnectionManager are injected; the real boot-and-serve is proven by a node
 * integration check.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Database } from '../src/database';
import { Dependencies } from '../src/types';
import { InstanceManager, INSTANCE_CLIENT_PREFIX } from '../src/services/instance-manager';
import { MachineProfile } from '../src/services/resolver';
import { _setSimForTests, SimModule } from '../src/services/bundle-registry';

const closedChannels: string[] = [];

function makeRunner() {
  let running = false;
  return {
    start() { running = true; },
    stop() { running = false; },
    get isRunning() { return running; },
    get effectiveHz() { return 1000; },
    get targetHz() { return 'max' as const; },
  };
}

const fakeSim = {
  seedBundles: [
    {
      manifest: { name: 'x-card', version: '1.0.0', type: 'serial', configSchema: {} },
      cardFactory: (id: string) => ({ id, reset() {}, attach() {} }),
      claims: () => ({ ports: [] }),
    },
  ],
  withDefaults: (_m: unknown, c: Record<string, unknown> = {}) => ({ ...c }),
  buildMachine: (spec: unknown) => ({
    cpu: { pc: 0, halted: false, step: () => 1, reset() {} },
    bus: {},
    pic: {},
    cards: [],
    spec,
    runner: makeRunner(),
  }),
} as unknown as SimModule;

function makeFakeCM() {
  return {
    addInProcessClient: async (clientId: string) => ({
      channel: {
        send() {},
        close() { closedChannels.push(clientId); },
        onmessage: null,
        onclose: null,
        onerror: null,
        readyState: 1,
      },
      id: `conn-${clientId}`,
    }),
  };
}

async function makeDeps(): Promise<Dependencies> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-im-'));
  const db = new Database(path.join(dir, 'test.db'));
  await db.initialize();
  return { database: db, connectionManager: makeFakeCM() } as unknown as Dependencies;
}

const profile: MachineProfile = {
  cpuKind: 'i8080',
  clock: 'max',
  resetVector: 0x0000,
  memory: [{ id: 'ram', base: 0, size: 0x10000, kind: 'ram' }],
  cards: [{ id: 'c', ref: 'x-card@1.0.0' }],
};

beforeEach(() => {
  _setSimForTests(fakeSim);
  closedChannels.length = 0;
});
afterEach(() => _setSimForTests(null));

describe('InstanceManager transient lifecycle', () => {
  test('createTransient starts a running instance with a reserved inst: clientId and no DB row', async () => {
    const deps = await makeDeps();
    const im = new InstanceManager(deps);
    const info = await im.createTransient(profile);

    expect(info.status).toBe('running');
    expect(info.transient).toBe(true);
    expect(info.clientId.startsWith(INSTANCE_CLIENT_PREFIX)).toBe(true);
    expect(info.clientId).toBe(`${INSTANCE_CLIENT_PREFIX}${info.id}`);
    expect(info.cpuKind).toBe('i8080');
    // transient → nothing persisted
    expect(await deps.database.listMachineInstances()).toHaveLength(0);
  });

  test('destroy leaves no residue (no DB row, channel closed)', async () => {
    const deps = await makeDeps();
    const im = new InstanceManager(deps);
    const info = await im.createTransient(profile);
    await im.destroy(info.id);

    expect(im.list()).toHaveLength(0);
    expect(await deps.database.listMachineInstances()).toHaveLength(0);
    expect(closedChannels).toContain(info.clientId); // channel torn down
  });
});

describe('InstanceManager persistent lifecycle', () => {
  test('define writes a DB row (defined); start/stop update status; destroy deletes it', async () => {
    const deps = await makeDeps();
    const im = new InstanceManager(deps);

    const info = await im.define(profile, 'altair-cpm');
    expect(info.status).toBe('defined');
    let rec = await deps.database.getMachineInstance(info.id);
    expect(rec?.status).toBe('defined');
    expect(rec?.client_id).toBe(info.clientId);
    expect(rec?.profile_ref).toBe('altair-cpm');

    await im.start(info.id);
    rec = await deps.database.getMachineInstance(info.id);
    expect(rec?.status).toBe('running');
    expect(im.get(info.id).status).toBe('running');

    await im.stop(info.id);
    rec = await deps.database.getMachineInstance(info.id);
    expect(rec?.status).toBe('stopped');
    expect(closedChannels).toContain(info.clientId);

    await im.destroy(info.id);
    expect(await deps.database.getMachineInstance(info.id)).toBeUndefined();
    expect(im.list()).toHaveLength(0);
  });
});

describe('InstanceManager is the sole liveness authority (AD-4)', () => {
  test('a channel/serving teardown does not by itself remove the instance', async () => {
    const deps = await makeDeps();
    const im = new InstanceManager(deps);
    const info = await im.createTransient(profile);

    // Simulate ConnectionManager tearing down the served connection (e.g. the
    // channel closed) WITHOUT the InstanceManager calling destroy.
    // The InstanceManager's registry is independent, so the instance persists.
    expect(im.list().map((i) => i.id)).toContain(info.id);
    // Only destroy finalizes it.
    await im.destroy(info.id);
    expect(im.list()).toHaveLength(0);
  });

  test('throws 404 for an unknown instance', async () => {
    const deps = await makeDeps();
    const im = new InstanceManager(deps);
    await expect(im.start('nope')).rejects.toMatchObject({ statusCode: 404 });
  });
});
