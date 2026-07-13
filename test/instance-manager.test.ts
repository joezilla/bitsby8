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
import { getClientMountRegistry } from '../src/client-mount-registry';

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
  buildMachine: (spec: unknown) => {
    const mem = new Uint8Array(0x10000);
    const reset = (spec as { resetVector?: number }).resetVector ?? 0;
    const cpu = {
      pc: reset,
      halted: false,
      step() { mem[this.pc]; this.pc = (this.pc + 1) & 0xffff; return 1; }, // NOP-ish: advance PC
      reset() { this.pc = reset; },
      state() {
        return { pc: this.pc, sp: 0, a: 0, f: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, halted: this.halted, inte: false, intPending: false, status: 0 };
      },
    };
    const bus = {
      read: (a: number) => mem[a & 0xffff],
      write: (a: number, v: number) => { mem[a & 0xffff] = v & 0xff; },
    };
    // A keyboard card exposing a `.keyboard` sink, so the manager collects it (5.9).
    const kbQueue: number[] = [];
    const kbd = {
      id: 'kbd',
      reset() { kbQueue.length = 0; },
      attach() {},
      keyboard: {
        press: (b: number) => kbQueue.push(b & 0xff),
        type: (t: string) => { for (const ch of t) kbQueue.push(ch.charCodeAt(0)); },
        get pending() { return kbQueue.length; },
      },
    };
    return { cpu, bus, pic: {}, cards: [kbd], spec, runner: makeRunner() };
  },
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

describe('InstanceManager keyboard cards (Story 5.9)', () => {
  test('listKeyboards surfaces the machine keyboard card; sendKeys queues bytes and text', async () => {
    const deps = await makeDeps();
    const im = new InstanceManager(deps);
    const info = await im.createTransient(profile);

    expect(im.listKeyboards(info.id)).toEqual([{ cardId: 'kbd', pending: 0 }]);

    const r = im.sendKeys(info.id, [0x48, 0x49]); // "HI"
    expect(r).toEqual({ cardId: 'kbd', sent: 2 });
    expect(im.listKeyboards(info.id)[0].pending).toBe(2);
  });

  test('sendKeys throws 404 for an unknown card id', async () => {
    const deps = await makeDeps();
    const im = new InstanceManager(deps);
    const info = await im.createTransient(profile);
    expect(() => im.sendKeys(info.id, [0x41], 'nope')).toThrow(/no keyboard card "nope"/);
  });

  test('listKeyboards is empty and sendKeys 409s when the instance is not running', async () => {
    const deps = await makeDeps();
    const im = new InstanceManager(deps);
    const info = await im.define(profile, 'ref');
    expect(im.listKeyboards(info.id)).toEqual([]);
    expect(() => im.sendKeys(info.id, [0x41])).toThrow(/no keyboard card/);
  });
});

describe('InstanceManager startup disks (profile_disks)', () => {
  async function depsWithDisks() {
    const disksDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-im-disks-'));
    await fs.writeFile(path.join(disksDir, 'boot.dsk'), Buffer.alloc(16));
    const deps = await makeDeps();
    (deps as unknown as { config: { disksDir: string } }).config = { disksDir };
    return { deps, disksDir };
  }

  test('launch seeds the profile’s disks as this instance’s client-mount overrides; teardown clears them', async () => {
    const { deps, disksDir } = await depsWithDisks();
    await deps.database.setProfileDisk('mach', 0, 'boot.dsk', true);
    const im = new InstanceManager(deps);
    const info = await im.createTransient(profile, 'mach@1.0.0');

    const overrides = getClientMountRegistry().forClient(info.clientId);
    const drive0 = overrides.get(0);
    expect(drive0?.readonly).toBe(true);
    expect(path.basename(drive0?.filename ?? '')).toBe('boot.dsk'); // absolute realpath under disksDir
    expect(drive0?.filename).toContain(path.basename(disksDir));

    await im.destroy(info.id);
    expect(getClientMountRegistry().forClient(info.clientId).size).toBe(0);
  });

  test('a preset/inline machine gets no startup-disk overrides', async () => {
    const { deps } = await depsWithDisks();
    await deps.database.setProfileDisk('mach', 0, 'boot.dsk', false);
    const im = new InstanceManager(deps);
    const info = await im.createTransient(profile); // profileRef defaults to 'inline'
    expect(getClientMountRegistry().forClient(info.clientId).size).toBe(0);
  });
});

describe('InstanceManager front panel (cockpit Phase 3)', () => {
  const fpProfile: MachineProfile = { ...profile, resetVector: 0x0100 };

  test('readFrontPanel reports CPU state, the reset vector, and the data bus at the address', async () => {
    const deps = await makeDeps();
    const im = new InstanceManager(deps);
    const info = await im.createTransient(fpProfile);

    const fp = im.readFrontPanel(info.id);
    expect(fp.pc).toBe(0x0100); // examine address starts at the reset vector
    expect(fp.addr).toBe(0x0100);
    expect(fp.resetVector).toBe(0x0100);
    expect(fp.running).toBe(true);
    expect(fp.data).toBe(0); // empty RAM
  });

  test('deposit writes the data bus; examine + examNext walk the address; the byte reads back', async () => {
    const deps = await makeDeps();
    const im = new InstanceManager(deps);
    const info = await im.createTransient(fpProfile);

    // Point the panel at 0x0200 and drop a byte there.
    im.frontPanelAction(info.id, 'examine', 0x0200);
    let fp = im.frontPanelAction(info.id, 'deposit', 0x76); // HLT opcode, arbitrary
    expect(fp.addr).toBe(0x0200);
    expect(fp.data).toBe(0x76);
    expect(fp.running).toBe(false); // any panel op halts the runner

    // Deposit-next advances the address before writing.
    fp = im.frontPanelAction(info.id, 'depNext', 0xc3);
    expect(fp.addr).toBe(0x0201);
    expect(fp.data).toBe(0xc3);

    // Examine back to 0x0200 sees the first byte again.
    fp = im.frontPanelAction(info.id, 'examine', 0x0200);
    expect(fp.data).toBe(0x76);
    fp = im.frontPanelAction(info.id, 'examNext');
    expect(fp.addr).toBe(0x0201);
    expect(fp.data).toBe(0xc3);
  });

  test('step advances PC; reset returns to the reset vector; run flips isRunning', async () => {
    const deps = await makeDeps();
    const im = new InstanceManager(deps);
    const info = await im.createTransient(fpProfile);

    im.frontPanelAction(info.id, 'stop');
    let fp = im.frontPanelAction(info.id, 'step');
    expect(fp.pc).toBe(0x0101); // one instruction advanced PC
    expect(fp.running).toBe(false);

    fp = im.frontPanelAction(info.id, 'reset');
    expect(fp.pc).toBe(0x0100);
    expect(fp.addr).toBe(0x0100);

    fp = im.frontPanelAction(info.id, 'run');
    expect(fp.running).toBe(true);
  });

  test('front-panel ops on a stopped/absent machine are refused (409)', async () => {
    const deps = await makeDeps();
    const im = new InstanceManager(deps);
    const info = await im.define(fpProfile, 'ref'); // defined, not running → no machine
    expect(() => im.readFrontPanel(info.id)).toThrow(/not running/);
    expect(() => im.frontPanelAction(info.id, 'step')).toThrow(/not running/);
  });
});
