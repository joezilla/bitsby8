/**
 * Tests for the Catalog service (Card Definitions) — Bitsby8 Story 1.2 Task 3.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Database } from '../src/database';
import { Dependencies } from '../src/types';
import { ServiceError } from '../src/services/service-error';
import {
  registerCardDefinition,
  listCardDefinitions,
  getCardDefinition,
  RegisterCardInput,
} from '../src/services/catalog';

async function makeDeps(): Promise<Dependencies> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-cat-'));
  const db = new Database(path.join(dir, 'test.db'));
  await db.initialize();
  return { database: db } as unknown as Dependencies;
}

const sample: RegisterCardInput = {
  manifest: {
    name: 'mits-88-2sio',
    version: '1.0.0',
    type: 'serial',
    maker: 'MITS',
    summary: 'MITS 88-2SIO dual serial interface.',
    configSchema: { basePort: { type: 'u8', default: 0x10 } },
  },
  entry: 'seed:mits-88-2sio',
  source: 'seed',
};

describe('catalog: registerCardDefinition', () => {
  test('registers a card with dual Identity (name@version + digest)', async () => {
    const deps = await makeDeps();
    const doc = await registerCardDefinition(deps, sample);
    expect(doc.id).toBe('mits-88-2sio@1.0.0');
    expect(doc.name).toBe('mits-88-2sio');
    expect(doc.version).toBe('1.0.0');
    expect(doc.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(doc.type).toBe('serial');
    expect(doc.manifest.configSchema).toBeDefined();
    expect(doc.source).toBe('seed');
  });

  test('digest is stable for identical content and changes with content', async () => {
    const deps = await makeDeps();
    const a = await registerCardDefinition(deps, sample);
    const again = await registerCardDefinition(deps, sample);
    expect(again.digest).toBe(a.digest); // idempotent, same digest

    const changed = await registerCardDefinition(deps, {
      ...sample,
      manifest: { ...sample.manifest, summary: 'different summary' },
    });
    expect(changed.digest).not.toBe(a.digest);
  });

  test('re-registering the same Identity upserts (no duplicate)', async () => {
    const deps = await makeDeps();
    await registerCardDefinition(deps, sample);
    await registerCardDefinition(deps, sample);
    const all = await listCardDefinitions(deps);
    expect(all).toHaveLength(1);
  });

  test('rejects a missing name', async () => {
    const deps = await makeDeps();
    await expect(
      registerCardDefinition(deps, { manifest: { ...sample.manifest, name: '' } }),
    ).rejects.toThrow(ServiceError);
  });

  test('rejects a non-semver version', async () => {
    const deps = await makeDeps();
    await expect(
      registerCardDefinition(deps, { manifest: { ...sample.manifest, version: 'v1' } }),
    ).rejects.toThrow(/semver/);
  });

  test('rejects a missing type', async () => {
    const deps = await makeDeps();
    await expect(
      registerCardDefinition(deps, { manifest: { ...sample.manifest, type: '' } }),
    ).rejects.toThrow(ServiceError);
  });
});

describe('catalog: list / get', () => {
  test('lists registered definitions', async () => {
    const deps = await makeDeps();
    await registerCardDefinition(deps, sample);
    await registerCardDefinition(deps, {
      manifest: { ...sample.manifest, name: 'mits-88-dcdd', type: 'floppy' },
      source: 'seed',
    });
    const all = await listCardDefinitions(deps);
    expect(all.map((d) => d.id).sort()).toEqual(['mits-88-2sio@1.0.0', 'mits-88-dcdd@1.0.0']);
  });

  test('gets a definition by Identity, or 404s', async () => {
    const deps = await makeDeps();
    await registerCardDefinition(deps, sample);
    const doc = await getCardDefinition(deps, 'mits-88-2sio@1.0.0');
    expect(doc.name).toBe('mits-88-2sio');

    await expect(getCardDefinition(deps, 'nope@9.9.9')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
