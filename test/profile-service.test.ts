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
import { resolveProfile } from '../src/services/resolver';
import { getPreset } from '../src/services/presets';
import { validateProfile } from '../src/services/collision-validator';
import { _setSimForTests, SimModule } from '../src/services/bundle-registry';
import {
  createProfile,
  createProfileFromPreset,
  getProfile,
  listProfiles,
  listProfileVersions,
  updateProfile,
  cloneProfile,
  renameProfile,
  deleteProfile,
  resolveProfileRef,
  toMachineProfile,
  upsertPresetProfile,
  ProfileContent,
} from '../src/services/profile-service';

/** A fake sim with the seed cards the card-based presets install. */
function presetFakeSim(): SimModule {
  const noop = (id: string) => ({ id, reset() {}, attach() {} });
  return {
    seedBundles: [
      { manifest: { name: 'i8080-cpu', version: '1.0.0', type: 'cpu', configSchema: { resetVector: { type: 'u16', default: 0 } } },
        cardFactory: noop, claims: () => ({ ports: [] }), cpu: (c: Record<string, unknown>) => ({ kind: 'i8080', resetVector: Number(c.resetVector ?? 0) }) },
      { manifest: { name: 'ram-card', version: '1.0.0', type: 'memory', configSchema: { base: { type: 'u16', default: 0 }, size: { type: 'u16', default: 0x4000 } } },
        cardFactory: noop, claims: () => ({ ports: [] }), memory: (c: Record<string, unknown>) => [{ id: 'ram', base: Number(c.base), size: Number(c.size), kind: 'ram' }] },
      { manifest: { name: 'eprom-card', version: '1.0.0', type: 'memory', configSchema: { base: { type: 'u16', default: 0xf000 }, size: { type: 'u16', default: 0x800 } } },
        cardFactory: noop, claims: () => ({ ports: [] }), memory: (c: Record<string, unknown>) => [{ id: 'rom', base: Number(c.base), size: Number(c.size), kind: 'rom', image: new Uint8Array(Number(c.size)) }] },
      { manifest: { name: 'imsai-sio2', version: '1.0.0', type: 'serial', configSchema: { basePortA: { type: 'u8', default: 0x02 }, boardCtrlPort: { type: 'u8', default: 0x08 } } },
        cardFactory: noop, claims: (c: Record<string, unknown>) => ({ ports: [Number(c.basePortA), Number(c.basePortA) + 1] }) },
      { manifest: { name: 'mits-88-dcdd', version: '1.0.0', type: 'floppy', configSchema: { basePort: { type: 'u8', default: 0x08 } } },
        cardFactory: noop, claims: (c: Record<string, unknown>) => ({ ports: [Number(c.basePort ?? 0x08)] }) },
    ],
    withDefaults: (m: { configSchema: Record<string, { default: unknown }> }, c: Record<string, unknown> = {}) => {
      const out: Record<string, unknown> = {};
      for (const [k, s] of Object.entries(m.configSchema)) out[k] = k in c ? c[k] : s.default;
      return out;
    },
    buildMachine: (() => { throw new Error('not used'); }) as unknown as SimModule['buildMachine'],
  } as unknown as SimModule;
}

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
  // The imsai-cpm preset's cards — createProfileFromPreset now resolves them.
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
  // Card-based presets (Epic 5): CPU + RAM + EPROM cards.
  await registerCardDefinition(deps, {
    manifest: { name: 'i8080-cpu', version: '1.0.0', type: 'cpu', configSchema: { resetVector: { type: 'u16', default: 0, min: 0, max: 0xffff } } },
    source: 'seed',
  });
  await registerCardDefinition(deps, {
    manifest: { name: 'ram-card', version: '1.0.0', type: 'memory', configSchema: { base: { type: 'u16', default: 0, min: 0, max: 0xffff }, size: { type: 'u16', default: 0x4000, min: 1, max: 0xffff } } },
    source: 'seed',
  });
  await registerCardDefinition(deps, {
    manifest: { name: 'eprom-card', version: '1.0.0', type: 'memory', configSchema: { base: { type: 'u16', default: 0xf000, min: 0, max: 0xffff }, size: { type: 'u16', default: 0x800, min: 1, max: 0xffff } } },
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
    expect(doc.cards.map((c) => c.id)).toEqual(['cpu', 'ram', 'boot', 'sio', 'dcdd']);

    // Rehydrated for running: base64 → Uint8Array (256-byte CDBL).
    const mp = toMachineProfile(doc);
    const mprom = mp.memory.find((m) => m.kind === 'rom');
    expect(mprom?.image).toBeInstanceOf(Uint8Array);
    expect(mprom?.image?.length).toBe(256);

    await expect(createProfileFromPreset(deps, 'nope', 'x')).rejects.toMatchObject({ statusCode: 404 });
  });

  test('a card-based preset resolves to a bootable memory map (CDBL burned at reset, editable RAM below, no collision)', async () => {
    _setSimForTests(presetFakeSim());
    try {
      const deps = await makeDeps();
      const doc = await createProfileFromPreset(deps, 'imsai-cpm', 'boot-check');

      // No phantom collisions — RAM is a card, EPROM is a card, they don't overlap.
      expect((await validateProfile(deps, doc)).ok).toBe(true);

      const { spec } = await resolveProfile(deps, toMachineProfile(doc));
      expect(spec.cpuKind).toBe('i8080'); // from the CPU card
      expect(spec.resetVector).toBe(0xff00);

      // RAM card 0x0000–0xFEFF (editable via the card config).
      expect(spec.memory.find((m) => m.id === 'ram/ram')).toMatchObject({ base: 0, size: 0xff00, kind: 'ram' });

      // CDBL burned into the boot EPROM at the reset vector — the override supplies
      // real bytes (DI = 0xF3), not the card's zero emit, and exactly once.
      const rom = spec.memory.filter((m) => m.id === 'boot/rom');
      expect(rom).toHaveLength(1);
      expect(rom[0]).toMatchObject({ base: 0xff00, kind: 'rom' });
      expect(rom[0].image?.[0]).toBe(0xf3);
    } finally {
      _setSimForTests(null);
    }
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

describe('profile-service: rename', () => {
  test('rename re-keys every version in place, preserving history and digests', async () => {
    const deps = await makeDeps();
    const v1 = await createProfile(deps, { name: 'oldname', ...content });
    const v2 = await updateProfile(deps, v1.id, { resetVector: 0xff00 });
    expect(v2.version).toBe('1.0.1');

    const renamed = await renameProfile(deps, v2.id, 'newname');
    expect(renamed.id).toBe('newname@1.0.1');
    expect(renamed.name).toBe('newname');
    // Content is untouched by a rename — same digest as before.
    expect(renamed.digest).toBe(v2.digest);

    // Both versions carried over under the new name, newest-first, history intact.
    const versions = await listProfileVersions(deps, 'newname');
    expect(versions.map((v) => v.version)).toEqual(['1.0.1', '1.0.0']);
    expect((await getProfile(deps, 'newname@1.0.0')).digest).toBe(v1.digest);

    // Old name is gone; only the new one lists.
    await expect(listProfileVersions(deps, 'oldname')).rejects.toMatchObject({ statusCode: 404 });
    const latest = await listProfiles(deps);
    expect(latest.filter((p) => p.name === 'oldname')).toHaveLength(0);
    expect(latest.filter((p) => p.name === 'newname')).toHaveLength(1);
  });

  test('rename onto an existing name is rejected; a no-op rename is a pass-through', async () => {
    const deps = await makeDeps();
    const a = await createProfile(deps, { name: 'alpha', ...content });
    await createProfile(deps, { name: 'beta', ...content });
    await expect(renameProfile(deps, a.id, 'beta')).rejects.toMatchObject({ statusCode: 409 });
    // Renaming to its own name is a no-op that returns the source doc.
    expect((await renameProfile(deps, a.id, 'alpha')).id).toBe('alpha@1.0.0');
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

describe('presets as editable profiles (Story 5.2)', () => {
  test('a preset seeds as source:preset, edits in place (no version churn), and resets', async () => {
    const deps = await makeDeps();
    const p = await upsertPresetProfile(deps, 'Test Preset', toMachineProfile(content), 'a template');
    expect(p.source).toBe('preset');
    expect(p.version).toBe('1.0.0');

    // Editing a preset updates the SAME id/version in place.
    const edited = await updateProfile(deps, p.id, { resetVector: 0x100 });
    expect(edited.id).toBe(p.id);
    expect(edited.source).toBe('preset');
    expect(edited.resetVector).toBe(0x100);
    expect(await listProfileVersions(deps, 'Test Preset')).toHaveLength(1); // no new version

    // Re-applying the shipped definition (reset) restores it in place.
    const reset = await upsertPresetProfile(deps, 'Test Preset', toMachineProfile(content), 'a template');
    expect(reset.id).toBe(p.id);
    expect(reset.resetVector).toBe(0);
    expect(await listProfileVersions(deps, 'Test Preset')).toHaveLength(1);
  });

  test('cloning a preset yields an independent source:user profile', async () => {
    const deps = await makeDeps();
    const preset = await upsertPresetProfile(deps, 'Base Preset', toMachineProfile(content), null);
    const mine = await cloneProfile(deps, preset.id, 'my-machine');
    expect(mine.source).toBe('user');
    expect(mine.name).toBe('my-machine');
    // Editing the clone versions normally (source:user), leaving the preset alone.
    const v2 = await updateProfile(deps, mine.id, { resetVector: 0x50 });
    expect(v2.id).not.toBe(mine.id); // new version
    expect((await getProfile(deps, preset.id)).resetVector).toBe(0); // preset untouched
  });
});

describe('profile-service: panel base (display metadata, not hardware)', () => {
  test('defaults to oct; stores an explicit base; NOT part of the content digest', async () => {
    const deps = await makeDeps();
    const oct = await createProfile(deps, { name: 'panel-oct', ...content });
    expect(oct.panelBase).toBe('oct');

    const hex = await createProfile(deps, { name: 'panel-hex', panelBase: 'hex', ...content });
    expect(hex.panelBase).toBe('hex');
    // Same hardware, different display default ⇒ identical content digest.
    expect(hex.digest).toBe(oct.digest);
  });

  test('changing only panelBase makes a new version with the same digest', async () => {
    const deps = await makeDeps();
    const v1 = await createProfile(deps, { name: 'panel-upd', ...content });
    expect(v1.panelBase).toBe('oct');
    const v2 = await updateProfile(deps, v1.id, { panelBase: 'hex' });
    expect(v2.panelBase).toBe('hex');
    expect(v2.version).not.toBe(v1.version); // versions immutably
    expect(v2.digest).toBe(v1.digest); // hardware identity unchanged
  });

  test('clone preserves the source panelBase', async () => {
    const deps = await makeDeps();
    const src = await createProfile(deps, { name: 'panel-src', panelBase: 'hex', ...content });
    const clone = await cloneProfile(deps, src.id, 'panel-clone');
    expect(clone.panelBase).toBe('hex');
  });
});

describe('profile-service: uppercase input (SOLOS-class keyboard metadata)', () => {
  test('defaults to false; stores an explicit flag; NOT part of the content digest', async () => {
    const deps = await makeDeps();
    const off = await createProfile(deps, { name: 'uc-off', ...content });
    expect(off.uppercaseInput).toBe(false);

    const on = await createProfile(deps, { name: 'uc-on', uppercaseInput: true, ...content });
    expect(on.uppercaseInput).toBe(true);
    // Same hardware, different input massaging ⇒ identical content digest.
    expect(on.digest).toBe(off.digest);
  });

  test('changing only uppercaseInput makes a new version with the same digest', async () => {
    const deps = await makeDeps();
    const v1 = await createProfile(deps, { name: 'uc-upd', ...content });
    expect(v1.uppercaseInput).toBe(false);
    const v2 = await updateProfile(deps, v1.id, { uppercaseInput: true });
    expect(v2.uppercaseInput).toBe(true);
    expect(v2.version).not.toBe(v1.version); // versions immutably
    expect(v2.digest).toBe(v1.digest); // hardware identity unchanged
  });

  test('clone preserves the source uppercaseInput', async () => {
    const deps = await makeDeps();
    const src = await createProfile(deps, { name: 'uc-src', uppercaseInput: true, ...content });
    const clone = await cloneProfile(deps, src.id, 'uc-clone');
    expect(clone.uppercaseInput).toBe(true);
  });

  test('the SOL-20 preset ships upper-case-only; a plain preset does not', async () => {
    const deps = await makeDeps();
    // The shipped definition carries the flag (SOL-20's video/keyboard cards
    // aren't in this fixture's catalog, so assert the definition directly)...
    expect(getPreset('sol20-solos')?.uppercaseInput).toBe(true);
    expect(getPreset('imsai-cpm')?.uppercaseInput ?? false).toBe(false);
    // ...and it flows through createProfileFromPreset for a catalog-seeded preset.
    const imsai = await createProfileFromPreset(deps, 'imsai-cpm', 'my-imsai');
    expect(imsai.uppercaseInput).toBe(false);
  });
});
