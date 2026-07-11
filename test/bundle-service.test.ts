/**
 * Tests for Primitive export (Bitsby8 Story 4.2, FR-23/FR-29): a self-describing
 * bundle with the Profile + content Identity + referenced cards pinned by
 * Identity, deterministic, and free of host device paths.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Database } from '../src/database';
import { Dependencies } from '../src/types';
import { registerCardDefinition } from '../src/services/catalog';
import { createProfile, createProfileFromPreset, getProfile } from '../src/services/profile-service';
import { exportProfile, bundleFilename, importBundle } from '../src/services/bundle-service';

async function makeDeps(): Promise<Dependencies> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-bundle-'));
  const db = new Database(path.join(dir, 'test.db'));
  await db.initialize();
  const deps = { database: db } as unknown as Dependencies;
  await registerCardDefinition(deps, {
    manifest: {
      name: 'mits-88-2sio',
      version: '1.0.0',
      type: 'serial',
      configSchema: { basePort: { type: 'u8', default: 0x10, min: 0, max: 0xfc } },
    },
    source: 'seed',
  });
  // Preset cards (imsai-cpm), so createProfileFromPreset resolves + fills them.
  await registerCardDefinition(deps, {
    manifest: {
      name: 'imsai-sio2',
      version: '1.0.0',
      type: 'serial',
      configSchema: {
        basePortA: { type: 'u8', default: 0x02, min: 0, max: 0xfe },
        basePortB: { type: 'u8', default: 0x04, min: 0, max: 0xfe },
        boardCtrlPort: { type: 'u8', default: 0x08, min: 0, max: 0xff },
      },
    },
    source: 'seed',
  });
  await registerCardDefinition(deps, {
    manifest: {
      name: 'mits-88-dcdd',
      version: '1.0.0',
      type: 'floppy',
      configSchema: { basePort: { type: 'u8', default: 0x08, min: 0, max: 0xfd } },
    },
    source: 'seed',
  });
  return deps;
}

/** A fresh install with NO cards registered. */
async function makeBareDeps(): Promise<Dependencies> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-bare-'));
  const db = new Database(path.join(dir, 'test.db'));
  await db.initialize();
  return { database: db } as unknown as Dependencies;
}

const content = {
  cpuKind: 'i8080' as const,
  clock: 'max' as const,
  resetVector: 0,
  memory: [{ id: 'ram', base: 0, size: 0x10000, kind: 'ram' as const }],
  cards: [{ id: 'sio', ref: 'mits-88-2sio@1.0.0' }],
};

describe('exportProfile', () => {
  test('produces a self-describing bundle: Identity, profile body, pinned cards', async () => {
    const deps = await makeDeps();
    const p = await createProfile(deps, { name: 'exportable', ...content });
    const bundle = await exportProfile(deps, p.id);

    expect(bundle.bitsby8Bundle).toBe('1');
    expect(bundle.kind).toBe('machine-profile');
    expect(bundle.identity).toEqual({ name: 'exportable', version: '1.0.0', digest: p.digest });
    expect(bundle.profile.cpuKind).toBe('i8080');
    // Cards are pinned by Identity (ref + content digest).
    expect(bundle.cards).toHaveLength(1);
    expect(bundle.cards[0]).toMatchObject({ ref: 'mits-88-2sio@1.0.0', inCatalog: true });
    expect(bundle.cards[0].digest).toMatch(/^sha256:/);
    // No profile Identity/label fields leak into the profile body.
    expect((bundle.profile as unknown as Record<string, unknown>).name).toBeUndefined();
    expect((bundle.profile as unknown as Record<string, unknown>).digest).toBeUndefined();
  });

  test('bundles a preset ROM inline (self-contained) and is deterministic', async () => {
    const deps = await makeDeps();
    const p = await createProfileFromPreset(deps, 'imsai-cpm', 'boxed');
    const b1 = await exportProfile(deps, p.id);
    const b2 = await exportProfile(deps, p.id);
    // ROM travels inline (base64) — the bundle is self-contained for media.
    const rom = b1.profile.memory.find((m) => m.kind === 'rom');
    expect(typeof rom?.image).toBe('string');
    // Deterministic: exporting the same profile twice yields identical bytes.
    expect(JSON.stringify(b1)).toBe(JSON.stringify(b2));
  });

  test('carries no host-specific device paths (FR-29)', async () => {
    const deps = await makeDeps();
    const p = await createProfile(deps, { name: 'clean', ...content });
    const bundle = await exportProfile(deps, p.id);
    const text = JSON.stringify(bundle);
    expect(text).not.toMatch(/\/dev\/tty|COM\d|\/dev\/cu\./);
  });

  test('bundleFilename is filesystem-safe', () => {
    expect(
      bundleFilename({
        bitsby8Bundle: '1',
        kind: 'machine-profile',
        identity: { name: 'My Machine!', version: '1.0.0', digest: 'sha256:x' },
        profile: {} as never,
        cards: [],
      }),
    ).toBe('My_Machine_-1.0.0.b8.json');
  });
});

describe('importBundle (round-trip)', () => {
  test('export → import re-registers the profile with the SAME content digest', async () => {
    const src = await makeDeps();
    const p = await createProfile(src, { name: 'shared', ...content });
    const bundle = await exportProfile(src, p.id);

    // Import on a fresh install that has the same seed card.
    const target = await makeDeps();
    const res = await importBundle(target, bundle);
    expect(res.profile.name).toBe('shared');
    // AD-8 is install-independent: the imported content digest matches the pinned Identity.
    expect(res.profile.digest).toBe(bundle.identity.digest);
    expect(res.warnings).toEqual([]);
    expect((await getProfile(target, res.profile.id)).digest).toBe(bundle.identity.digest);
  });

  test('an already-present Identity is reported (no silent overwrite)', async () => {
    const deps = await makeDeps();
    const p = await createProfile(deps, { name: 'once', ...content });
    const bundle = await exportProfile(deps, p.id);
    // Same content already here → reported by digest, even under a different name.
    await expect(importBundle(deps, bundle)).rejects.toMatchObject({ statusCode: 409 });
    await expect(importBundle(deps, bundle, { name: 'twice' })).rejects.toMatchObject({ statusCode: 409 });
  });

  test('a taken name (different content) is reported', async () => {
    const deps = await makeDeps();
    await createProfile(deps, { name: 'taken', ...content });
    // A different-content bundle that wants the same name.
    const other = await makeDeps();
    const p = await createProfile(other, { name: 'taken', ...content, resetVector: 0xff00 });
    const bundle = await exportProfile(other, p.id);
    await expect(importBundle(deps, bundle)).rejects.toMatchObject({ statusCode: 409 });
  });

  test('a referenced card missing on the target is reported (422)', async () => {
    const src = await makeDeps();
    const p = await createProfile(src, { name: 'needs-sio', ...content });
    const bundle = await exportProfile(src, p.id);
    await expect(importBundle(await makeBareDeps(), bundle)).rejects.toMatchObject({ statusCode: 422 });
  });

  test('rejects a non-bundle (400)', async () => {
    const deps = await makeDeps();
    await expect(importBundle(deps, { hello: 'world' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(importBundle(deps, null)).rejects.toMatchObject({ statusCode: 400 });
  });
});
