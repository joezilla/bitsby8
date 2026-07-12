/**
 * EPROM burning (Bitsby8 Story 5.2): load a `.bin`/Intel HEX image into an EPROM
 * card instance of a Machine Profile. The burned bytes are stored as a profile
 * memory region whose id matches the card's emitted region (`<cardId>/rom`), so
 * they're content-addressed as byte members and rehydrated exactly like any ROM;
 * the resolver treats that declared region as an override of the card's default
 * zero-filled emit. Erasing removes the override, restoring the empty EPROM.
 */

import { Dependencies } from '../types';
import { ServiceError } from './service-error';
import { getSim, getSeedBundle } from './bundle-registry';
import { getProfile, updateProfile, ProfileDoc, ProfileMemoryRegion } from './profile-service';
import {
  burnImage,
  burnSummary,
  detectFormat,
  RomImageError,
  Addressing,
  ImageFormat,
  BurnResult,
} from './rom-image';

export interface BurnInput {
  bytes: Uint8Array;
  addressing: Addressing;
  /** Override format detection (else sniffed from bytes/filename). */
  format?: ImageFormat;
  filename?: string;
}

export interface BurnOutcome {
  profile: ProfileDoc;
  summary: string;
  region: { id: string; base: number; size: number };
  bytesWritten: number;
  lowAddr: number;
  highAddr: number;
  format: ImageFormat;
  addressing: Addressing;
}

/** Resolve an EPROM card instance to its ROM region geometry (base/size/id). */
async function romRegionOf(
  profile: ProfileDoc,
  cardId: string,
): Promise<{ nsId: string; base: number; size: number }> {
  const inst = profile.cards.find((c) => c.id === cardId);
  if (!inst) {
    throw new ServiceError(`No card instance "${cardId}" in profile "${profile.name}"`, 404, { cardId });
  }
  const bundle = await getSeedBundle(inst.ref);
  if (!bundle || !bundle.memory) {
    throw new ServiceError(`Card "${cardId}" (${inst.ref}) is not a memory card`, 409, { cardId, ref: inst.ref });
  }
  const sim = await getSim();
  const cfg = sim.withDefaults(bundle.manifest, inst.config ?? {});
  const rom = bundle.memory(cfg).find((r) => r.kind === 'rom');
  if (!rom) {
    throw new ServiceError(`Card "${cardId}" (${inst.ref}) has no ROM region to burn`, 409, { cardId, ref: inst.ref });
  }
  return { nsId: `${cardId}/${rom.id}`, base: rom.base, size: rom.size };
}

/** Burn an image into an EPROM card instance; returns the new profile version. */
export async function burnEprom(
  deps: Dependencies,
  profileId: string,
  cardId: string,
  input: BurnInput,
): Promise<BurnOutcome> {
  const profile = await getProfile(deps, profileId);
  const { nsId, base, size } = await romRegionOf(profile, cardId);

  const format = input.format ?? detectFormat(input.bytes, input.filename);
  let result: BurnResult;
  try {
    result = burnImage({ bytes: input.bytes, format, addressing: input.addressing, region: { base, size } });
  } catch (err) {
    if (err instanceof RomImageError) {
      throw new ServiceError(err.message, 422, { cardId, region: { base, size } });
    }
    throw err;
  }

  const burned: ProfileMemoryRegion = {
    id: nsId,
    base,
    size,
    kind: 'rom',
    image: Buffer.from(result.image).toString('base64'),
  };
  const memory = upsertRegion(profile.memory, burned);
  const updated = await updateProfile(deps, profileId, { memory });

  return {
    profile: updated,
    summary: burnSummary(result),
    region: { id: nsId, base, size },
    bytesWritten: result.bytesWritten,
    lowAddr: result.lowAddr,
    highAddr: result.highAddr,
    format: result.format,
    addressing: result.addressing,
  };
}

/** Erase a burned EPROM: drop the override region so the card reverts to empty. */
export async function eraseEprom(
  deps: Dependencies,
  profileId: string,
  cardId: string,
): Promise<{ profile: ProfileDoc; erased: boolean }> {
  const profile = await getProfile(deps, profileId);
  const { nsId } = await romRegionOf(profile, cardId);
  if (!profile.memory.some((m) => m.id === nsId)) {
    return { profile, erased: false }; // nothing burned
  }
  const memory = profile.memory.filter((m) => m.id !== nsId);
  const updated = await updateProfile(deps, profileId, { memory });
  return { profile: updated, erased: true };
}

/** Replace or append the region with a matching id (content stays in slot order). */
function upsertRegion(memory: ProfileMemoryRegion[], region: ProfileMemoryRegion): ProfileMemoryRegion[] {
  const idx = memory.findIndex((m) => m.id === region.id);
  if (idx === -1) return [...memory, region];
  const next = [...memory];
  next[idx] = region;
  return next;
}
