/**
 * Card detail / datasheet (Bitsby8 Story 2.2) — the "knowledge library" face of
 * a Card Definition. Projects the card's REAL metadata into the datasheet:
 *   - default bus footprint (ports/IRQ) — from the bundle's `claims(defaults)`,
 *   - a generated Skills file (human- and agent-readable) — a faithful markdown
 *     projection of Identity + footprint + config schema + type-specific notes,
 *   - the version list for the card name, and the used-by reverse index.
 *
 * Footprint crosses the ESM boundary (getSeedBundle → getSim), so it degrades to
 * null when no bundle backs the card (e.g. a future imported card); everything
 * else is synchronous DB/manifest data.
 */

import { Dependencies } from '../types';
import { getCardDefinition, listCardDefinitions, CardDefinitionDoc } from './catalog';
import { getSim, getSeedBundle } from './bundle-registry';
import { createLogger } from '../logger';

const log = createLogger('card-detail');

/** The default bus resources a card claims at its default config. */
export interface CardFootprint {
  ports: number[];
  irq: number | null;
}

export interface CardVersion {
  id: string;
  version: string;
  digest: string;
  source: string;
  createdAt: string;
}

export interface CardDetail {
  card: CardDefinitionDoc;
  /** Default bus footprint; null when not derivable (no bundle). */
  footprint: CardFootprint | null;
  /** Generated Skills file — human- and agent-readable markdown. */
  skills: string;
  /** All versions of this card name, newest semver first. */
  versions: CardVersion[];
  /** Machine Profiles referencing this card. Empty until Profile CRUD (Story 2.3). */
  usedBy: string[];
}

const hex = (n: number): string => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`;

/** Compare two semver-ish `x.y.z` strings; newest first. */
function bySemverDesc(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pb[i] ?? 0) !== (pa[i] ?? 0)) return (pb[i] ?? 0) - (pa[i] ?? 0);
  }
  return 0;
}

/** Compute the default bus footprint via the card's bundle (ESM); null on miss. */
async function deriveFootprint(id: string): Promise<CardFootprint | null> {
  try {
    const bundle = await getSeedBundle(id);
    if (!bundle) return null;
    const sim = await getSim();
    const cfg = sim.withDefaults(bundle.manifest, {});
    const claims = bundle.claims(cfg);
    return {
      ports: [...(claims.ports ?? [])].sort((a, b) => a - b),
      irq: claims.irq ?? null,
    };
  } catch (err) {
    log.warn({ err, id }, 'footprint derivation failed');
    return null;
  }
}

const TYPE_NOTES: Record<string, string> = {
  serial:
    'Exposes a serial channel (console-capable). Program it through its data/status ports: poll the status port for TX-ready before writing a byte, and for RX-full before reading one.',
  floppy:
    'Floppy disk controller served over the FDC transport. Boot loaders select a drive, load the head, then seek/read/write sectors via its command ports; disk images are mounted operator-side and copy-on-write per client.',
  memory: 'Memory / ROM region mapped onto the bus. Its bytes are addressed by the CPU directly, not through I/O ports.',
  panel: 'Front-panel / machine-control card (sense switches, run/stop, examine/deposit).',
  other: 'General-purpose S-100 card. See its Configuration schema for the ports it claims.',
};

/** Build a faithful, agent-consumable Skills file from the card's metadata. */
export function generateSkills(card: CardDefinitionDoc, footprint: CardFootprint | null): string {
  const m = card.manifest;
  const lines: string[] = [];
  lines.push(`# ${card.name} \`${card.version}\``);
  lines.push('');
  if (card.summary) lines.push(`> ${card.summary}`);
  lines.push('');
  lines.push(`- **Identity:** \`${card.id}\``);
  lines.push(`- **Kind:** ${card.kind === 'chip' ? 'chip (component)' : 'card (S-100 board)'}`);
  lines.push(`- **Type:** ${card.type}`);
  if (card.maker) lines.push(`- **Maker:** ${card.maker}`);
  if (card.capabilities.length) lines.push(`- **Capabilities:** ${card.capabilities.join(', ')}`);
  lines.push(`- **Digest:** \`${card.digest}\``);
  lines.push('');

  lines.push('## Default bus footprint');
  if (footprint) {
    lines.push(`- **Ports:** ${footprint.ports.length ? footprint.ports.map(hex).join(', ') : 'none'}`);
    lines.push(`- **IRQ:** ${footprint.irq == null ? 'none' : String(footprint.irq)}`);
  } else {
    lines.push('_Not derivable for this card._');
  }
  lines.push('');

  const params = Object.entries(m.configSchema ?? {});
  if (params.length) {
    lines.push('## Configuration');
    lines.push('');
    lines.push('| Parameter | Type | Default | Range | Description |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const [key, specRaw] of params) {
      const spec = (specRaw ?? {}) as Record<string, unknown>;
      const type = String(spec.type ?? '');
      const isByte = /^u(8|16)$/.test(type) && typeof spec.default === 'number';
      const def = spec.default === undefined ? '—' : isByte ? hex(spec.default as number) : String(spec.default);
      const range =
        typeof spec.min === 'number' && typeof spec.max === 'number'
          ? `${isByte ? hex(spec.min) : spec.min}–${isByte ? hex(spec.max) : spec.max}`
          : '—';
      lines.push(`| \`${key}\` | ${type || '—'} | ${def} | ${range} | ${String(spec.description ?? '')} |`);
    }
    lines.push('');
  }

  lines.push('## Programming notes');
  lines.push(TYPE_NOTES[card.type] ?? TYPE_NOTES.other);
  lines.push('');
  return lines.join('\n');
}

/** Assemble the full datasheet for one Card Definition. */
export async function getCardDetail(deps: Dependencies, id: string): Promise<CardDetail> {
  const card = await getCardDefinition(deps, id); // 404 if unknown
  const footprint = await deriveFootprint(id);
  const all = await listCardDefinitions(deps, {});
  const versions: CardVersion[] = all
    .filter((c) => c.name === card.name)
    .map((c) => ({ id: c.id, version: c.version, digest: c.digest, source: c.source, createdAt: c.createdAt }))
    .sort((a, b) => bySemverDesc(a.version, b.version));
  return {
    card,
    footprint,
    skills: generateSkills(card, footprint),
    versions,
    usedBy: [], // Profiles land in Story 2.3; the reverse index is populated then.
  };
}
