/**
 * Resolver (Bitsby8 Story 1.3) — turns a declarative Machine Profile into a
 * runtime MachineSpec with live card factories, ready for 8sim `buildMachine`.
 *
 * The Resolver is the SOLE code loader (AD-2): it loads each card's bundle
 * (via {@link getSim}), binds validated config through the in-bundle adapter,
 * derives bus claims, and records provenance from the Catalog. 8sim itself
 * never imports a bundle. The trust boundary lives here.
 */

import type { MachineSpec, CardSpec, MemoryRegionSpec, CpuKind, Clock } from '@joezilla/8sim';
import { Dependencies } from '../types';
import { ServiceError } from './service-error';
import { getSim, getSeedBundle } from './bundle-registry';

/** A card installed in a Profile, referencing a Card Definition by Identity. */
export interface ProfileCardInstance {
  id: string;
  ref: string; // name@version
  config?: Record<string, unknown>;
}

/** A declarative Machine Profile (Tier-1 shape). DB-backed CRUD is Story 2.3. */
export interface MachineProfile {
  cpuKind: CpuKind;
  clock: Clock;
  resetVector: number;
  memory: MemoryRegionSpec[];
  cards: ProfileCardInstance[];
}

export interface ResolvedCardProvenance {
  id: string;
  ref: string;
  source: string | null;
  digest: string | null;
  inCatalog: boolean;
}

export interface ResolvedMachine {
  spec: MachineSpec;
  provenance: ResolvedCardProvenance[];
}

/**
 * Resolve a Machine Profile into a MachineSpec (with live factories) + the
 * provenance of each card. Throws ServiceError if a card's bundle can't be
 * resolved or its config is invalid.
 */
export async function resolveProfile(
  deps: Dependencies,
  profile: MachineProfile,
): Promise<ResolvedMachine> {
  const sim = await getSim();
  const cards: CardSpec[] = [];
  const provenance: ResolvedCardProvenance[] = [];

  for (const inst of profile.cards) {
    const bundle = await getSeedBundle(inst.ref);
    if (!bundle) {
      throw new ServiceError(
        `Card bundle not found for ${inst.ref} (instance "${inst.id}")`,
        404,
        { ref: inst.ref, instance: inst.id },
      );
    }

    let cfg: Record<string, unknown>;
    try {
      cfg = sim.withDefaults(bundle.manifest, inst.config ?? {});
    } catch (err) {
      throw new ServiceError(
        `Invalid config for instance "${inst.id}" (${inst.ref}): ${(err as Error).message}`,
        400,
        { ref: inst.ref, instance: inst.id },
      );
    }

    cards.push({ id: inst.id, factory: bundle.cardFactory, config: cfg, claims: bundle.claims(cfg) });

    const rec = await deps.database.getCardDefinitionById(inst.ref);
    provenance.push({
      id: inst.id,
      ref: inst.ref,
      source: rec?.source ?? null,
      digest: rec?.digest ?? null,
      inCatalog: !!rec,
    });
  }

  const spec: MachineSpec = {
    cpuKind: profile.cpuKind,
    clock: profile.clock,
    resetVector: profile.resetVector,
    memory: profile.memory,
    cards,
  };

  return { spec, provenance };
}
