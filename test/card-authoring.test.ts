/**
 * Tests for declarative card authoring (Bitsby8 Story 5.4): author a memory or
 * CPU card with no code, register it as source 'authored', and confirm the
 * host-synthesized bundle resolves + validates + burns exactly like a seed card.
 */
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Database } from '../src/database';
import { Dependencies } from '../src/types';
import { authorCard, deleteAuthoredCard } from '../src/services/card-authoring';
import { getCardDefinition } from '../src/services/catalog';
import { resolveProfile } from '../src/services/resolver';
import { validateProfile } from '../src/services/collision-validator';
import { createProfile, toMachineProfile } from '../src/services/profile-service';
import { burnEprom } from '../src/services/eprom-service';
import { _setSimForTests, SimModule } from '../src/services/bundle-registry';

// A minimal real-ish sim: only seed bundle is a serial card (to prove authored
// cards resolve WITHOUT being in seedBundles). withDefaults reads the schema.
const fakeSim = {
  seedBundles: [
    {
      manifest: { name: 'imsai-sio2', version: '1.0.0', type: 'serial', configSchema: { basePortA: { type: 'u8', default: 0x02 } } },
      cardFactory: (id: string) => ({ id, reset() {}, attach() {} }),
      claims: (c: Record<string, unknown>) => ({ ports: [Number(c.basePortA)] }),
    },
  ],
  // A behavior kernel (Story 5.7): a serial UART bound to a terminal. Its card
  // exposes a `.channel` (console-capable), unlike a bare deviceCard chip.
  kernels: [
    {
      id: 'serial',
      label: 'Serial UART (console)',
      type: 'serial',
      binding: 'terminal',
      configSchema: { dataPort: { type: 'u8', default: 0x10 }, ctrlPort: { type: 'u8', default: 0x11 } },
      create: (id: string) => ({
        id,
        reset() {},
        attach() {},
        channel: { onTransmit() {}, enqueueRx() {}, reset() {} },
      }),
      claims: (c: Record<string, unknown>) => ({ ports: [Number(c.dataPort), Number(c.ctrlPort)] }),
    },
  ],
  withDefaults: (m: { configSchema: Record<string, { default: unknown }> }, c: Record<string, unknown> = {}) => {
    const out: Record<string, unknown> = {};
    for (const [k, s] of Object.entries(m.configSchema)) out[k] = k in c ? c[k] : s.default;
    return out;
  },
  buildMachine: (() => { throw new Error('not used'); }) as unknown as SimModule['buildMachine'],
} as unknown as SimModule;

async function makeDeps(): Promise<Dependencies> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-author-'));
  const db = new Database(path.join(dir, 'test.db'));
  await db.initialize();
  return { database: db } as unknown as Dependencies;
}

beforeEach(() => _setSimForTests(fakeSim));
afterEach(() => _setSimForTests(null));

describe('authorCard', () => {
  test('authors a RAM card, content-addressed, that resolves to a memory region', async () => {
    const deps = await makeDeps();
    const card = await authorCard(deps, {
      name: 'cromemco-ram',
      maker: 'Cromemco',
      summary: '63.75K static RAM board',
      behavior: { resolvesTo: 'memory', memKind: 'ram' },
      defaults: { base: 0x0000, size: 0xff00 },
    });
    expect(card.id).toBe('cromemco-ram@1.0.0');
    expect(card.source).toBe('authored');
    expect(card.type).toBe('memory');
    expect(card.digest).toMatch(/^sha256:/);

    // It resolves into a machine even though it's NOT a seed bundle.
    const p = await createProfile(deps, {
      name: 'ram-machine',
      cpuKind: 'i8080',
      clock: 'max',
      resetVector: 0,
      memory: [],
      cards: [{ id: 'ram0', ref: 'cromemco-ram@1.0.0', config: { base: 0x0000, size: 0x8000 } }],
    });
    const { spec } = await resolveProfile(deps, toMachineProfile(p));
    expect(spec.memory.find((m) => m.id === 'ram0/ram')).toMatchObject({ base: 0, size: 0x8000, kind: 'ram' });
  });

  test('authors a CPU card that sets the machine CPU + reset vector', async () => {
    const deps = await makeDeps();
    await authorCard(deps, {
      name: 'my-z80-board',
      behavior: { resolvesTo: 'cpu', cpuKind: 'z80' },
      defaults: { resetVector: 0xf800 },
    });
    const p = await createProfile(deps, {
      name: 'z80-machine',
      cpuKind: 'i8080', // overridden by the authored CPU card
      clock: 'max',
      resetVector: 0,
      memory: [{ id: 'ram', base: 0, size: 0x10000, kind: 'ram' }],
      cards: [{ id: 'cpu', ref: 'my-z80-board@1.0.0', config: { resetVector: 0xf800 } }],
    });
    const { spec } = await resolveProfile(deps, toMachineProfile(p));
    expect(spec.cpuKind).toBe('z80');
    expect(spec.resetVector).toBe(0xf800);
  });

  test('an authored EPROM card is burnable via the standard burn path', async () => {
    const deps = await makeDeps();
    await authorCard(deps, {
      name: 'monitor-eprom',
      behavior: { resolvesTo: 'memory', memKind: 'rom' },
      defaults: { base: 0xf000, size: 0x0800 },
    });
    const p = await createProfile(deps, {
      name: 'eprom-machine',
      cpuKind: 'i8080',
      clock: 'max',
      resetVector: 0xf000,
      memory: [],
      cards: [{ id: 'rom0', ref: 'monitor-eprom@1.0.0', config: { base: 0xf000, size: 0x0800 } }],
    });
    const out = await burnEprom(deps, p.id, 'rom0', { bytes: new Uint8Array([0xc3, 0x00, 0xf0]), addressing: 'base' });
    expect(out.region).toMatchObject({ id: 'rom0/rom', base: 0xf000, size: 0x0800 });

    const { spec } = await resolveProfile(deps, toMachineProfile(out.profile));
    const rom = spec.memory.filter((m) => m.id === 'rom0/rom');
    expect(rom).toHaveLength(1);
    expect(rom[0].image?.[0]).toBe(0xc3); // burned, not the card's zero emit
    expect((await validateProfile(deps, out.profile)).ok).toBe(true);
  });

  test('authors a serial (io) card from the terminal kernel, resolving to a console-capable card (Story 5.7)', async () => {
    const deps = await makeDeps();
    const card = await authorCard(deps, {
      name: 'my-console-serial',
      summary: 'Single 8251 console UART @ 0x12',
      behavior: { resolvesTo: 'io', kernel: 'serial' } as never,
      defaults: { dataPort: 0x12, ctrlPort: 0x13 },
    });
    expect(card.type).toBe('serial'); // from the kernel
    // The stored behavior carries the kernel id + its terminal binding.
    expect((card.manifest as { behavior?: { kernel?: string; binding?: string } }).behavior)
      .toMatchObject({ resolvesTo: 'io', kernel: 'serial', binding: 'terminal' });

    // It resolves into a machine, claiming the kernel's ports at the chosen config.
    const p = await createProfile(deps, {
      name: 'serial-machine',
      cpuKind: 'i8080',
      clock: 'max',
      resetVector: 0,
      memory: [{ id: 'ram', base: 0, size: 0x10000, kind: 'ram' }],
      cards: [{ id: 'con', ref: 'my-console-serial@1.0.0', config: { dataPort: 0x12, ctrlPort: 0x13 } }],
    });
    const { spec } = await resolveProfile(deps, toMachineProfile(p));
    expect(spec.cards[0].claims?.ports).toEqual([0x12, 0x13]);
    // The synthesized card exposes a console channel — the whole point of a kernel.
    const built = spec.cards[0].factory('con', spec.cards[0].config ?? {}, {} as never) as { channel?: unknown };
    expect(built.channel).toBeDefined();
  });

  test('an unknown kernel is rejected (400)', async () => {
    const deps = await makeDeps();
    await expect(
      authorCard(deps, { name: 'x', behavior: { resolvesTo: 'io', kernel: 'nope' } as never }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects a bad name, an unknown behavior, and shadowing a seed card', async () => {
    const deps = await makeDeps();
    await expect(authorCard(deps, { name: '', behavior: { resolvesTo: 'memory', memKind: 'ram' } }))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(authorCard(deps, { name: 'x', behavior: { resolvesTo: 'bogus' } as never }))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(
      authorCard(deps, { name: 'imsai-sio2', behavior: { resolvesTo: 'cpu', cpuKind: 'z80' } }),
    ).rejects.toMatchObject({ statusCode: 409 }); // shadows the seed card
  });
});

describe('deleteAuthoredCard', () => {
  test('deletes an authored card but refuses a seed card', async () => {
    const deps = await makeDeps();
    await authorCard(deps, { name: 'scratch-ram', behavior: { resolvesTo: 'memory', memKind: 'ram' } });
    await deleteAuthoredCard(deps, 'scratch-ram@1.0.0');
    await expect(getCardDefinition(deps, 'scratch-ram@1.0.0')).rejects.toBeDefined();

    await expect(deleteAuthoredCard(deps, 'scratch-ram@1.0.0')).rejects.toMatchObject({ statusCode: 404 });
  });
});
