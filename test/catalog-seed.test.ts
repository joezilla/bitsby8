/**
 * Tests for the Catalog seed loader's registration logic (Bitsby8 Story 1.2
 * Task 5). Exercises `seedCatalogFromBundles` with plain objects — the CJS→ESM
 * `loadSeedCatalog` import path is wired separately at startup.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Database } from '../src/database';
import { Dependencies } from '../src/types';
import { seedCatalogFromBundles, SeedBundleLike } from '../src/services/catalog-seed';
import { listCardDefinitions, getCardDefinition } from '../src/services/catalog';

async function makeDeps(): Promise<Dependencies> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-seed-'));
  const db = new Database(path.join(dir, 'test.db'));
  await db.initialize();
  return { database: db } as unknown as Dependencies;
}

const bundles: SeedBundleLike[] = [
  { manifest: { name: 'mits-88-2sio', version: '1.0.0', type: 'serial', kind: 'card', maker: 'MITS', configSchema: {} } },
  {
    manifest: {
      name: 'motorola-6850',
      version: '1.0.0',
      type: 'serial',
      kind: 'chip',
      maker: 'Motorola',
      configSchema: { statusPort: { type: 'u8', default: 16 } },
    },
  },
  {
    manifest: {
      name: 'mits-88-dcdd',
      version: '1.0.0',
      type: 'floppy',
      maker: 'MITS',
      configSchema: { basePort: { type: 'u8', default: 8 } },
    },
  },
];

describe('seedCatalogFromBundles', () => {
  test('registers every bundle manifest as a Card Definition', async () => {
    const deps = await makeDeps();
    const n = await seedCatalogFromBundles(deps, bundles);
    expect(n).toBe(3);
    const all = await listCardDefinitions(deps);
    expect(all.map((d) => d.id).sort()).toEqual([
      'mits-88-2sio@1.0.0',
      'mits-88-dcdd@1.0.0',
      'motorola-6850@1.0.0',
    ]);
  });

  test('tags provenance and entry ref', async () => {
    const deps = await makeDeps();
    await seedCatalogFromBundles(deps, bundles);
    const doc = await getCardDefinition(deps, 'mits-88-dcdd@1.0.0');
    expect(doc.source).toBe('seed');
    expect(doc.entry).toBe('seed:mits-88-dcdd');
    expect(doc.type).toBe('floppy');
    expect(doc.manifest.configSchema).toHaveProperty('basePort');
  });

  test('passes the primitive kind through (card vs chip)', async () => {
    const deps = await makeDeps();
    await seedCatalogFromBundles(deps, bundles);
    expect((await getCardDefinition(deps, 'mits-88-2sio@1.0.0')).kind).toBe('card');
    expect((await getCardDefinition(deps, 'motorola-6850@1.0.0')).kind).toBe('chip');
    // A bundle with no kind defaults to card.
    expect((await getCardDefinition(deps, 'mits-88-dcdd@1.0.0')).kind).toBe('card');
  });

  test('is idempotent — re-seeding upserts, no duplicates', async () => {
    const deps = await makeDeps();
    await seedCatalogFromBundles(deps, bundles);
    await seedCatalogFromBundles(deps, bundles);
    expect(await listCardDefinitions(deps)).toHaveLength(3);
  });
});
