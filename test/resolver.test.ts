/**
 * Tests for the Resolver (Bitsby8 Story 1.3): Profile → MachineSpec with live
 * factories, provenance, and errors.
 *
 * The real 8sim engine is loaded in-process via a runtime `import()`, which
 * jest's default (non-ESM-VM) sandbox blocks — so the resolver's logic is
 * tested here against an injected fake SimModule (via `_setSimForTests`), and
 * the real resolve → buildMachine → boot path is proven by a node integration
 * check (scratchpad/resolver-e2e.mjs) that runs against the actual 8sim engine.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Database } from '../src/database';
import { Dependencies } from '../src/types';
import { ServiceError } from '../src/services/service-error';
import { resolveProfile, MachineProfile } from '../src/services/resolver';
import { _setSimForTests, SimModule, listCpus } from '../src/services/bundle-registry';
import type { CardManifest } from '@joezilla/8sim';
import { registerCardDefinition } from '../src/services/catalog';

async function makeDeps(): Promise<Dependencies> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-res-'));
  const db = new Database(path.join(dir, 'test.db'));
  await db.initialize();
  return { database: db } as unknown as Dependencies;
}

// `cpu` is a card type the installed 8sim's union predates (gained on 0.3.0);
// cast the literal so the strictly-typed fake compiles against either.
const CPU_TYPE = 'cpu' as unknown as CardManifest['type'];

/** A faithful-enough fake of the 8sim module surface the resolver uses. */
const fakeSim: SimModule = {
  seedBundles: [
    {
      manifest: {
        name: 'imsai-sio2',
        version: '1.0.0',
        type: 'serial',
        configSchema: {
          basePortA: { type: 'u8', default: 0x02, min: 0, max: 0xfe },
          boardCtrlPort: { type: 'u8', default: 0x08, min: 0, max: 0xff },
        },
      },
      cardFactory: (id) => ({ id, reset() {}, attach() {} }),
      claims: (cfg) => ({ ports: [Number(cfg.basePortA), Number(cfg.basePortA) + 1] }),
    },
    {
      manifest: { name: 'mits-88-dcdd', version: '1.0.0', type: 'floppy', configSchema: {} },
      cardFactory: (id) => ({ id, reset() {}, attach() {} }),
      claims: () => ({ ports: [0x08, 0x09, 0x0a] }),
    },
    {
      manifest: { name: 'ram-card', version: '1.0.0', type: 'memory', configSchema: { base: { type: 'u16', default: 0, min: 0, max: 0xffff }, size: { type: 'u16', default: 0x4000, min: 1, max: 0xffff } } },
      cardFactory: (id) => ({ id, reset() {}, attach() {} }),
      claims: () => ({ ports: [] }),
      memory: (cfg) => [{ id: 'ram', base: Number(cfg.base), size: Number(cfg.size), kind: 'ram' }],
    },
    {
      manifest: { name: 'z80-cpu', version: '1.0.0', type: CPU_TYPE, configSchema: { resetVector: { type: 'u16', default: 0, min: 0, max: 0xffff } } },
      cardFactory: (id) => ({ id, reset() {}, attach() {} }),
      claims: () => ({ ports: [] }),
      cpu: (cfg) => ({ kind: 'z80', resetVector: Number(cfg.resetVector) }),
    },
    {
      // A boot-rom overlay card: emits a `rom` descriptor region (burn geometry)
      // that the resolver CONSUMES — the card owns the window, so its image is
      // injected into config and the region is dropped from the memory map.
      manifest: {
        name: 'boot-rom',
        version: '1.0.0',
        type: 'boot-rom' as unknown as CardManifest['type'],
        configSchema: {
          window: { type: 'u16', default: 0xf000, min: 0, max: 0xffff },
          size: { type: 'u16', default: 0x100, min: 1, max: 0xffff },
          controlPort: { type: 'u8', default: 0x40, min: 0, max: 0xff },
        },
      },
      cardFactory: (id) => ({ id, reset() {}, attach() {} }),
      claims: (cfg) => ({ ports: [Number(cfg.controlPort)] }),
      memory: (cfg) => [{ id: 'rom', base: Number(cfg.window), size: Number(cfg.size), kind: 'rom' }],
    },
  ],
  withDefaults: (manifest, config = {}) => {
    const out: Record<string, unknown> = {};
    for (const [k, spec] of Object.entries(manifest.configSchema)) {
      const v = k in config ? (config as Record<string, unknown>)[k] : spec.default;
      const max = spec.max ?? 0xff;
      const min = spec.min ?? 0;
      if (typeof v === 'number' && (v < min || v > max)) throw new Error(`${k} out of range (${v})`);
      out[k] = v;
    }
    return out;
  },
  buildMachine: (() => {
    throw new Error('buildMachine not exercised in resolver unit tests');
  }) as unknown as SimModule['buildMachine'],
};

beforeEach(() => _setSimForTests(fakeSim));
afterEach(() => _setSimForTests(null));

describe('resolver: resolveProfile', () => {
  test('resolves a Profile into a MachineSpec with live factories + claims', async () => {
    const deps = await makeDeps();
    const profile: MachineProfile = {
      cpuKind: 'i8080',
      clock: 'max',
      resetVector: 0x0000,
      memory: [{ id: 'ram', base: 0x0000, size: 0x10000, kind: 'ram' }],
      cards: [{ id: 'sio', ref: 'imsai-sio2@1.0.0', config: { basePortA: 0x12 } }],
    };
    const { spec, provenance } = await resolveProfile(deps, profile);
    expect(spec.cpuKind).toBe('i8080');
    expect(spec.memory).toHaveLength(1);
    expect(spec.cards).toHaveLength(1);
    expect(typeof spec.cards[0].factory).toBe('function');
    expect(spec.cards[0].claims?.ports).toContain(0x12);
    expect(provenance[0].ref).toBe('imsai-sio2@1.0.0');
    expect(provenance[0].inCatalog).toBe(false);
  });

  test('hoists a memory card region into spec.memory, namespaced by instance id (Story 5.1)', async () => {
    const deps = await makeDeps();
    const { spec } = await resolveProfile(deps, {
      cpuKind: 'i8080',
      clock: 'max',
      resetVector: 0,
      memory: [{ id: 'rom', base: 0xf000, size: 0x0800, kind: 'rom' }],
      cards: [{ id: 'ram0', ref: 'ram-card@1.0.0', config: { base: 0x0000, size: 0x8000 } }],
    });
    // Profile ROM + the card's RAM region, namespaced.
    expect(spec.memory.map((m) => m.id)).toEqual(['rom', 'ram0/ram']);
    expect(spec.memory.find((m) => m.id === 'ram0/ram')).toMatchObject({ base: 0x0000, size: 0x8000, kind: 'ram' });
  });

  test('a boot-rom card consumes its burned ROM override into config, dropping the region', async () => {
    const deps = await makeDeps();
    const image = new Uint8Array([0x21, 0x13, 0xf0, 0x76]);
    const { spec } = await resolveProfile(deps, {
      cpuKind: 'i8080',
      clock: 'max',
      resetVector: 0xf000,
      memory: [{ id: 'boot/rom', base: 0xf000, size: 0x100, kind: 'rom', image }],
      cards: [
        { id: 'ram', ref: 'ram-card@1.0.0', config: { base: 0x0000, size: 0xf000 } },
        { id: 'boot', ref: 'boot-rom@1.0.0', config: { window: 0xf000, size: 0x100, controlPort: 0x40 } },
      ],
    });
    // The card owns the window, so the ROM region must NOT be a static spec region.
    expect(spec.memory.find((m) => m.id === 'boot/rom')).toBeUndefined();
    expect(spec.memory.map((m) => m.id)).toEqual(['ram/ram']);
    // The burned bytes are injected into the boot card's config for its overlay.
    const boot = spec.cards.find((c) => c.id === 'boot');
    expect(boot?.config?.image).toBe(image);
    expect(boot?.claims?.ports).toContain(0x40);
  });

  test('an unburned boot-rom card resolves with no image and no ROM region', async () => {
    const deps = await makeDeps();
    const { spec } = await resolveProfile(deps, {
      cpuKind: 'i8080',
      clock: 'max',
      resetVector: 0xf000,
      memory: [],
      cards: [{ id: 'boot', ref: 'boot-rom@1.0.0', config: { window: 0xf000, size: 0x100 } }],
    });
    expect(spec.memory.some((m) => m.id === 'boot/rom')).toBe(false);
    const boot = spec.cards.find((c) => c.id === 'boot');
    expect(boot?.config?.image).toBeUndefined();
  });

  test('listCpus surfaces seed CPU cards, with the engine kinds as a floor (Story 5.3)', async () => {
    const cpus = await listCpus();
    const kinds = cpus.map((c) => c.kind);
    expect(kinds).toContain('z80'); // from the z80-cpu seed bundle
    expect(kinds).toContain('i8080'); // floor, even without a seed card in this fake
    expect(cpus.find((c) => c.kind === 'z80')).toMatchObject({ ref: 'z80-cpu@1.0.0', name: 'Zilog Z80' });
  });

  test('a CPU card sets the machine cpuKind + resetVector (Story 5.1)', async () => {
    const deps = await makeDeps();
    const { spec } = await resolveProfile(deps, {
      cpuKind: 'i8080', // profile default...
      clock: 'max',
      resetVector: 0x0000,
      memory: [{ id: 'ram', base: 0, size: 0x10000, kind: 'ram' }],
      cards: [{ id: 'cpu', ref: 'z80-cpu@1.0.0', config: { resetVector: 0xff00 } }],
    });
    // ...overridden by the seated CPU card.
    expect(spec.cpuKind).toBe('z80');
    expect(spec.resetVector).toBe(0xff00);
  });

  test('records provenance (source, digest) from the Catalog when present', async () => {
    const deps = await makeDeps();
    await registerCardDefinition(deps, {
      manifest: { name: 'imsai-sio2', version: '1.0.0', type: 'serial', configSchema: {} },
      entry: 'seed:imsai-sio2',
      source: 'seed',
    });
    const { provenance } = await resolveProfile(deps, {
      cpuKind: 'i8080',
      clock: 'max',
      resetVector: 0,
      memory: [{ id: 'ram', base: 0, size: 0x10000, kind: 'ram' }],
      cards: [{ id: 'sio', ref: 'imsai-sio2@1.0.0' }],
    });
    expect(provenance[0].inCatalog).toBe(true);
    expect(provenance[0].source).toBe('seed');
    expect(provenance[0].digest).toMatch(/^sha256:/);
  });

  test('throws a ServiceError naming the Identity for a missing bundle', async () => {
    const deps = await makeDeps();
    await expect(
      resolveProfile(deps, {
        cpuKind: 'i8080',
        clock: 'max',
        resetVector: 0,
        memory: [{ id: 'ram', base: 0, size: 0x10000, kind: 'ram' }],
        cards: [{ id: 'x', ref: 'does-not-exist@9.9.9' }],
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test('throws a ServiceError for invalid card config', async () => {
    const deps = await makeDeps();
    await expect(
      resolveProfile(deps, {
        cpuKind: 'i8080',
        clock: 'max',
        resetVector: 0,
        memory: [{ id: 'ram', base: 0, size: 0x10000, kind: 'ram' }],
        cards: [{ id: 'sio', ref: 'imsai-sio2@1.0.0', config: { basePortA: 0x1ff } }],
      }),
    ).rejects.toThrow(ServiceError);
  });
});
