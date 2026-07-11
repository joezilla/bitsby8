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
  { manifest: { name: 'mits-88-2sio', version: '1.0.0', type: 'serial', maker: 'MITS', configSchema: {} } },
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
    expect(n).toBe(2);
    const all = await listCardDefinitions(deps);
    expect(all.map((d) => d.id).sort()).toEqual(['mits-88-2sio@1.0.0', 'mits-88-dcdd@1.0.0']);
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

  test('is idempotent — re-seeding upserts, no duplicates', async () => {
    const deps = await makeDeps();
    await seedCatalogFromBundles(deps, bundles);
    await seedCatalogFromBundles(deps, bundles);
    expect(await listCardDefinitions(deps)).toHaveLength(2);
  });
});
