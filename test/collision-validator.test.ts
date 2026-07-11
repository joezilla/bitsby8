/**
 * Tests for the define-time collision validator (Bitsby8 Story 2.5, FR-8):
 * port/IRQ/memory collisions named with both offenders, and auto-assign
 * sweeping a colliding card's base for a collision-free value. Card claims
 * cross the ESM boundary, so a fake sim (with claims fns) is injected.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Database } from '../src/database';
import { Dependencies } from '../src/types';
import { registerCardDefinition } from '../src/services/catalog';
import { _setSimForTests, SimModule } from '../src/services/bundle-registry';
import { validateProfile, autoAssign } from '../src/services/collision-validator';
import { ProfileContent } from '../src/services/profile-service';

// Two card kinds: a 4-port serial card (base..base+3) and a 1-port card, each
// claiming ports derived from a `basePort` config — enough to force/clear
// collisions by moving a base.
const fakeSim = {
  seedBundles: [
    {
      manifest: { name: 'quad', version: '1.0.0', type: 'serial', configSchema: { basePort: { type: 'u8', default: 0x10, min: 0, max: 0xfc } } },
      cardFactory: (id: string) => ({ id, reset() {}, attach() {} }),
      claims: (cfg: Record<string, unknown>) => {
        const b = ((cfg.basePort as number) ?? 0x10) & 0xff;
        return { ports: [b, b + 1, b + 2, b + 3], irq: (cfg.irq as number) ?? null };
      },
    },
    {
      manifest: { name: 'mono', version: '1.0.0', type: 'other', configSchema: { basePort: { type: 'u8', default: 0x08, min: 0, max: 0xff } } },
      cardFactory: (id: string) => ({ id, reset() {}, attach() {} }),
      claims: (cfg: Record<string, unknown>) => ({ ports: [((cfg.basePort as number) ?? 0x08) & 0xff] }),
    },
  ],
  withDefaults: (_m: unknown, c: Record<string, unknown> = {}) => ({ ...c }),
} as unknown as SimModule;

async function makeDeps(): Promise<Dependencies> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-col-'));
  const db = new Database(path.join(dir, 'test.db'));
  await db.initialize();
  const deps = { database: db } as unknown as Dependencies;
  // Card definitions so auto-assign can read the base param's schema/range.
  await registerCardDefinition(deps, {
    manifest: { name: 'quad', version: '1.0.0', type: 'serial', configSchema: { basePort: { type: 'u8', default: 0x10, min: 0, max: 0xfc } } },
    source: 'seed',
  });
  await registerCardDefinition(deps, {
    manifest: { name: 'mono', version: '1.0.0', type: 'other', configSchema: { basePort: { type: 'u8', default: 0x08, min: 0, max: 0xff } } },
    source: 'seed',
  });
  return deps;
}

const mem: ProfileContent['memory'] = [{ id: 'ram', base: 0, size: 0x10000, kind: 'ram' }];
function profile(cards: ProfileContent['cards'], memory: ProfileContent['memory'] = mem): ProfileContent {
  return { cpuKind: 'i8080', clock: 'max', resetVector: 0, memory, cards };
}

beforeEach(() => _setSimForTests(fakeSim));
afterEach(() => _setSimForTests(null));

describe('validateProfile — collisions', () => {
  test('a collision-free profile is ok, with each card footprint reported', async () => {
    const deps = await makeDeps();
    const v = await validateProfile(deps, profile([
      { id: 'a', ref: 'quad@1.0.0', config: { basePort: 0x10 } },
      { id: 'b', ref: 'mono@1.0.0', config: { basePort: 0x20 } },
    ]));
    expect(v.ok).toBe(true);
    expect(v.collisions).toEqual([]);
    expect(v.claims.find((c) => c.cardId === 'a')!.ports).toEqual([0x10, 0x11, 0x12, 0x13]);
  });

  test('a shared I/O port is a collision naming both offenders and the resource', async () => {
    const deps = await makeDeps();
    const v = await validateProfile(deps, profile([
      { id: 'a', ref: 'quad@1.0.0', config: { basePort: 0x10 } },
      { id: 'b', ref: 'mono@1.0.0', config: { basePort: 0x12 } }, // 0x12 ∈ a's [0x10..0x13]
    ]));
    expect(v.ok).toBe(false);
    const port = v.collisions.find((c) => c.kind === 'port');
    expect(port?.resource).toBe('I/O port 0x12');
    expect(port?.offenders.sort()).toEqual(['a', 'b']);
  });

  test('a shared IRQ and overlapping memory are each collisions', async () => {
    const deps = await makeDeps();
    const v = await validateProfile(deps, profile(
      [
        { id: 'a', ref: 'quad@1.0.0', config: { basePort: 0x10, irq: 5 } },
        { id: 'b', ref: 'quad@1.0.0', config: { basePort: 0x20, irq: 5 } },
      ],
      [
        { id: 'ram', base: 0, size: 0x1000, kind: 'ram' },
        { id: 'rom', base: 0x0800, size: 0x1000, kind: 'rom' },
      ],
    ));
    expect(v.collisions.some((c) => c.kind === 'irq' && c.offenders.sort().join() === 'a,b')).toBe(true);
    expect(v.collisions.some((c) => c.kind === 'memory' && c.offenders.sort().join() === 'ram,rom')).toBe(true);
  });
});

describe('autoAssign', () => {
  test('sweeps a colliding card to a collision-free base and reports the change', async () => {
    const deps = await makeDeps();
    const before = profile([
      { id: 'a', ref: 'quad@1.0.0', config: { basePort: 0x10 } },
      { id: 'b', ref: 'mono@1.0.0', config: { basePort: 0x12 } },
    ]);
    expect((await validateProfile(deps, before)).ok).toBe(false);

    const { content, unresolved, changes } = await autoAssign(deps, before);
    expect(unresolved).toEqual([]);
    expect(changes.find((c) => c.cardId === 'b')).toBeTruthy();
    // The reassigned profile is now collision-free.
    expect((await validateProfile(deps, content)).ok).toBe(true);
  });
});
