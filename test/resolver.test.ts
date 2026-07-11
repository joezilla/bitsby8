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
import { _setSimForTests, SimModule } from '../src/services/bundle-registry';
import { registerCardDefinition } from '../src/services/catalog';

async function makeDeps(): Promise<Dependencies> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-res-'));
  const db = new Database(path.join(dir, 'test.db'));
  await db.initialize();
  return { database: db } as unknown as Dependencies;
}

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
