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
  manifest: CardManifestInput;
  entry: string | null;
  source: string;
  createdAt: string;
}

const SEMVER = /^\d+\.\d+\.\d+$/;

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
  return {
    id: rec.id,
    name: rec.name,
    version: rec.version,
    digest: rec.digest,
    type: rec.type,
    maker: rec.maker,
    summary: rec.summary,
    manifest: JSON.parse(rec.manifest) as CardManifestInput,
    entry: rec.entry,
    source: rec.source,
    createdAt: rec.created_at,
  };
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

/** List all Card Definitions in the Catalog. */
export async function listCardDefinitions(deps: Dependencies): Promise<CardDefinitionDoc[]> {
  const rows = await deps.database.listCardDefinitions();
  return rows.map(toDoc);
}

/** Get one Card Definition by Identity (`name@version`). */
export async function getCardDefinition(deps: Dependencies, id: string): Promise<CardDefinitionDoc> {
  const rec = await deps.database.getCardDefinitionById(id);
  if (!rec) throw new ServiceError(`Card definition not found: ${id}`, 404);
  return toDoc(rec);
}
