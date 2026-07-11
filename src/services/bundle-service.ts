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
import { getProfile, ProfileContent } from './profile-service';

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
