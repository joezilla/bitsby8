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
import { getSeedBundle } from './bundle-registry';
import { ProfileContent } from './profile-service';
import { ConfigParamSpec } from './card-config';

export interface CardClaim {
  cardId: string;
  ref: string;
  ports: number[];
  irq: number | null;
}

export interface Collision {
  kind: 'port' | 'irq' | 'memory';
  resource: string; // human label, e.g. "I/O port 0x10"
  offenders: string[]; // card instance ids (or memory region ids)
}

export interface ProfileValidation {
  ok: boolean;
  collisions: Collision[];
  claims: CardClaim[];
}

const hex = (n: number) => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`;

/** Compute each Card Instance's claimed ports/IRQ at its actual config. */
async function claimsOf(cards: ProfileContent['cards']): Promise<CardClaim[]> {
  const out: CardClaim[] = [];
  for (const c of cards) {
    const bundle = await getSeedBundle(c.ref);
    if (!bundle) {
      // Unknown card → no claims we can reason about; skip (catalog validation
      // catches unknown refs on save).
      out.push({ cardId: c.id, ref: c.ref, ports: [], irq: null });
      continue;
    }
    const claim = bundle.claims(c.config ?? {});
    out.push({
      cardId: c.id,
      ref: c.ref,
      ports: [...new Set((claim.ports ?? []).map((p) => p & 0xff))].sort((a, b) => a - b),
      irq: claim.irq ?? null,
    });
  }
  return out;
}

function memoryCollisions(memory: ProfileContent['memory']): Collision[] {
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
  _deps: Dependencies,
  content: ProfileContent,
): Promise<ProfileValidation> {
  const claims = await claimsOf(content.cards);

  const collisions: Collision[] = [];

  // Port collisions: any port claimed by 2+ cards.
  const portMap = new Map<number, string[]>();
  for (const c of claims) for (const p of c.ports) portMap.set(p, [...(portMap.get(p) ?? []), c.cardId]);
  for (const [port, ids] of [...portMap.entries()].sort((a, b) => a[0] - b[0])) {
    if (ids.length > 1) collisions.push({ kind: 'port', resource: `I/O port ${hex(port)}`, offenders: ids });
  }

  // IRQ collisions.
  const irqMap = new Map<number, string[]>();
  for (const c of claims) if (c.irq != null) irqMap.set(c.irq, [...(irqMap.get(c.irq) ?? []), c.cardId]);
  for (const [irq, ids] of [...irqMap.entries()].sort((a, b) => a[0] - b[0])) {
    if (ids.length > 1) collisions.push({ kind: 'irq', resource: `IRQ ${irq}`, offenders: ids });
  }

  collisions.push(...memoryCollisions(content.memory));

  return { ok: collisions.length === 0, collisions, claims };
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
  const occupied = new Set<number>();
  const cards = content.cards.map((c) => ({ ...c, config: { ...(c.config ?? {}) } }));
  const unresolved: string[] = [];
  const changes: AutoAssignResult['changes'] = [];

  for (const card of cards) {
    const bundle = await getSeedBundle(card.ref);
    if (!bundle) continue;
    const ports = (bundle.claims(card.config).ports ?? []).map((p) => p & 0xff);
    if (!ports.some((p) => occupied.has(p))) {
      ports.forEach((p) => occupied.add(p));
      continue;
    }

    let placed = false;
    for (const param of await numericParams(deps, card.ref)) {
      const min = param.spec.min ?? 0;
      const max = param.spec.max ?? (param.spec.type === 'u16' ? 0xffff : 0xff);
      for (let cand = min; cand <= max; cand++) {
        const tports = (bundle.claims({ ...card.config, [param.name]: cand }).ports ?? []).map((p) => p & 0xff);
        if (tports.length && !tports.some((p) => occupied.has(p))) {
          const from = card.config[param.name];
          card.config[param.name] = cand;
          changes.push({ cardId: card.id, param: param.name, from, to: cand });
          tports.forEach((p) => occupied.add(p));
          placed = true;
          break;
        }
      }
      if (placed) break;
    }
    if (!placed) {
      unresolved.push(card.id);
      ports.forEach((p) => occupied.add(p));
    }
  }

  return { content: { ...content, cards }, unresolved, changes };
}
