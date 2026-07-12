/**
 * Runtime access to 8sim's card bundles (Bitsby8 Story 1.3).
 *
 * The Resolver is the sole code loader (AD-2). This module crosses the CJS→ESM
 * boundary once (cached) via a runtime `import()` preserved through
 * `new Function(...)` so tsc's CommonJS output does not down-level it to
 * `require()`. Types are imported statically from 8sim (erased at compile time).
 */

import type {
  MachineSpec,
  Machine,
  CardManifest,
  CardFactory,
  ClaimsFn,
  MemoryRegionSpec,
  CpuKind,
} from '@joezilla/8sim';

/** A seed bundle as exported by 8sim at runtime. A `memory` card additionally
 * declares the RAM/ROM region(s) it maps; a `cpu` card declares the processor
 * (Story 5.1). */
export interface SeedBundleRuntime {
  manifest: CardManifest;
  cardFactory: CardFactory;
  claims: ClaimsFn;
  memory?: (config: Record<string, unknown>) => MemoryRegionSpec[];
  cpu?: (config: Record<string, unknown>) => { kind: CpuKind; resetVector?: number };
}

/** The subset of the 8sim module surface the orchestration layer uses. */
export interface SimModule {
  seedBundles: ReadonlyArray<SeedBundleRuntime>;
  withDefaults: (manifest: CardManifest, config?: Record<string, unknown>) => Record<string, unknown>;
  buildMachine: (spec: MachineSpec, opts?: { services?: Record<string, unknown>; log?: (m: string) => void }) => Machine;
}

const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<SimModule>;

let cached: SimModule | null = null;

/** Load the 8sim engine module once (cached). */
export async function getSim(): Promise<SimModule> {
  if (!cached) cached = await dynamicImport('@joezilla/8sim');
  return cached;
}

/** Find a seed bundle by Identity (`name@version`). */
export async function getSeedBundle(identity: string): Promise<SeedBundleRuntime | undefined> {
  const sim = await getSim();
  return sim.seedBundles.find((b) => `${b.manifest.name}@${b.manifest.version}` === identity);
}

/** Test seam: inject a fake/real SimModule (pass null to reset to lazy load). */
export function _setSimForTests(sim: SimModule | null): void {
  cached = sim;
}
