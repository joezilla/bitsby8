/**
 * Tests for the card datasheet service (Bitsby8 Story 2.2): default bus
 * footprint (from the bundle's claims), the generated Skills file, versions,
 * and graceful degradation when no bundle backs a card. The footprint crosses
 * the ESM boundary jest can't run, so a fake sim is injected via _setSimForTests.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Database } from '../src/database';
import { Dependencies } from '../src/types';
import { registerCardDefinition } from '../src/services/catalog';
import { getCardDetail, generateSkills } from '../src/services/card-detail';
import { _setSimForTests, SimModule } from '../src/services/bundle-registry';

// Fake sim: one seed bundle for mits-88-2sio claiming ports 0x10..0x13.
const fakeSim = {
  seedBundles: [
    {
      manifest: {
        name: 'mits-88-2sio',
        version: '1.0.0',
        type: 'serial',
        maker: 'MITS',
        configSchema: { basePort: { type: 'u8', default: 0x10, min: 0, max: 0xfc, description: 'Base I/O port' } },
      },
      cardFactory: (id: string) => ({ id, reset() {}, attach() {} }),
      claims: (cfg: Record<string, unknown>) => {
        const b = (cfg.basePort as number) ?? 0x10;
        return { ports: [b + 3, b, b + 2, b + 1] }; // deliberately unsorted
      },
    },
  ],
  withDefaults: (m: { configSchema?: Record<string, { default?: unknown }> }, c: Record<string, unknown> = {}) => {
    const out: Record<string, unknown> = {};
    for (const [k, spec] of Object.entries(m.configSchema ?? {})) out[k] = spec.default;
    return { ...out, ...c };
  },
} as unknown as SimModule;

async function makeDeps(): Promise<Dependencies> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-cd-'));
  const db = new Database(path.join(dir, 'test.db'));
  await db.initialize();
  return { database: db } as unknown as Dependencies;
}

const sample = {
  manifest: {
    name: 'mits-88-2sio',
    version: '1.0.0',
    type: 'serial',
    maker: 'MITS',
    summary: 'MITS 88-2SIO dual serial interface.',
    configSchema: { basePort: { type: 'u8', default: 0x10, min: 0, max: 0xfc, description: 'Base I/O port' } },
  },
  source: 'seed' as const,
};

beforeEach(() => _setSimForTests(fakeSim));
afterEach(() => _setSimForTests(null));

describe('card-detail: getCardDetail', () => {
  test('derives a sorted default bus footprint from the bundle claims', async () => {
    const deps = await makeDeps();
    await registerCardDefinition(deps, sample);
    const detail = await getCardDetail(deps, 'mits-88-2sio@1.0.0');
    expect(detail.card.id).toBe('mits-88-2sio@1.0.0');
    expect(detail.footprint).toEqual({ ports: [0x10, 0x11, 0x12, 0x13], irq: null });
    expect(detail.usedBy).toEqual([]); // no profiles yet
  });

  test('footprint is null when no bundle backs the card', async () => {
    const deps = await makeDeps();
    await registerCardDefinition(deps, {
      manifest: { ...sample.manifest, name: 'ghost-card' },
      source: 'imported',
    });
    const detail = await getCardDetail(deps, 'ghost-card@1.0.0');
    expect(detail.footprint).toBeNull();
    expect(detail.skills).toContain('Not derivable');
  });

  test('lists all versions of the card name, newest semver first', async () => {
    const deps = await makeDeps();
    await registerCardDefinition(deps, sample);
    await registerCardDefinition(deps, { ...sample, manifest: { ...sample.manifest, version: '1.2.0' } });
    await registerCardDefinition(deps, { ...sample, manifest: { ...sample.manifest, version: '1.10.0' } });
    const detail = await getCardDetail(deps, 'mits-88-2sio@1.0.0');
    expect(detail.versions.map((v) => v.version)).toEqual(['1.10.0', '1.2.0', '1.0.0']);
  });

  test('404s for an unknown card', async () => {
    const deps = await makeDeps();
    await expect(getCardDetail(deps, 'nope@9.9.9')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('card-detail: generateSkills', () => {
  test('projects Identity, footprint, config schema, and type notes into markdown', () => {
    const card = {
      id: 'mits-88-2sio@1.0.0',
      name: 'mits-88-2sio',
      version: '1.0.0',
      digest: 'sha256:abc',
      type: 'serial',
      kind: 'card' as const,
      maker: 'MITS',
      summary: 'Dual serial interface.',
      capabilities: ['serial-io'],
      manifest: {
        name: 'mits-88-2sio',
        version: '1.0.0',
        type: 'serial',
        configSchema: { basePort: { type: 'u8', default: 0x10, min: 0, max: 0xfc, description: 'Base I/O port' } },
      },
      entry: null,
      source: 'seed',
      createdAt: 'now',
    };
    const skills = generateSkills(card, { ports: [0x10, 0x11], irq: null });
    expect(skills).toContain('# mits-88-2sio');
    expect(skills).toContain('`mits-88-2sio@1.0.0`');
    expect(skills).toContain('0x10, 0x11'); // footprint ports as hex
    expect(skills).toContain('| `basePort` |'); // config table row
    expect(skills).toContain('0xFC'); // range max in hex
    expect(skills).toMatch(/serial channel/i); // type-specific programming note
  });
});
