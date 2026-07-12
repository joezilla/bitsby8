/**
 * Define-time collision validator (Bitsby8 Story 2.5, FR-8/AR-1) — refuses a
 * Profile whose Card Instances collide on the bus before it can run: two cards
 * claiming the same I/O port, the same IRQ, or overlapping memory regions.
 *
 * Card port/IRQ claims come from each bundle's `claims(config)` (the same
 * machinery the card datasheet's footprint uses), evaluated at the instance's
 * actual config. Memory overlap is pure. Returns EVERY collision (naming both
 * offenders + the specific resource), not just the first — for the inline +
 * validator-bar UX. `auto-assign` sweeps a colliding card's base port for a
 * collision-free value.
 */

import { Dependencies } from '../types';
import { getBundle } from './bundle-registry';
import { ProfileContent } from './profile-service';
import { ConfigParamSpec } from './card-config';

export interface CardClaim {
  cardId: string;
  ref: string;
  ports: number[];
  irq: number | null;
  /** Memory regions this card maps (a RAM/EPROM memory card), namespaced by id. */
  memory: Array<{ id: string; base: number; size: number; kind: string }>;
  /** True if this card is a CPU card (the bus master) — a machine has exactly one. */
  isCpu: boolean;
  /** If a CPU card, the reset vector it forces onto the machine (Story 5.1 override). */
  cpuReset: number | null;
}

export interface Collision {
  kind: 'port' | 'irq' | 'memory' | 'cpu';
  resource: string; // human label, e.g. "I/O port 0x10"
  offenders: string[]; // card instance ids (or memory region ids)
  /** The colliding I/O port (kind 'port' only) — lets the UI highlight it. */
  port?: number;
}

/** A resolved memory region for the address-space ribbon (Story 5.3). */
export interface MemoryBand {
  id: string;
  base: number;
  size: number;
  kind: string; // ram | rom | mmio
  source: 'profile' | 'card';
}

export interface ProfileValidation {
  ok: boolean;
  collisions: Collision[];
  claims: CardClaim[];
  /** The full resolved memory map (profile regions + card-emitted, overrides
   * applied), sorted by base — what the address-space ribbon draws. */
  memoryMap: MemoryBand[];
  /** Non-blocking advisories (e.g. the boot vector doesn't point into ROM). */
  warnings: string[];
}

const hex = (n: number) => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`;

/** Compute each Card Instance's claimed ports/IRQ at its actual config. */
async function claimsOf(deps: Dependencies, cards: ProfileContent['cards']): Promise<CardClaim[]> {
  const out: CardClaim[] = [];
  for (const c of cards) {
    const bundle = await getBundle(deps, c.ref);
    if (!bundle) {
      // Unknown card → no claims we can reason about; skip (catalog validation
      // catches unknown refs on save).
      out.push({ cardId: c.id, ref: c.ref, ports: [], irq: null, memory: [], isCpu: false, cpuReset: null });
      continue;
    }
    const claim = bundle.claims(c.config ?? {});
    const memory = (bundle.memory ? bundle.memory(c.config ?? {}) : []).map((r) => ({
      id: `${c.id}/${r.id}`, // namespaced so two RAM cards don't false-collide on id
      base: r.base,
      size: r.size,
      kind: r.kind,
    }));
    out.push({
      cardId: c.id,
      ref: c.ref,
      // RAW ports (not deduped) so a card whose own config makes two of its
      // ports coincide (an intra-card self-overlap) is visible to validation.
      ports: (claim.ports ?? []).map((p) => p & 0xff).sort((a, b) => a - b),
      irq: claim.irq ?? null,
      memory,
      isCpu: typeof bundle.cpu === 'function',
      cpuReset: bundle.cpu ? (bundle.cpu(c.config ?? {}).resetVector ?? null) : null,
    });
  }
  return out;
}

function memoryCollisions(memory: Array<{ id: string; base: number; size: number }>): Collision[] {
  const out: Collision[] = [];
  for (let i = 0; i < memory.length; i++) {
    for (let j = i + 1; j < memory.length; j++) {
      const a = memory[i];
      const b = memory[j];
      if (a.base < b.base + b.size && b.base < a.base + a.size) {
        const lo = Math.max(a.base, b.base);
        const hi = Math.min(a.base + a.size, b.base + b.size) - 1;
        out.push({
          kind: 'memory',
          resource: `memory ${hex(lo)}–${hex(hi)}`,
          offenders: [a.id, b.id],
        });
      }
    }
  }
  return out;
}

/** Validate a Profile body for bus collisions. Returns every collision found. */
export async function validateProfile(
  deps: Dependencies,
  content: ProfileContent,
): Promise<ProfileValidation> {
  const claims = await claimsOf(deps, content.cards);

  const collisions: Collision[] = [];

  // Intra-card self-overlap: a single card whose config makes two of its own
  // ports coincide (e.g. an SIO whose channel and board-control ports collide).
  // buildMachine reports this confusingly as `"card" and "card"`; catch it here.
  for (const c of claims) {
    const seen = new Set<number>();
    const dupes = new Set<number>();
    for (const p of c.ports) (seen.has(p) ? dupes : seen).add(p);
    for (const p of [...dupes].sort((a, b) => a - b)) {
      collisions.push({ kind: 'port', resource: `I/O port ${hex(p)}`, offenders: [c.cardId], port: p });
    }
  }

  // Cross-card port collisions: any port claimed by 2+ distinct cards (each
  // card counted once per port, so self-overlap above isn't double-reported).
  const portMap = new Map<number, string[]>();
  for (const c of claims) for (const p of new Set(c.ports)) portMap.set(p, [...(portMap.get(p) ?? []), c.cardId]);
  for (const [port, ids] of [...portMap.entries()].sort((a, b) => a[0] - b[0])) {
    if (ids.length > 1) collisions.push({ kind: 'port', resource: `I/O port ${hex(port)}`, offenders: ids, port });
  }

  // IRQ collisions.
  const irqMap = new Map<number, string[]>();
  for (const c of claims) if (c.irq != null) irqMap.set(c.irq, [...(irqMap.get(c.irq) ?? []), c.cardId]);
  for (const [irq, ids] of [...irqMap.entries()].sort((a, b) => a[0] - b[0])) {
    if (ids.length > 1) collisions.push({ kind: 'irq', resource: `IRQ ${irq}`, offenders: ids });
  }

  // Profile-declared regions + card-emitted memory (RAM/EPROM cards) checked
  // together. A card-emitted region whose id is already declared at the profile
  // level is an override (a burned EPROM, Story 5.2), not a second region — the
  // resolver drops the card's emit for it, so exclude it here to avoid a
  // phantom self-collision.
  const declaredIds = new Set(content.memory.map((m) => m.id));
  const allMemory = [
    ...content.memory.map((m) => ({ id: m.id, base: m.base, size: m.size })),
    ...claims.flatMap((c) => c.memory).filter((r) => !declaredIds.has(r.id)),
  ];
  collisions.push(...memoryCollisions(allMemory));

  // Exactly one bus master: two CPU cards can't both drive the bus. (Zero is
  // allowed — the profile's implicit cpuKind stands in.)
  const cpuCards = claims.filter((c) => c.isCpu).map((c) => c.cardId);
  if (cpuCards.length > 1) {
    collisions.push({ kind: 'cpu', resource: 'CPU (bus master)', offenders: cpuCards.sort() });
  }

  // The resolved memory map for the ribbon: profile regions + non-overridden
  // card emits, sorted by base.
  const memoryMap: MemoryBand[] = [
    ...content.memory.map((m) => ({ id: m.id, base: m.base, size: m.size, kind: m.kind, source: 'profile' as const })),
    ...claims
      .flatMap((c) => c.memory)
      .filter((r) => !declaredIds.has(r.id))
      .map((r) => ({ id: r.id, base: r.base, size: r.size, kind: r.kind, source: 'card' as const })),
  ].sort((a, b) => a.base - b.base);

  // Boot-vector advisory: the machine starts executing at the reset vector, so
  // it had better point into ROM (where boot code lives). A seated CPU card
  // OVERRIDES the profile's reset vector (Story 5.1) — its default of 0x0000
  // silently sends the machine into empty RAM, which is a real footgun. Warn at
  // define time rather than let it "run" and produce nothing.
  const warnings: string[] = [];
  const cpuReset = claims.find((c) => c.isCpu && c.cpuReset != null)?.cpuReset;
  const effectiveReset = cpuReset ?? content.resetVector;
  const inRom = memoryMap.some(
    (m) => m.kind === 'rom' && effectiveReset >= m.base && effectiveReset < m.base + m.size,
  );
  if (!inRom) {
    const addr = `0x${effectiveReset.toString(16).toUpperCase().padStart(4, '0')}`;
    const via = cpuReset != null ? ' (set by a CPU card)' : '';
    const where = memoryMap.some((m) => effectiveReset >= m.base && effectiveReset < m.base + m.size)
      ? 'RAM/MMIO — not ROM'
      : 'unmapped memory';
    warnings.push(
      `Reset vector ${addr}${via} points at ${where}. The machine boots there, so put a boot ROM at that address or fix the reset vector — otherwise it runs into nothing.`,
    );
  }

  // Report footprints deduped (raw dups were only needed for self-overlap detection).
  const displayClaims = claims.map((c) => ({ ...c, ports: [...new Set(c.ports)].sort((a, b) => a - b) }));
  return { ok: collisions.length === 0, collisions, claims: displayClaims, memoryMap, warnings };
}

export interface AutoAssignResult {
  content: ProfileContent;
  /** Card instance ids that could not be auto-resolved (manual fix needed). */
  unresolved: string[];
  /** Per-card reassignments applied, for a human summary. */
  changes: Array<{ cardId: string; param: string; from: unknown; to: number }>;
}

/** A card's numeric (u8/u16) config params — the candidate "bases" to sweep. */
async function numericParams(
  deps: Dependencies,
  ref: string,
): Promise<Array<{ name: string; spec: ConfigParamSpec }>> {
  const rec = await deps.database.getCardDefinitionById(ref);
  if (!rec) return [];
  const schema = (JSON.parse(rec.manifest).configSchema ?? {}) as Record<string, ConfigParamSpec>;
  return Object.entries(schema)
    .filter(([, spec]) => spec.type === 'u8' || spec.type === 'u16')
    .map(([name, spec]) => ({ name, spec }));
}

/**
 * Greedily reassign colliding cards to collision-free ports. Processes cards in
 * order; a card that collides with those already placed has each of its numeric
 * config params swept in turn for a value whose whole claim becomes disjoint.
 * Cards needing multi-param coordination (or IRQ/memory collisions, which aren't
 * auto-assigned) are reported as `unresolved` for manual fix.
 */
export async function autoAssign(deps: Dependencies, content: ProfileContent): Promise<AutoAssignResult> {
  const occupiedPorts = new Set<number>();
  // Profile-declared memory regions are fixed anchors auto-assign places around.
  const occupiedMem: Array<[number, number]> = content.memory.map((m) => [m.base, m.base + m.size - 1]);
  const cards = content.cards.map((c) => ({ ...c, config: { ...(c.config ?? {}) } }));
  const unresolved: string[] = [];
  const changes: AutoAssignResult['changes'] = [];

  type Bundle = NonNullable<Awaited<ReturnType<typeof getBundle>>>;
  const regionsOf = (bundle: Bundle, config: Record<string, unknown>): Array<[number, number]> =>
    (bundle.memory ? bundle.memory(config) : []).map((r) => [r.base, r.base + r.size - 1] as [number, number]);
  const memClashes = (regs: Array<[number, number]>): boolean =>
    regs.some(([s, e]) => occupiedMem.some(([os, oe]) => s <= oe && os <= e));

  for (const card of cards) {
    const bundle = await getBundle(deps, card.ref);
    if (!bundle) continue;

    const portsNow = (bundle.claims(card.config).ports ?? []).map((p) => p & 0xff);
    const portsSelfOverlap = new Set(portsNow).size !== portsNow.length;
    const portsClash = portsSelfOverlap || portsNow.some((p) => occupiedPorts.has(p));
    const memNow = regionsOf(bundle, card.config ?? {});
    const memBad = memClashes(memNow);
    let ok = true;

    // Memory: sweep `base` (page-aligned) for a gap the whole card fits into.
    if (memBad) {
      const baseParam = (await numericParams(deps, card.ref)).find((p) => p.name === 'base');
      let placed = false;
      const min = baseParam?.spec.min ?? 0;
      const max = baseParam?.spec.max ?? 0xffff;
      for (let cand = min; baseParam && cand <= max; cand += 0x100) {
        const regs = regionsOf(bundle, { ...card.config, base: cand });
        if (regs.length && regs.every(([, e]) => e <= 0xffff) && !memClashes(regs)) {
          const from = card.config.base;
          card.config.base = cand;
          changes.push({ cardId: card.id, param: 'base', from, to: cand });
          regs.forEach((r) => occupiedMem.push(r));
          placed = true;
          break;
        }
      }
      if (!placed) ok = false;
    } else {
      memNow.forEach((r) => occupiedMem.push(r));
    }

    // Ports: sweep a numeric param (not `base`, which drives memory) for a
    // disjoint claim.
    if (portsClash) {
      let placed = false;
      for (const param of await numericParams(deps, card.ref)) {
        if (param.name === 'base') continue;
        const min = param.spec.min ?? 0;
        const max = param.spec.max ?? (param.spec.type === 'u16' ? 0xffff : 0xff);
        for (let cand = min; cand <= max; cand++) {
          const tports = (bundle.claims({ ...card.config, [param.name]: cand }).ports ?? []).map((p) => p & 0xff);
          const tset = new Set(tports);
          if (tports.length && tset.size === tports.length && ![...tset].some((p) => occupiedPorts.has(p))) {
            const from = card.config[param.name];
            card.config[param.name] = cand;
            changes.push({ cardId: card.id, param: param.name, from, to: cand });
            tports.forEach((p) => occupiedPorts.add(p));
            placed = true;
            break;
          }
        }
        if (placed) break;
      }
      if (!placed) ok = false;
    } else {
      portsNow.forEach((p) => occupiedPorts.add(p));
    }

    if (!ok && !unresolved.includes(card.id)) {
      unresolved.push(card.id);
      portsNow.forEach((p) => occupiedPorts.add(p)); // reserve so later cards still avoid it
    }
  }

  return { content: { ...content, cards }, unresolved, changes };
}
