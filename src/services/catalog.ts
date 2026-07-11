/**
 * Catalog service (Bitsby8) — Card Definitions.
 *
 * A Card Definition is a versioned Primitive: Identity = `name@version` +
 * a content `digest`. Registration/list/get are consumed by both REST routes
 * and MCP tools (shared service layer). The digest here is a basic sha256 over
 * the manifest + entry; the full byte-exact content-addressing rule (JCS
 * manifest, POSIX/NFC paths, frozen mediaType table) lands in Story 4.1 (AD-8).
 */

import { createHash } from 'crypto';
import { Dependencies } from '../types';
import { CardDefinitionRecord } from '../database';
import { ServiceError } from './service-error';

/** The declarative surface of a card (mirrors 8sim's CardManifest). */
export interface CardManifestInput {
  name: string;
  version: string;
  type: string;
  maker?: string;
  summary?: string;
  configSchema: Record<string, unknown>;
}

export interface RegisterCardInput {
  manifest: CardManifestInput;
  /** Reference to the bundle's pre-built behavior module (module specifier / path). */
  entry?: string;
  /** Provenance: 'seed' (built-in), 'imported', or 'signed'. Defaults to 'seed'. */
  source?: 'seed' | 'imported' | 'signed';
}

/** A Card Definition as returned to REST/MCP (manifest parsed, camelCase). */
export interface CardDefinitionDoc {
  id: string;
  name: string;
  version: string;
  digest: string;
  type: string;
  maker: string | null;
  summary: string | null;
  /** Derived capability tags (from the manifest) — a browse/filter facet. */
  capabilities: string[];
  manifest: CardManifestInput;
  entry: string | null;
  source: string;
  createdAt: string;
}

/** Filter for browsing the Catalog (all optional, case-insensitive). */
export interface CatalogFilter {
  /** Exact card type (serial | floppy | memory | panel | other). */
  type?: string;
  /** Exact maker (e.g. MITS, IMSAI). */
  maker?: string;
  /** A derived capability tag the card must have. */
  capability?: string;
  /** Free-text query over id/name/summary/maker/type. */
  q?: string;
}

/** The Catalog listing plus the facet options present across the full set,
 * so the UI can render type/maker/capability filters without a second call. */
export interface CatalogListing {
  cards: CardDefinitionDoc[];
  facets: {
    types: string[];
    makers: string[];
    capabilities: string[];
  };
}

const SEMVER = /^\d+\.\d+\.\d+$/;

/**
 * Derive capability tags from a card manifest (synchronous, manifest-only — no
 * bundle/claims/sim dependency, so the REST/jest path stays fast). Tags are the
 * browse facet the UX calls for (has-rom, interrupt-capable, memory-mapped),
 * plus a type-derived capability so the facet is meaningful for the seed set.
 */
export function deriveCapabilities(manifest: CardManifestInput): string[] {
  const caps = new Set<string>();
  const type = (manifest.type ?? '').toLowerCase();
  if (type === 'serial') caps.add('serial-io');
  else if (type === 'floppy') caps.add('disk-controller');
  else if (type === 'memory') {
    caps.add('memory-mapped');
    caps.add('has-rom');
  } else if (type === 'panel') caps.add('front-panel');

  const hay = `${manifest.name ?? ''} ${manifest.summary ?? ''}`.toLowerCase();
  if (/\b(rom|prom|eprom)\b/.test(hay)) caps.add('has-rom');
  if (/\b(irq|interrupt)/.test(hay)) caps.add('interrupt-capable');
  if (/memory[- ]mapped|mmio/.test(hay)) caps.add('memory-mapped');
  return Array.from(caps).sort();
}

/** Stable key ordering for a basic canonical JSON (deep). */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = canonicalize((value as Record<string, unknown>)[k]);
        return acc;
      }, {});
  }
  return value;
}

function digestOf(manifest: CardManifestInput, entry?: string | null): string {
  const canonical = JSON.stringify(canonicalize({ manifest, entry: entry ?? null }));
  return 'sha256:' + createHash('sha256').update(canonical).digest('hex');
}

function toDoc(rec: CardDefinitionRecord): CardDefinitionDoc {
  const manifest = JSON.parse(rec.manifest) as CardManifestInput;
  return {
    id: rec.id,
    name: rec.name,
    version: rec.version,
    digest: rec.digest,
    type: rec.type,
    maker: rec.maker,
    summary: rec.summary,
    capabilities: deriveCapabilities(manifest),
    manifest,
    entry: rec.entry,
    source: rec.source,
    createdAt: rec.created_at,
  };
}

/** True if a card matches every provided filter facet (case-insensitive). */
function matchesFilter(doc: CardDefinitionDoc, f: CatalogFilter): boolean {
  if (f.type && doc.type.toLowerCase() !== f.type.toLowerCase()) return false;
  if (f.maker && (doc.maker ?? '').toLowerCase() !== f.maker.toLowerCase()) return false;
  if (f.capability && !doc.capabilities.some((c) => c.toLowerCase() === f.capability!.toLowerCase())) {
    return false;
  }
  if (f.q && f.q.trim()) {
    const q = f.q.trim().toLowerCase();
    const hay = `${doc.id} ${doc.name} ${doc.summary ?? ''} ${doc.maker ?? ''} ${doc.type}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

/** Register (or re-register, idempotently) a Card Definition into the Catalog. */
export async function registerCardDefinition(
  deps: Dependencies,
  input: RegisterCardInput,
): Promise<CardDefinitionDoc> {
  const m = input.manifest;
  if (!m || typeof m.name !== 'string' || m.name.trim() === '') {
    throw new ServiceError('Card manifest name is required', 400);
  }
  if (!SEMVER.test(m.version ?? '')) {
    throw new ServiceError(`Card version must be semver (x.y.z), got ${JSON.stringify(m.version)}`, 400);
  }
  if (typeof m.type !== 'string' || m.type.trim() === '') {
    throw new ServiceError('Card type is required', 400);
  }
  const id = `${m.name}@${m.version}`;
  const digest = digestOf(m, input.entry);
  await deps.database.upsertCardDefinition({
    id,
    name: m.name,
    version: m.version,
    digest,
    type: m.type,
    maker: m.maker ?? null,
    summary: m.summary ?? null,
    manifest: JSON.stringify(m),
    entry: input.entry ?? null,
    source: input.source ?? 'seed',
  });
  const rec = await deps.database.getCardDefinitionById(id);
  if (!rec) throw new ServiceError('Failed to register card definition', 500);
  return toDoc(rec);
}

/** List Card Definitions in the Catalog, optionally filtered (REST + MCP). */
export async function listCardDefinitions(
  deps: Dependencies,
  filter: CatalogFilter = {},
): Promise<CardDefinitionDoc[]> {
  const rows = await deps.database.listCardDefinitions();
  return rows.map(toDoc).filter((doc) => matchesFilter(doc, filter));
}

/** Browse the Catalog: filtered cards + the facet options across the full set
 * (so the UI renders type/maker/capability filters from one call). */
export async function browseCatalog(
  deps: Dependencies,
  filter: CatalogFilter = {},
): Promise<CatalogListing> {
  const all = (await deps.database.listCardDefinitions()).map(toDoc);
  const uniqSorted = (xs: string[]) => Array.from(new Set(xs)).sort();
  return {
    cards: all.filter((doc) => matchesFilter(doc, filter)),
    facets: {
      types: uniqSorted(all.map((c) => c.type)),
      makers: uniqSorted(all.map((c) => c.maker).filter((m): m is string => !!m)),
      capabilities: uniqSorted(all.flatMap((c) => c.capabilities)),
    },
  };
}

/** Get one Card Definition by Identity (`name@version`). */
export async function getCardDefinition(deps: Dependencies, id: string): Promise<CardDefinitionDoc> {
  const rec = await deps.database.getCardDefinitionById(id);
  if (!rec) throw new ServiceError(`Card definition not found: ${id}`, 404);
  return toDoc(rec);
}
