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
import { createProfile, createProfileFromPreset } from '../src/services/profile-service';
import { exportProfile, bundleFilename } from '../src/services/bundle-service';

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
  return deps;
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
