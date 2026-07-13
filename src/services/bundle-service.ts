/**
 * Primitive export/import (Bitsby8 Epic 4, FR-23/FR-24). A Bitsby8 bundle is a
 * self-describing document that moves a Machine Profile (and its referenced
 * cards/ROMs) between installs.
 *
 * Story 4.2 (export): a Profile bundle is fully self-contained for its ROM/media
 * (inline as base64 in the profile) and pins each referenced Card Definition by
 * Identity (`ref` + content `digest`) — the card's behavior lives in the 8sim
 * package and is resolved on the target install by ref, not shipped here. The
 * bundle carries NO host-specific serial device paths (FR-29): a Profile is
 * target-agnostic — its card config uses logical I/O ports, never device nodes.
 */

import { Dependencies } from '../types';
import { ServiceError } from './service-error';
import { getProfile, createProfile, listProfiles, ProfileContent, ProfileDoc } from './profile-service';

/** A pinned reference to a Card Definition the profile uses. */
export interface BundleCardRef {
  ref: string; // name@version
  name: string;
  version: string;
  digest: string | null; // pinned content Identity (null if not in this catalog)
  inCatalog: boolean;
}

/** A self-describing Bitsby8 export bundle (deterministic given the profile). */
export interface Bitsby8Bundle {
  bitsby8Bundle: '1';
  kind: 'machine-profile';
  /** The exported Primitive's Identity (content-addressed, AD-8). */
  identity: { name: string; version: string; digest: string };
  /** The full Machine Profile body — ROM/media inline as base64 (self-contained). */
  profile: ProfileContent;
  /** Referenced Card Definitions, pinned by Identity. */
  cards: BundleCardRef[];
}

/** Export a stored Machine Profile to a self-describing bundle. */
export async function exportProfile(deps: Dependencies, id: string): Promise<Bitsby8Bundle> {
  const doc = await getProfile(deps, id); // 404 if unknown

  const cards: BundleCardRef[] = [];
  for (const c of doc.cards) {
    const rec = await deps.database.getCardDefinitionById(c.ref);
    const [name, version] = c.ref.split('@');
    cards.push({
      ref: c.ref,
      name: rec?.name ?? name,
      version: rec?.version ?? version ?? '',
      digest: rec?.digest ?? null,
      inCatalog: !!rec,
    });
  }

  // Strip Identity/label fields from the doc — what remains is the ProfileContent.
  const { id: _id, name, version, digest, notes: _n, source: _s, createdAt: _c, ...content } = doc;
  return {
    bitsby8Bundle: '1',
    kind: 'machine-profile',
    identity: { name, version, digest },
    profile: content as ProfileContent,
    cards,
  };
}

/** A stable, filesystem-safe filename for a profile bundle. */
export function bundleFilename(bundle: Bitsby8Bundle): string {
  const safe = `${bundle.identity.name}-${bundle.identity.version}`.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${safe}.b8.json`;
}

export interface ImportedCardStatus {
  ref: string;
  present: boolean; // the referenced card exists in this Catalog
  digestMatch: boolean; // and resolves to the same content Identity as pinned
}

export interface ImportResult {
  profile: ProfileDoc;
  cards: ImportedCardStatus[];
  warnings: string[];
}

/** Validate an untrusted value is a machine-profile bundle. */
function assertBundle(value: unknown): asserts value is Bitsby8Bundle {
  const b = value as Partial<Bitsby8Bundle> | null;
  if (!b || typeof b !== 'object') throw new ServiceError('Not a Bitsby8 bundle', 400);
  if (b.bitsby8Bundle !== '1') throw new ServiceError(`Unsupported bundle format: ${String(b.bitsby8Bundle)}`, 400);
  if (b.kind !== 'machine-profile') throw new ServiceError(`Unsupported bundle kind: ${String(b.kind)}`, 400);
  if (!b.identity || typeof b.identity.name !== 'string' || typeof b.identity.digest !== 'string') {
    throw new ServiceError('Bundle is missing a valid identity', 400);
  }
  if (!b.profile || typeof b.profile !== 'object' || !Array.isArray(b.profile.cards)) {
    throw new ServiceError('Bundle is missing a valid profile body', 400);
  }
  if (!Array.isArray(b.cards)) throw new ServiceError('Bundle is missing its card references', 400);
}

/**
 * Import a bundle into the Catalog (FR-24). Registers the Machine Profile
 * resolvable by Identity; verifies every referenced card is present (else the
 * machine can't boot); and REPORTS — never silently overwrites — a bundle whose
 * Identity already exists (by content digest, or by a taken name).
 */
export async function importBundle(
  deps: Dependencies,
  raw: unknown,
  opts: { name?: string } = {},
): Promise<ImportResult> {
  assertBundle(raw);
  const bundle = raw;
  const name = (opts.name?.trim() || bundle.identity.name).trim();

  // Report an existing Identity (content digest) — this exact machine is already here.
  const existing = (await listProfiles(deps)).find((p) => p.digest === bundle.identity.digest);
  if (existing) {
    throw new ServiceError(
      `This machine is already imported as "${existing.id}" (identical content Identity)`,
      409,
      { existing: existing.id },
    );
  }
  // Report a taken name — no silent overwrite.
  if ((await deps.database.listMachineProfileVersions(name)).length > 0) {
    throw new ServiceError(`A profile named "${name}" already exists — import under a different name`, 409);
  }

  // Every referenced card must resolve on this install (its behavior lives in
  // the 8sim package, referenced by Identity — not shipped in the bundle).
  const cards: ImportedCardStatus[] = [];
  for (const c of bundle.cards) {
    const rec = await deps.database.getCardDefinitionById(c.ref);
    cards.push({ ref: c.ref, present: !!rec, digestMatch: !!rec && rec.digest === c.digest });
  }
  const missing = cards.filter((c) => !c.present).map((c) => c.ref);
  if (missing.length) {
    throw new ServiceError(
      `Referenced card(s) not in this Catalog: ${missing.join(', ')} — install the matching 8sim seed cards`,
      422,
      { missing },
    );
  }

  const profile = await createProfile(deps, { name, ...bundle.profile });

  // The re-computed content digest should match the pinned Identity (AD-8 is
  // install-independent); a mismatch means the resolved cards/ROM differ.
  const warnings: string[] = [];
  if (profile.digest !== bundle.identity.digest) {
    warnings.push('imported content digest differs from the bundle Identity (resolved artifacts differ)');
  }
  for (const c of cards.filter((x) => !x.digestMatch)) {
    warnings.push(`card ${c.ref} resolves to a different build than the bundle pinned`);
  }

  return { profile, cards, warnings };
}
