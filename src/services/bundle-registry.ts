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
import { Dependencies } from '../types';
import { synthesizeAuthoredBundle, AuthoredManifest } from './authored-bundle';

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

/** A behavior kernel (Story 5.7): a trusted, parameterized device an authored
 * I/O card is synthesized from — the host references it by `id`. */
export interface CardKernelRuntime {
  id: string;
  label: string;
  type: string;
  /** The peripheral endpoint this kernel's card binds to (e.g. 'terminal'). */
  binding?: string;
  configSchema: Record<string, unknown>;
  create: CardFactory;
  claims: ClaimsFn;
}

/** The subset of the 8sim module surface the orchestration layer uses. */
export interface SimModule {
  seedBundles: ReadonlyArray<SeedBundleRuntime>;
  /** Behavior kernels for authored I/O cards (Story 5.7). Absent on 8sim < 0.4. */
  kernels?: ReadonlyArray<CardKernelRuntime>;
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

/**
 * Resolve a card bundle by Identity: a built-in seed bundle, or — falling back —
 * a synthesized bundle for an authored declarative card (Story 5.4). This is the
 * single lookup the resolver/validator/burn path use so authored cards run
 * exactly like seed cards.
 */
export async function getBundle(
  deps: Dependencies,
  identity: string,
): Promise<SeedBundleRuntime | undefined> {
  const seed = await getSeedBundle(identity);
  if (seed) return seed;
  const rec = await deps.database.getCardDefinitionById(identity);
  if (rec && rec.source === 'authored') {
    const sim = await getSim();
    return synthesizeAuthoredBundle(JSON.parse(rec.manifest) as AuthoredManifest, sim.kernels);
  }
  return undefined;
}

/** The behavior kernels an authored I/O card can be built from (Story 5.7). */
export async function listKernels(): Promise<ReadonlyArray<CardKernelRuntime>> {
  const sim = await getSim();
  return sim.kernels ?? [];
}

/** Test seam: inject a fake/real SimModule (pass null to reset to lazy load). */
export function _setSimForTests(sim: SimModule | null): void {
  cached = sim;
}

/** A CPU the engine can run, for the Profile builder's CPU picker (Story 5.3). */
export interface CpuInfo {
  kind: CpuKind;
  /** The seed CPU card that provides it, if any (`name@version`). */
  ref?: string;
  name: string;
  maker?: string;
}

const CPU_LABELS: Record<string, string> = { i8080: 'Intel 8080', z80: 'Zilog Z80' };

/** List the CPUs available to a Machine Profile — derived from the seed CPU
 * cards, with the two kinds the engine always supports as a floor. */
export async function listCpus(): Promise<CpuInfo[]> {
  const sim = await getSim();
  const out = new Map<CpuKind, CpuInfo>();
  for (const b of sim.seedBundles) {
    if (typeof b.cpu !== 'function') continue;
    const kind = b.cpu(sim.withDefaults(b.manifest, {})).kind;
    if (!out.has(kind)) {
      out.set(kind, {
        kind,
        ref: `${b.manifest.name}@${b.manifest.version}`,
        name: CPU_LABELS[kind] ?? kind,
        maker: (b.manifest as { maker?: string }).maker,
      });
    }
  }
  for (const kind of ['i8080', 'z80'] as CpuKind[]) {
    if (!out.has(kind)) out.set(kind, { kind, name: CPU_LABELS[kind] ?? kind });
  }
  return [...out.values()];
}
