/**
 * Machine Profile service (Bitsby8 Story 2.3) — a declarative machine as a
 * versioned Primitive: dual Identity (`name@version` + content `sha256`), with
 * immutable versions (an edit writes a NEW version; prior versions stay
 * resolvable, FR-10) and clone. Shared by REST + MCP (AR-9).
 *
 * ROM images in the memory layout are binary, so the API/DB representation
 * carries them as base64 (`image`); `toMachineProfile` rehydrates them to
 * Uint8Array for the Resolver / InstanceManager.
 */

import type { CpuKind, Clock } from '@joezilla/8sim';
import { Dependencies } from '../types';
import { ServiceError } from './service-error';
import { MachineProfileRecord } from '../database';
import { MachineProfile } from './resolver';
import { getPreset } from './presets';
import { resolveProfileCards } from './card-config';
import { primitiveDigest, memberFromBytes, MemberRef } from './content-address';

/** A memory region as stored/exchanged — ROM `image` is base64 (not Uint8Array). */
export interface ProfileMemoryRegion {
  id: string;
  base: number;
  size: number;
  kind: 'ram' | 'rom' | 'mmio';
  image?: string; // base64-encoded ROM contents
}

/** The content-addressed body of a Profile (everything the digest covers). */
export interface ProfileContent {
  cpuKind: CpuKind;
  clock: Clock;
  resetVector: number;
  memory: ProfileMemoryRegion[];
  cards: { id: string; ref: string; config?: Record<string, unknown> }[];
  consoleCardId?: string;
}

/** A Profile as returned to REST/MCP: Identity + content + provenance. */
export interface ProfileDoc extends ProfileContent {
  id: string;
  name: string;
  version: string;
  digest: string;
  notes: string | null;
  source: string;
  createdAt: string;
}

const SEMVER = /^\d+\.\d+\.\d+$/;
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9 _.-]{0,63}$/;

/**
 * Content-addressed digest (AD-8): the profile's declarative body is the
 * manifest metadata; each ROM/media image is a byte member (hashed over its raw
 * bytes, not the base64 string), so two profiles with the same layout + ROM
 * bytes get the same digest, and any content change changes it. The profile
 * NAME is deliberately excluded — a clone has identical content and therefore
 * the same digest under a different Identity (a filename is never Identity).
 */
function digestOf(content: ProfileContent): string {
  const members: MemberRef[] = [];
  const memory = content.memory.map((m) => {
    if (m.image) {
      const bytes = new Uint8Array(Buffer.from(m.image, 'base64'));
      members.push(memberFromBytes(`mem/${m.id}.bin`, bytes));
      return { id: m.id, base: m.base, size: m.size, kind: m.kind, image: `mem/${m.id}.bin` };
    }
    return { id: m.id, base: m.base, size: m.size, kind: m.kind };
  });
  return primitiveDigest({
    kind: 'profile',
    meta: {
      cpuKind: content.cpuKind,
      clock: content.clock as unknown as Record<string, unknown>,
      resetVector: content.resetVector,
      consoleCardId: content.consoleCardId,
      memory,
      cards: content.cards,
    },
    members,
  });
}

function contentOf(rec: MachineProfileRecord): ProfileContent {
  return JSON.parse(rec.profile) as ProfileContent;
}

function toDoc(rec: MachineProfileRecord): ProfileDoc {
  return {
    id: rec.id,
    name: rec.name,
    version: rec.version,
    digest: rec.digest,
    notes: rec.notes,
    source: rec.source,
    createdAt: rec.created_at,
    ...contentOf(rec),
  };
}

/** Rehydrate a stored Profile into a runnable MachineProfile (base64 → Uint8Array). */
export function toMachineProfile(content: ProfileContent): MachineProfile {
  return {
    cpuKind: content.cpuKind,
    clock: content.clock,
    resetVector: content.resetVector,
    consoleCardId: content.consoleCardId,
    memory: content.memory.map((m) => ({
      id: m.id,
      base: m.base,
      size: m.size,
      kind: m.kind,
      ...(m.image ? { image: new Uint8Array(Buffer.from(m.image, 'base64')) } : {}),
    })),
    cards: content.cards.map((c) => ({ id: c.id, ref: c.ref, config: c.config })),
  };
}

/** Project a runnable MachineProfile (Uint8Array images) into stored content (base64). */
export function fromMachineProfile(mp: MachineProfile): ProfileContent {
  return {
    cpuKind: mp.cpuKind,
    clock: mp.clock,
    resetVector: mp.resetVector,
    consoleCardId: mp.consoleCardId,
    memory: mp.memory.map((m) => ({
      id: m.id,
      base: m.base,
      size: m.size,
      kind: m.kind,
      ...(m.image ? { image: Buffer.from(m.image).toString('base64') } : {}),
    })),
    cards: mp.cards.map((c) => ({ id: c.id, ref: c.ref, config: c.config })),
  };
}

function validateName(name: string): void {
  if (typeof name !== 'string' || !NAME_RE.test(name.trim())) {
    throw new ServiceError(
      'Profile name must be 1–64 chars of letters, digits, space, ., _ or -',
      400,
    );
  }
}

function validateContent(c: ProfileContent): void {
  if (c.cpuKind !== 'i8080' && c.cpuKind !== 'z80') {
    throw new ServiceError(`cpuKind must be i8080 or z80, got ${JSON.stringify(c.cpuKind)}`, 400);
  }
  if (!Array.isArray(c.memory) || !Array.isArray(c.cards)) {
    throw new ServiceError('Profile memory and cards must be arrays', 400);
  }
}

/** Next patch version for a name (max existing +1 on patch, else 1.0.0). */
async function nextVersion(deps: Dependencies, name: string): Promise<string> {
  const versions = (await deps.database.listMachineProfileVersions(name))
    .map((r) => r.version)
    .filter((v) => SEMVER.test(v));
  if (versions.length === 0) return '1.0.0';
  versions.sort((a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
    return 0;
  });
  const [maj, min, pat] = versions[versions.length - 1].split('.').map(Number);
  return `${maj}.${min}.${pat + 1}`;
}

async function persist(
  deps: Dependencies,
  name: string,
  version: string,
  content: ProfileContent,
  source: string,
  notes: string | null,
): Promise<ProfileDoc> {
  validateContent(content);
  const id = `${name}@${version}`;
  await deps.database.insertMachineProfile({
    id,
    name,
    version,
    digest: digestOf(content),
    cpu_kind: content.cpuKind,
    profile: JSON.stringify(content),
    notes,
    source,
  });
  const rec = await deps.database.getMachineProfileById(id);
  if (!rec) throw new ServiceError('Failed to persist profile', 500);
  return toDoc(rec);
}

/** Create a Profile from an explicit content body (version 1.0.0). */
export async function createProfile(
  deps: Dependencies,
  input: { name: string; notes?: string } & ProfileContent,
): Promise<ProfileDoc> {
  validateName(input.name);
  const name = input.name.trim();
  if ((await deps.database.listMachineProfileVersions(name)).length > 0) {
    throw new ServiceError(`A profile named "${name}" already exists`, 409);
  }
  const { name: _n, notes, ...rest } = input;
  const content = rest as ProfileContent;
  // Validate + fill defaults for each Card Instance against its Config Schema.
  content.cards = await resolveProfileCards(deps, content.cards ?? []);
  return persist(deps, name, '1.0.0', content, 'user', notes ?? null);
}

/** Create a Profile seeded from a built-in machine preset (carries ROM + cards). */
export async function createProfileFromPreset(
  deps: Dependencies,
  presetId: string,
  name: string,
  notes?: string,
): Promise<ProfileDoc> {
  validateName(name);
  const preset = getPreset(presetId);
  if (!preset) throw new ServiceError(`Unknown machine preset: ${presetId}`, 404);
  const trimmed = name.trim();
  if ((await deps.database.listMachineProfileVersions(trimmed)).length > 0) {
    throw new ServiceError(`A profile named "${trimmed}" already exists`, 409);
  }
  const content = fromMachineProfile(preset.build());
  // Resolve + fill card configs against the Catalog, exactly as createProfile
  // does — so a preset-derived profile is byte-identical (and content-addresses
  // the same) as the same machine created or imported any other way.
  content.cards = await resolveProfileCards(deps, content.cards);
  return persist(deps, trimmed, '1.0.0', content, 'preset', notes ?? null);
}

export async function getProfile(deps: Dependencies, id: string): Promise<ProfileDoc> {
  const rec = await deps.database.getMachineProfileById(id);
  if (!rec) throw new ServiceError(`Machine profile not found: ${id}`, 404);
  return toDoc(rec);
}

/** List the latest version of each named Profile. */
export async function listProfiles(deps: Dependencies): Promise<ProfileDoc[]> {
  const all = await deps.database.listMachineProfiles(); // ordered name, created_at DESC
  const latest = new Map<string, MachineProfileRecord>();
  for (const rec of all) if (!latest.has(rec.name)) latest.set(rec.name, rec);
  return Array.from(latest.values()).map(toDoc);
}

export async function listProfileVersions(deps: Dependencies, name: string): Promise<ProfileDoc[]> {
  const recs = await deps.database.listMachineProfileVersions(name);
  if (recs.length === 0) throw new ServiceError(`No profile named "${name}"`, 404);
  return recs.map(toDoc);
}

/**
 * Save a change: writes a NEW immutable version under the same name with a new
 * digest; prior versions remain resolvable (FR-10). A no-op change (identical
 * content + notes) returns the existing version unchanged.
 */
export async function updateProfile(
  deps: Dependencies,
  id: string,
  patch: Partial<ProfileContent> & { notes?: string },
): Promise<ProfileDoc> {
  const base = await getProfile(deps, id);
  const { notes: patchNotes, ...contentPatch } = patch;
  // A cards patch is re-validated against each card's Config Schema; unchanged
  // cards carry over already-validated.
  const cards = contentPatch.cards
    ? await resolveProfileCards(deps, contentPatch.cards)
    : base.cards;
  const newContent: ProfileContent = {
    cpuKind: contentPatch.cpuKind ?? base.cpuKind,
    clock: contentPatch.clock ?? base.clock,
    resetVector: contentPatch.resetVector ?? base.resetVector,
    memory: contentPatch.memory ?? base.memory,
    cards,
    consoleCardId: 'consoleCardId' in contentPatch ? contentPatch.consoleCardId : base.consoleCardId,
  };
  const newNotes = patchNotes !== undefined ? patchNotes : base.notes;
  if (digestOf(newContent) === base.digest && newNotes === base.notes) {
    return base; // nothing changed → no new version
  }
  return persist(deps, base.name, await nextVersion(deps, base.name), newContent, 'user', newNotes ?? null);
}

/** Clone a Profile into an independent one under a new name (version 1.0.0). */
export async function cloneProfile(
  deps: Dependencies,
  id: string,
  newName: string,
  notes?: string,
): Promise<ProfileDoc> {
  validateName(newName);
  const src = await getProfile(deps, id);
  const trimmed = newName.trim();
  if ((await deps.database.listMachineProfileVersions(trimmed)).length > 0) {
    throw new ServiceError(`A profile named "${trimmed}" already exists`, 409);
  }
  const { id: _i, name: _n, version: _v, digest: _d, createdAt: _c, source: _s, notes: _no, ...content } = src;
  return persist(deps, trimmed, '1.0.0', content as ProfileContent, 'user', notes ?? null);
}

/**
 * Rename a Profile in place: re-key every version from `oldName@*` to
 * `newName@*`, preserving full version history, notes and provenance. The
 * content digest deliberately excludes the name (AD-8), so nothing about the
 * content changes — this is a pure Identity re-key, plus migration of the
 * name-keyed startup disks and any `name@version` references. Refuses (409) if
 * a profile already exists under the target name.
 */
export async function renameProfile(
  deps: Dependencies,
  id: string,
  newName: string,
): Promise<ProfileDoc> {
  validateName(newName);
  const src = await getProfile(deps, id); // 404 if the source version isn't found
  const trimmed = newName.trim();
  if (trimmed === src.name) return src; // no-op rename
  if ((await deps.database.listMachineProfileVersions(trimmed)).length > 0) {
    throw new ServiceError(`A profile named "${trimmed}" already exists`, 409);
  }
  await deps.database.renameMachineProfile(src.name, trimmed);
  return getProfile(deps, `${trimmed}@${src.version}`);
}

/** Delete one version, or (default) every version of the name. */
export async function deleteProfile(
  deps: Dependencies,
  id: string,
  scope: 'version' | 'all' = 'all',
): Promise<void> {
  const rec = await deps.database.getMachineProfileById(id);
  if (!rec) return;
  if (scope === 'all') {
    await deps.database.deleteMachineProfilesByName(rec.name);
    // Startup disks are keyed by name (shared across versions) — drop them only
    // when the whole lineage goes, not for a single-version delete.
    await deps.database.deleteProfileDisksForProfile(rec.name);
  } else {
    await deps.database.deleteMachineProfile(id);
  }
}

/** Resolve a stored Profile reference (`name@version`, or a bare name → latest)
 * into a runnable MachineProfile. */
export async function resolveProfileRef(
  deps: Dependencies,
  ref: string,
): Promise<{ profile: MachineProfile; doc: ProfileDoc }> {
  let rec = await deps.database.getMachineProfileById(ref);
  if (!rec) {
    const versions = await deps.database.listMachineProfileVersions(ref);
    rec = versions[0]; // latest by created_at
  }
  if (!rec) throw new ServiceError(`Machine profile not found: ${ref}`, 404);
  const doc = toDoc(rec);
  return { profile: toMachineProfile(doc), doc };
}
