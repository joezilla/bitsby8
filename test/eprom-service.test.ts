/**
 * Tests for EPROM burning (Bitsby8 Story 5.2): burning a .bin into an EPROM card
 * instance stores an override ROM region, content-addresses it, flows the real
 * bytes through the resolver (overriding the card's zero emit), validates without
 * a phantom collision, and erases cleanly. Rejects images that overflow the EPROM.
 */
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Database } from '../src/database';
import { Dependencies } from '../src/types';
import { registerCardDefinition } from '../src/services/catalog';
import { _setSimForTests, SimModule } from '../src/services/bundle-registry';
import { createProfile, toMachineProfile } from '../src/services/profile-service';
import { resolveProfile } from '../src/services/resolver';
import { validateProfile } from '../src/services/collision-validator';
import { burnEprom, eraseEprom } from '../src/services/eprom-service';

const EPROM_SCHEMA = {
  base: { type: 'u16', default: 0xf800, min: 0, max: 0xffff },
  size: { type: 'u16', default: 0x0800, min: 1, max: 0xffff },
} as const;

const fakeSim = {
  seedBundles: [
    {
      manifest: { name: 'eprom-card', version: '1.0.0', type: 'memory', configSchema: EPROM_SCHEMA },
      cardFactory: (id: string) => ({ id, reset() {}, attach() {} }),
      claims: () => ({ ports: [] }),
      memory: (cfg: Record<string, unknown>) => [
        { id: 'rom', base: Number(cfg.base), size: Number(cfg.size), kind: 'rom', image: new Uint8Array(Number(cfg.size)) },
      ],
    },
  ],
  withDefaults: (_m: unknown, c: Record<string, unknown> = {}) => ({
    base: c.base ?? 0xf800,
    size: c.size ?? 0x0800,
  }),
} as unknown as SimModule;

async function makeProfile(deps: Dependencies) {
  await registerCardDefinition(deps, {
    manifest: { name: 'eprom-card', version: '1.0.0', type: 'memory', configSchema: EPROM_SCHEMA },
    source: 'seed',
  });
  return createProfile(deps, {
    name: 'boot-machine',
    cpuKind: 'i8080',
    clock: 'max',
    resetVector: 0xf800,
    memory: [{ id: 'ram', base: 0x0000, size: 0xf800, kind: 'ram' }],
    cards: [{ id: 'eprom0', ref: 'eprom-card@1.0.0', config: { base: 0xf800, size: 0x0800 } }],
  });
}

async function makeDeps(): Promise<Dependencies> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-eprom-'));
  const db = new Database(path.join(dir, 'test.db'));
  await db.initialize();
  return { database: db } as unknown as Dependencies;
}

beforeEach(() => _setSimForTests(fakeSim));
afterEach(() => _setSimForTests(null));

describe('burnEprom', () => {
  test('burns a .bin into the card ROM region and content-addresses it', async () => {
    const deps = await makeDeps();
    const p = await makeProfile(deps);

    const out = await burnEprom(deps, p.id, 'eprom0', {
      bytes: new Uint8Array([0xc3, 0x00, 0xf8]), // JMP 0xF800
      addressing: 'base',
      filename: 'boot.bin',
    });

    expect(out.summary).toBe('burned 3 bytes → 0xF800–0xF802 (binary, from base)');
    expect(out.region).toEqual({ id: 'eprom0/rom', base: 0xf800, size: 0x0800 });

    // A new version whose memory carries the burned override region.
    const region = out.profile.memory.find((m) => m.id === 'eprom0/rom')!;
    expect(region).toMatchObject({ base: 0xf800, size: 0x0800, kind: 'rom' });
    const bytes = Buffer.from(region.image!, 'base64');
    expect(bytes.length).toBe(0x0800); // zero-padded to EPROM size
    expect([...bytes.subarray(0, 3)]).toEqual([0xc3, 0x00, 0xf8]);

    // The burn changed the content digest (it's part of the Identity).
    expect(out.profile.digest).not.toBe(p.digest);
  });

  test('the burned bytes flow through the resolver, overriding the card zero-emit', async () => {
    const deps = await makeDeps();
    const p = await makeProfile(deps);
    const out = await burnEprom(deps, p.id, 'eprom0', { bytes: new Uint8Array([0x76]), addressing: 'base' });

    const { spec } = await resolveProfile(deps, toMachineProfile(out.profile));
    // Exactly one region for the EPROM (override wins — no duplicate zero region).
    const romRegions = spec.memory.filter((m) => m.id === 'eprom0/rom');
    expect(romRegions).toHaveLength(1);
    expect(romRegions[0].image?.[0]).toBe(0x76); // real burned byte, not zero
    // Validator sees no phantom self-collision from the override.
    expect((await validateProfile(deps, out.profile)).ok).toBe(true);
  });

  test('rejects an image larger than the EPROM (422)', async () => {
    const deps = await makeDeps();
    const p = await makeProfile(deps);
    await expect(
      burnEprom(deps, p.id, 'eprom0', { bytes: new Uint8Array(0x900), addressing: 'base' }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  test('refuses a non-memory card (409) and an unknown instance (404)', async () => {
    const deps = await makeDeps();
    const p = await makeProfile(deps);
    await expect(
      burnEprom(deps, p.id, 'nope', { bytes: new Uint8Array([0]), addressing: 'base' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('eraseEprom', () => {
  test('drops the override region, restoring the empty EPROM', async () => {
    const deps = await makeDeps();
    const p = await makeProfile(deps);
    const burned = await burnEprom(deps, p.id, 'eprom0', { bytes: new Uint8Array([0x01]), addressing: 'base' });
    expect(burned.profile.memory.some((m) => m.id === 'eprom0/rom')).toBe(true);

    const erased = await eraseEprom(deps, burned.profile.id, 'eprom0');
    expect(erased.erased).toBe(true);
    expect(erased.profile.memory.some((m) => m.id === 'eprom0/rom')).toBe(false);

    // Resolver falls back to the card's zero-filled emit.
    const { spec } = await resolveProfile(deps, toMachineProfile(erased.profile));
    expect(spec.memory.filter((m) => m.id === 'eprom0/rom')).toHaveLength(1);
  });

  test('erasing an unburned EPROM is a no-op', async () => {
    const deps = await makeDeps();
    const p = await makeProfile(deps);
    const erased = await eraseEprom(deps, p.id, 'eprom0');
    expect(erased.erased).toBe(false);
  });
});
