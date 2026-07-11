/**
 * Tests for define-time Card Instance config validation (Bitsby8 Story 2.4,
 * FR-7): ranges/enums rejected with a specific message, defaults filled from
 * the schema, and profile save enforcing it against the Catalog.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Database } from '../src/database';
import { Dependencies } from '../src/types';
import { registerCardDefinition } from '../src/services/catalog';
import { createProfile } from '../src/services/profile-service';
import { validateCardConfig, checkCardConfig, resolveCardInstanceConfig } from '../src/services/card-config';

const schema = {
  basePort: { type: 'u8' as const, default: 0x10, min: 0, max: 0xfc, description: 'Base I/O port' },
  mode: { type: 'enum' as const, default: 'a', enum: ['a', 'b'] },
};

async function makeDeps(): Promise<Dependencies> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-cc-'));
  const db = new Database(path.join(dir, 'test.db'));
  await db.initialize();
  const deps = { database: db } as unknown as Dependencies;
  await registerCardDefinition(deps, {
    manifest: { name: 'thecard', version: '1.0.0', type: 'serial', configSchema: schema },
    source: 'seed',
  });
  return deps;
}

describe('validateCardConfig (pure)', () => {
  test('fills defaults from the schema when a value is omitted', () => {
    const { resolved, errors } = validateCardConfig(schema, {});
    expect(errors).toEqual([]);
    expect(resolved).toEqual({ basePort: 0x10, mode: 'a' });
  });

  test('accepts an in-range value and a valid enum', () => {
    const { resolved, errors } = validateCardConfig(schema, { basePort: 0x20, mode: 'b' });
    expect(errors).toEqual([]);
    expect(resolved).toEqual({ basePort: 0x20, mode: 'b' });
  });

  test('rejects an out-of-range value with a specific hex message', () => {
    const { errors } = validateCardConfig(schema, { basePort: 0x1ff });
    expect(errors).toHaveLength(1);
    expect(errors[0].param).toBe('basePort');
    expect(errors[0].message).toMatch(/0x00–0xFC/);
    expect(errors[0].message).toMatch(/0x1FF/);
  });

  test('rejects a bad enum and a non-integer, and flags unknown settings', () => {
    expect(validateCardConfig(schema, { mode: 'z' }).errors[0].message).toMatch(/must be one of a, b/);
    expect(validateCardConfig(schema, { basePort: 1.5 }).errors[0].message).toMatch(/integer/);
    expect(validateCardConfig(schema, { bogus: 1 }).errors.some((e) => /Unknown setting/.test(e.message))).toBe(true);
  });
});

describe('checkCardConfig / resolveCardInstanceConfig (against the Catalog)', () => {
  test('checkCardConfig returns errors without throwing; 404s an unknown card', async () => {
    const deps = await makeDeps();
    expect((await checkCardConfig(deps, 'thecard@1.0.0', { basePort: 0x20 })).errors).toEqual([]);
    expect((await checkCardConfig(deps, 'thecard@1.0.0', { basePort: 0x1ff })).errors).toHaveLength(1);
    await expect(checkCardConfig(deps, 'ghost@1.0.0', {})).rejects.toMatchObject({ statusCode: 404 });
  });

  test('resolveCardInstanceConfig throws 400 with a specific message on a bad value', async () => {
    const deps = await makeDeps();
    await expect(resolveCardInstanceConfig(deps, 'thecard@1.0.0', { basePort: 0x1ff })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(await resolveCardInstanceConfig(deps, 'thecard@1.0.0', {})).toEqual({ basePort: 0x10, mode: 'a' });
  });
});

describe('profile save enforces card config (FR-7)', () => {
  const base = {
    cpuKind: 'i8080' as const,
    clock: 'max' as const,
    resetVector: 0,
    memory: [{ id: 'ram', base: 0, size: 0x10000, kind: 'ram' as const }],
  };

  test('rejects a profile whose card config is out of range, and fills defaults for a valid one', async () => {
    const deps = await makeDeps();
    await expect(
      createProfile(deps, { name: 'bad', ...base, cards: [{ id: 'c', ref: 'thecard@1.0.0', config: { basePort: 0x1ff } }] }),
    ).rejects.toMatchObject({ statusCode: 400 });

    const ok = await createProfile(deps, {
      name: 'good',
      ...base,
      cards: [{ id: 'c', ref: 'thecard@1.0.0' }],
    });
    // Defaults filled from the schema on save.
    expect(ok.cards[0].config).toEqual({ basePort: 0x10, mode: 'a' });
  });

  test('rejects a card not in the Catalog (404)', async () => {
    const deps = await makeDeps();
    await expect(
      createProfile(deps, { name: 'unknown-card', ...base, cards: [{ id: 'c', ref: 'nope@1.0.0' }] }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
