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
  /** Which Card Instance drives the operator console; defaults to the first
   * card that exposes a serial console channel. */
  consoleCardId?: string;
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
  // Card-emitted memory regions are hoisted into the machine's declared memory
  // map (Story 5.1) — a memory card (RAM/EPROM) resolves to a region, namespaced
  // by its instance id, so buildMachine validates it like any other region.
  const memory: MemoryRegionSpec[] = [...profile.memory];
  // A CPU card (the processor board) resolves to the machine's CPU. Zero CPU
  // cards → the profile's implicit CPU (backward compatible); more than one is a
  // collision the validator rejects. The card also carries the power-on jump.
  let cpuKind: CpuKind = profile.cpuKind;
  let resetVector = profile.resetVector;

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

    if (bundle.memory) {
      for (const region of bundle.memory(cfg)) {
        const nsId = `${inst.id}/${region.id}`;
        // A profile-declared region with this id overrides the card's default
        // emit — that's how a burned EPROM image (Story 5.2) supplies real bytes
        // in place of the card's zero-filled region.
        if (memory.some((m) => m.id === nsId)) continue;
        memory.push({ ...region, id: nsId });
      }
    }

    if (bundle.cpu) {
      const c = bundle.cpu(cfg);
      cpuKind = c.kind;
      if (c.resetVector != null) resetVector = c.resetVector;
    }

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
    cpuKind,
    clock: profile.clock,
    resetVector,
    memory,
    cards,
  };

  return { spec, provenance };
}
