/**
 * Tests for the Machine Profile service (Bitsby8 Story 2.3): dual Identity +
 * sha256, immutable versioning (an edit writes a new version; prior versions
 * stay resolvable, FR-10), clone independence, preset seeding (ROM round-trip),
 * and profileRef resolution.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Database } from '../src/database';
import { Dependencies } from '../src/types';
import { registerCardDefinition } from '../src/services/catalog';
import {
  createProfile,
  createProfileFromPreset,
  getProfile,
  listProfiles,
  listProfileVersions,
  updateProfile,
  cloneProfile,
  deleteProfile,
  resolveProfileRef,
  toMachineProfile,
  ProfileContent,
} from '../src/services/profile-service';

async function makeDeps(): Promise<Dependencies> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-prof-'));
  const db = new Database(path.join(dir, 'test.db'));
  await db.initialize();
  const deps = { database: db } as unknown as Dependencies;
  // Card Instances are validated against the Catalog on save, so seed the card
  // the sample profile references.
  await registerCardDefinition(deps, {
    manifest: {
      name: 'mits-88-2sio',
      version: '1.0.0',
      type: 'serial',
      maker: 'MITS',
      configSchema: { basePort: { type: 'u8', default: 0x10, min: 0, max: 0xfc } },
    },
    source: 'seed',
  });
  return deps;
}

const content: ProfileContent = {
  cpuKind: 'i8080',
  clock: 'max',
  resetVector: 0,
  memory: [{ id: 'ram', base: 0, size: 0x10000, kind: 'ram' }],
  cards: [{ id: 'sio', ref: 'mits-88-2sio@1.0.0' }],
};

describe('profile-service: create + identity', () => {
  test('createProfile persists at 1.0.0 with a dual Identity and is retrievable', async () => {
    const deps = await makeDeps();
    const doc = await createProfile(deps, { name: 'my-altair', ...content });
    expect(doc.id).toBe('my-altair@1.0.0');
    expect(doc.version).toBe('1.0.0');
    expect(doc.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(doc.source).toBe('user');
    expect((await getProfile(deps, 'my-altair@1.0.0')).cpuKind).toBe('i8080');
  });

  test('a duplicate name is rejected (409)', async () => {
    const deps = await makeDeps();
    await createProfile(deps, { name: 'dup', ...content });
    await expect(createProfile(deps, { name: 'dup', ...content })).rejects.toMatchObject({ statusCode: 409 });
  });

  test('an invalid name is rejected (400)', async () => {
    const deps = await makeDeps();
    await expect(createProfile(deps, { name: '', ...content })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('createProfileFromPreset carries the ROM (base64) + cards and round-trips to Uint8Array', async () => {
    const deps = await makeDeps();
    const doc = await createProfileFromPreset(deps, 'imsai-cpm', 'boxed-imsai');
    expect(doc.source).toBe('preset');
    const rom = doc.memory.find((m) => m.kind === 'rom');
    expect(typeof rom?.image).toBe('string'); // base64 in the stored/API form
    expect(doc.cards.map((c) => c.id)).toEqual(['sio', 'dcdd']);

    // Rehydrated for running: base64 → Uint8Array (256-byte CDBL).
    const mp = toMachineProfile(doc);
    const mprom = mp.memory.find((m) => m.kind === 'rom');
    expect(mprom?.image).toBeInstanceOf(Uint8Array);
    expect(mprom?.image?.length).toBe(256);

    await expect(createProfileFromPreset(deps, 'nope', 'x')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('profile-service: versioning (FR-10)', () => {
  test('updateProfile writes a NEW version with a new digest; prior versions stay resolvable', async () => {
    const deps = await makeDeps();
    const v1 = await createProfile(deps, { name: 'evolving', ...content });
    const v2 = await updateProfile(deps, v1.id, { resetVector: 0xff00 });

    expect(v2.version).toBe('1.0.1');
    expect(v2.digest).not.toBe(v1.digest);
    expect(v2.resetVector).toBe(0xff00);

    // Prior version still resolvable and unchanged.
    const stillV1 = await getProfile(deps, 'evolving@1.0.0');
    expect(stillV1.resetVector).toBe(0);
    expect(stillV1.digest).toBe(v1.digest);

    // listProfiles returns only the latest per name.
    const latest = await listProfiles(deps);
    expect(latest.filter((p) => p.name === 'evolving')).toHaveLength(1);
    expect(latest.find((p) => p.name === 'evolving')!.version).toBe('1.0.1');

    // All versions listed newest-first.
    const versions = await listProfileVersions(deps, 'evolving');
    expect(versions.map((v) => v.version)).toEqual(['1.0.1', '1.0.0']);
  });

  test('a no-op change does not create a new version', async () => {
    const deps = await makeDeps();
    const v1 = await createProfile(deps, { name: 'static', ...content });
    const same = await updateProfile(deps, v1.id, { resetVector: 0 });
    expect(same.version).toBe('1.0.0');
    expect(await listProfileVersions(deps, 'static')).toHaveLength(1);
  });
});

describe('profile-service: clone', () => {
  test('clone produces an independent profile that can diverge without affecting the source', async () => {
    const deps = await makeDeps();
    const src = await createProfile(deps, { name: 'base', ...content });
    const clone = await cloneProfile(deps, src.id, 'derived');
    expect(clone.id).toBe('derived@1.0.0');
    expect(clone.name).toBe('derived');
    // Content-addressing (AD-8): identical content under a different Identity
    // resolves to the SAME digest — a filename/name is never Identity.
    expect(clone.digest).toBe(src.digest);

    // Diverge the clone; the source is untouched.
    await updateProfile(deps, clone.id, { resetVector: 0x100 });
    expect((await getProfile(deps, 'base@1.0.0')).resetVector).toBe(0);
    expect((await listProfileVersions(deps, 'base'))).toHaveLength(1);

    // Cloning onto an existing name is rejected.
    await expect(cloneProfile(deps, src.id, 'derived')).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('profile-service: delete + resolveProfileRef', () => {
  test('resolveProfileRef resolves name@version and a bare name (→ latest)', async () => {
    const deps = await makeDeps();
    const v1 = await createProfile(deps, { name: 'runme', ...content });
    await updateProfile(deps, v1.id, { resetVector: 0xff00 });

    const exact = await resolveProfileRef(deps, 'runme@1.0.0');
    expect(exact.doc.version).toBe('1.0.0');
    const latest = await resolveProfileRef(deps, 'runme');
    expect(latest.doc.version).toBe('1.0.1');
    expect(latest.profile.resetVector).toBe(0xff00);

    await expect(resolveProfileRef(deps, 'ghost')).rejects.toMatchObject({ statusCode: 404 });
  });

  test('delete all removes every version; delete version removes just one', async () => {
    const deps = await makeDeps();
    const v1 = await createProfile(deps, { name: 'trash', ...content });
    const v2 = await updateProfile(deps, v1.id, { resetVector: 1 });

    await deleteProfile(deps, v2.id, 'version');
    expect((await listProfileVersions(deps, 'trash')).map((v) => v.version)).toEqual(['1.0.0']);

    await deleteProfile(deps, v1.id, 'all');
    await expect(getProfile(deps, 'trash@1.0.0')).rejects.toMatchObject({ statusCode: 404 });
  });
});
