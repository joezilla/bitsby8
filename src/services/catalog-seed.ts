/**
 * Seed loader (Bitsby8 Story 1.2, Task 5) — registers 8sim's built-in seed
 * Card Bundles into the Catalog on startup.
 *
 * The registration logic (`seedCatalogFromBundles`) is transport-agnostic and
 * unit-tested with plain objects. `loadSeedCatalog` performs the actual
 * CJS→ESM boundary crossing: the CommonJS backend loads the ESM `8sim` engine
 * via a runtime dynamic `import()`. It is wrapped in `new Function(...)` so
 * TypeScript's CommonJS output does NOT down-level `import()` to `require()`
 * (which cannot load 8sim's ESM) — the packaging approach the spike proved
 * (architecture AD-2 / §11 Q3).
 */

import { Dependencies } from '../types';
import { registerCardDefinition } from './catalog';
import { createLogger } from '../logger';

const log = createLogger('catalog-seed');

/** Structural shape of a seed bundle's manifest as exported by 8sim. */
export interface SeedManifestLike {
  name: string;
  version: string;
  type: string;
  kind?: 'card' | 'chip';
  maker?: string;
  summary?: string;
  configSchema: Record<string, unknown>;
}
export interface SeedBundleLike {
  manifest: SeedManifestLike;
}

/**
 * Register each bundle's manifest into the Catalog as a Card Definition
 * (idempotent — re-registering the same Identity upserts). Returns the count.
 */
export async function seedCatalogFromBundles(
  deps: Dependencies,
  bundles: ReadonlyArray<SeedBundleLike>,
): Promise<number> {
  let count = 0;
  for (const b of bundles) {
    const m = b.manifest;
    await registerCardDefinition(deps, {
      manifest: {
        name: m.name,
        version: m.version,
        type: m.type,
        kind: m.kind,
        maker: m.maker,
        summary: m.summary,
        configSchema: m.configSchema,
      },
      entry: `seed:${m.name}`,
      source: 'seed',
    });
    count++;
  }
  return count;
}

/**
 * Load 8sim's built-in seed bundles and register them into the Catalog.
 * Non-fatal: if 8sim is unavailable (not yet installed as a dependency), it
 * logs and returns 0 rather than failing daemon startup.
 */
export async function loadSeedCatalog(deps: Dependencies): Promise<number> {
  try {
    // Preserve a real runtime `import()` past tsc's CommonJS transform.
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (
      specifier: string,
    ) => Promise<{ seedBundles?: ReadonlyArray<SeedBundleLike> }>;
    const sim = await dynamicImport('@joezilla/8sim');
    const bundles = sim.seedBundles;
    if (!bundles || bundles.length === 0) {
      log.warn('8sim exports no seedBundles; Catalog not seeded');
      return 0;
    }
    const n = await seedCatalogFromBundles(deps, bundles);
    log.info(`seeded ${n} card definitions from 8sim into the Catalog`);
    return n;
  } catch (err) {
    log.warn(`could not load 8sim seed bundles (Catalog seeding skipped): ${(err as Error).message}`);
    return 0;
  }
}
