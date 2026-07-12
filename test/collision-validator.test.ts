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
    {
      // A CPU card — no I/O, resolves to the machine's processor (Story 5.1).
      manifest: { name: 'cpu', version: '1.0.0', type: 'cpu', configSchema: { resetVector: { type: 'u16', default: 0, min: 0, max: 0xffff } } },
      cardFactory: (id: string) => ({ id, reset() {}, attach() {} }),
      claims: () => ({ ports: [] }),
      cpu: (cfg: Record<string, unknown>) => ({ kind: 'i8080', resetVector: (cfg.resetVector as number) ?? 0 }),
    },
    {
      // A memory card (RAM board) — no I/O, resolves to a RAM region (Story 5.1).
      manifest: { name: 'ram', version: '1.0.0', type: 'memory', configSchema: { base: { type: 'u16', default: 0, min: 0, max: 0xffff }, size: { type: 'u16', default: 0x4000, min: 1, max: 0xffff } } },
      cardFactory: (id: string) => ({ id, reset() {}, attach() {} }),
      claims: () => ({ ports: [] }),
      memory: (cfg: Record<string, unknown>) => [
        { id: 'ram', base: (cfg.base as number) ?? 0, size: (cfg.size as number) ?? 0x4000, kind: 'ram' },
      ],
    },
    {
      // SIO-like card with two channels + a ctrl port — its config can make its
      // own ports overlap (an intra-card self-collision), like imsai-sio2.
      manifest: { name: 'sio', version: '1.0.0', type: 'serial', configSchema: { basePortA: { type: 'u8', default: 0x02, min: 0, max: 0xfe }, basePortB: { type: 'u8', default: 0x04, min: 0, max: 0xfe }, boardCtrlPort: { type: 'u8', default: 0x08, min: 0, max: 0xff } } },
      cardFactory: (id: string) => ({ id, reset() {}, attach() {} }),
      claims: (cfg: Record<string, unknown>) => {
        const a = ((cfg.basePortA as number) ?? 0x02) & 0xff;
        const b = ((cfg.basePortB as number) ?? 0x04) & 0xff;
        const c = ((cfg.boardCtrlPort as number) ?? 0x08) & 0xff;
        return { ports: [a, a + 1, b, b + 1, c] };
      },
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
  await registerCardDefinition(deps, {
    manifest: { name: 'sio', version: '1.0.0', type: 'serial', configSchema: { basePortA: { type: 'u8', default: 0x02, min: 0, max: 0xfe }, basePortB: { type: 'u8', default: 0x04, min: 0, max: 0xfe }, boardCtrlPort: { type: 'u8', default: 0x08, min: 0, max: 0xff } } },
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

  test('an intra-card self-overlap (one card whose own ports collide) is caught', async () => {
    const deps = await makeDeps();
    // channel A at 0x0C → 0xC/0xD, board-ctrl at 0x0D → 0xD claimed twice by one card.
    const v = await validateProfile(deps, profile([
      { id: 'sio', ref: 'sio@1.0.0', config: { basePortA: 0x0c, basePortB: 0x04, boardCtrlPort: 0x0d } },
    ]));
    expect(v.ok).toBe(false);
    const port = v.collisions.find((c) => c.kind === 'port');
    expect(port).toMatchObject({ resource: 'I/O port 0x0D', offenders: ['sio'] });
    // Footprint is reported deduped even though the raw claim had a dup.
    expect(v.claims[0].ports).toEqual([0x04, 0x05, 0x0c, 0x0d]);
    // Auto-assign repairs the self-overlap.
    const aa = await autoAssign(deps, profile([
      { id: 'sio', ref: 'sio@1.0.0', config: { basePortA: 0x0c, basePortB: 0x04, boardCtrlPort: 0x0d } },
    ]));
    expect((await validateProfile(deps, aa.content)).ok).toBe(true);
  });

  test('card-emitted memory (two RAM cards) overlapping is a collision (Story 5.1)', async () => {
    const deps = await makeDeps();
    // RAM card A: 0x0000–0x7FFF; RAM card B: 0x4000–0x7FFF → overlap.
    const v = await validateProfile(deps, profile([
      { id: 'ramA', ref: 'ram@1.0.0', config: { base: 0x0000, size: 0x8000 } },
      { id: 'ramB', ref: 'ram@1.0.0', config: { base: 0x4000, size: 0x4000 } },
    ], []));
    expect(v.ok).toBe(false);
    const mem = v.collisions.find((c) => c.kind === 'memory');
    expect(mem?.offenders.sort()).toEqual(['ramA/ram', 'ramB/ram']);
    // Non-overlapping RAM cards are fine.
    const ok = await validateProfile(deps, profile([
      { id: 'ramA', ref: 'ram@1.0.0', config: { base: 0x0000, size: 0x4000 } },
      { id: 'ramB', ref: 'ram@1.0.0', config: { base: 0x4000, size: 0x4000 } },
    ], []));
    expect(ok.ok).toBe(true);
  });

  test('two CPU cards collide (a machine has exactly one bus master); one is ok (Story 5.1)', async () => {
    const deps = await makeDeps();
    const two = await validateProfile(deps, profile([
      { id: 'cpuA', ref: 'cpu@1.0.0', config: {} },
      { id: 'cpuB', ref: 'cpu@1.0.0', config: {} },
    ], []));
    expect(two.ok).toBe(false);
    const cpu = two.collisions.find((c) => c.kind === 'cpu');
    expect(cpu?.offenders.sort()).toEqual(['cpuA', 'cpuB']);

    const one = await validateProfile(deps, profile([
      { id: 'cpuA', ref: 'cpu@1.0.0', config: { resetVector: 0xff00 } },
    ], []));
    expect(one.ok).toBe(true);
  });

  test('returns the resolved memory map (profile + card regions, base-sorted) for the ribbon (Story 5.3)', async () => {
    const deps = await makeDeps();
    const v = await validateProfile(
      deps,
      profile(
        [{ id: 'ram0', ref: 'ram@1.0.0', config: { base: 0x0000, size: 0x4000 } }],
        [{ id: 'rom', base: 0xf800, size: 0x0800, kind: 'rom' }],
      ),
    );
    expect(v.memoryMap).toEqual([
      { id: 'ram0/ram', base: 0x0000, size: 0x4000, kind: 'ram', source: 'card' },
      { id: 'rom', base: 0xf800, size: 0x0800, kind: 'rom', source: 'profile' },
    ]);
  });

  test('warns when the reset vector (forced by a CPU card) points outside ROM (Story 5.1 footgun)', async () => {
    const deps = await makeDeps();
    // CPU card resetVector 0, only RAM mapped → boots into empty RAM. Warn.
    const bad = await validateProfile(
      deps,
      profile([{ id: 'cpu', ref: 'cpu@1.0.0', config: { resetVector: 0 } }], [
        { id: 'ram', base: 0, size: 0x8000, kind: 'ram' },
      ]),
    );
    expect(bad.ok).toBe(true); // not a hard collision — advisory only
    expect(bad.warnings.some((w) => /reset vector 0x0000.*cpu card.*not rom/i.test(w))).toBe(true);

    // Same CPU card pointed at a ROM region → no warning.
    const good = await validateProfile(
      deps,
      profile([{ id: 'cpu', ref: 'cpu@1.0.0', config: { resetVector: 0xff00 } }], [
        { id: 'rom', base: 0xff00, size: 0x100, kind: 'rom' },
      ]),
    );
    expect(good.warnings).toEqual([]);
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
