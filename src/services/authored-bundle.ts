/**
 * Authored declarative cards (Bitsby8 Story 5.4).
 *
 * A user can author a Card Definition with NO code by choosing a declarative
 * `behavior` — a memory board (RAM/EPROM) or a CPU board. The host synthesizes
 * the runtime bundle from that behavior, producing the exact shape the seed
 * cards proved in Story 5.1 (a `memory(config)` or `cpu(config)` resolution, a
 * no-op factory, no I/O claims). Custom *code* behavior stays gated for Tier-2
 * (Story 5.5); this module never runs user code.
 */

import type { SeedBundleRuntime } from './bundle-registry';

/** The declarative behavior an authored card resolves to. */
export type CardBehavior =
  | { resolvesTo: 'memory'; memKind: 'ram' | 'rom' }
  | { resolvesTo: 'cpu'; cpuKind: 'i8080' | 'z80' };

/** A manifest that may carry an authored behavior (stored in the Catalog). */
export interface AuthoredManifest {
  name: string;
  version: string;
  type: string;
  kind?: string;
  maker?: string;
  summary?: string;
  configSchema: Record<string, unknown>;
  behavior?: CardBehavior;
}

const u16 = (v: unknown, fallback: number): number =>
  typeof v === 'number' ? v & 0xffff : fallback;

const noopCard = (id: string) => ({ id, reset: () => {}, attach: () => {} });

/**
 * Build a runtime bundle for an authored declarative card, or undefined if the
 * manifest carries no (recognized) behavior. Mirrors the seed ram/eprom/cpu
 * bundles exactly — the resolver treats it identically to a seed bundle.
 */
export function synthesizeAuthoredBundle(manifest: AuthoredManifest): SeedBundleRuntime | undefined {
  const b = manifest.behavior;
  if (!b) return undefined;
  const base = {
    manifest: manifest as unknown as SeedBundleRuntime['manifest'],
    cardFactory: noopCard as unknown as SeedBundleRuntime['cardFactory'],
    claims: (() => ({ ports: [] })) as SeedBundleRuntime['claims'],
  };

  if (b.resolvesTo === 'memory') {
    const regionId = b.memKind === 'rom' ? 'rom' : 'ram';
    return {
      ...base,
      memory: (cfg: Record<string, unknown>) => {
        const size = u16(cfg.size, 0);
        const region = { id: regionId, base: u16(cfg.base, 0), size, kind: b.memKind };
        // A ROM region needs a zero-filled image (burnable via the override, 5.2).
        return [b.memKind === 'rom' ? { ...region, image: new Uint8Array(size) } : region];
      },
    };
  }

  if (b.resolvesTo === 'cpu') {
    return {
      ...base,
      cpu: (cfg: Record<string, unknown>) => ({ kind: b.cpuKind, resetVector: u16(cfg.resetVector, 0) }),
    };
  }

  return undefined;
}
