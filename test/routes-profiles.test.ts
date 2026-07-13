/**
 * Route tests for /api/profiles — the REST surface of Machine Profiles
 * (Bitsby8 Story 2.3). Verifies the create → edit-new-version → clone → delete
 * lifecycle and error mapping over HTTP (REST/MCP parity, AR-9).
 */

import express from 'express';
import request from 'supertest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Database } from '../src/database';
import { registerProfileRoutes } from '../src/routes/profiles';
import { registerCardDefinition } from '../src/services/catalog';
import { _setSimForTests, SimModule } from '../src/services/bundle-registry';
import { Dependencies } from '../src/types';

async function buildApp() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-rprof-'));
  const database = new Database(path.join(dir, 'test.db'));
  await database.initialize();
  const deps = { database } as unknown as Dependencies;
  const app = express();
  app.use(express.json());
  const router = express.Router();
  registerProfileRoutes(router, deps);
  app.use(router);
  return app;
}

const body = {
  name: 'rest-altair',
  cpuKind: 'i8080',
  clock: 'max',
  resetVector: 0,
  memory: [{ id: 'ram', base: 0, size: 0x10000, kind: 'ram' }],
  cards: [],
};

describe('/api/profiles lifecycle', () => {
  test('create → get → edit (new version) → versions → clone → delete', async () => {
    const app = await buildApp();

    const created = await request(app).post('/api/profiles').send(body);
    expect(created.status).toBe(200);
    expect(created.body.profile.id).toBe('rest-altair@1.0.0');

    const got = await request(app).get('/api/profiles/rest-altair@1.0.0');
    expect(got.status).toBe(200);
    expect(got.body.profile.cpuKind).toBe('i8080');

    // Edit → new version, prior stays.
    const edited = await request(app).put('/api/profiles/rest-altair@1.0.0').send({ resetVector: 0xff00 });
    expect(edited.body.profile.version).toBe('1.0.1');
    expect(edited.body.profile.resetVector).toBe(0xff00);
    expect((await request(app).get('/api/profiles/rest-altair@1.0.0')).body.profile.resetVector).toBe(0);

    const versions = await request(app).get('/api/profiles/rest-altair/versions');
    expect(versions.body.versions.map((v: { version: string }) => v.version)).toEqual(['1.0.1', '1.0.0']);

    // List shows the latest only.
    const list = await request(app).get('/api/profiles');
    expect(list.body.profiles).toHaveLength(1);
    expect(list.body.profiles[0].version).toBe('1.0.1');

    const cloned = await request(app).post('/api/profiles/rest-altair@1.0.1/clone').send({ name: 'rest-clone' });
    expect(cloned.body.profile.id).toBe('rest-clone@1.0.0');

    const del = await request(app).delete('/api/profiles/rest-altair@1.0.1');
    expect(del.status).toBe(200);
    expect((await request(app).get('/api/profiles')).body.profiles.map((p: { name: string }) => p.name)).toEqual([
      'rest-clone',
    ]);
  });

  test('a duplicate name maps to 409, an unknown id to 404, a missing name to 400', async () => {
    const app = await buildApp();
    await request(app).post('/api/profiles').send(body);
    expect((await request(app).post('/api/profiles').send(body)).status).toBe(409);
    expect((await request(app).get('/api/profiles/nope@9.9.9')).status).toBe(404);
    expect((await request(app).post('/api/profiles').send({ cpuKind: 'i8080' })).status).toBe(400);
  });
});

describe('/api/profiles/validate + /auto-assign', () => {
  const fakeSim = {
    seedBundles: [
      {
        manifest: { name: 'q', version: '1.0.0', type: 'serial', configSchema: { basePort: { type: 'u8', default: 0x10, min: 0, max: 0xfc } } },
        cardFactory: (id: string) => ({ id }),
        claims: (cfg: Record<string, unknown>) => {
          const b = ((cfg.basePort as number) ?? 0x10) & 0xff;
          return { ports: [b, b + 1] };
        },
      },
    ],
    withDefaults: (_m: unknown, c: Record<string, unknown> = {}) => ({ ...c }),
  } as unknown as SimModule;

  beforeEach(() => _setSimForTests(fakeSim));
  afterEach(() => _setSimForTests(null));

  async function appWithCard() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-rpv-'));
    const database = new Database(path.join(dir, 'test.db'));
    await database.initialize();
    const deps = { database } as unknown as Dependencies;
    await registerCardDefinition(deps, {
      manifest: { name: 'q', version: '1.0.0', type: 'serial', configSchema: { basePort: { type: 'u8', default: 0x10, min: 0, max: 0xfc } } },
      source: 'seed',
    });
    const app = express();
    app.use(express.json());
    const router = express.Router();
    registerProfileRoutes(router, deps);
    app.use(router);
    return app;
  }

  test('validate reports a port collision; auto-assign clears it', async () => {
    const app = await appWithCard();
    const cards = [
      { id: 'a', ref: 'q@1.0.0', config: { basePort: 0x10 } },
      { id: 'b', ref: 'q@1.0.0', config: { basePort: 0x10 } },
    ];
    const bad = await request(app).post('/api/profiles/validate').send({ cards, memory: [] });
    expect(bad.body.ok).toBe(false);
    expect(bad.body.collisions[0]).toMatchObject({ kind: 'port', offenders: ['a', 'b'] });

    const aa = await request(app).post('/api/profiles/auto-assign').send({ cards, memory: [] });
    expect(aa.body.unresolved).toEqual([]);
    const good = await request(app).post('/api/profiles/validate').send({ cards: aa.body.content.cards, memory: [] });
    expect(good.body.ok).toBe(true);
  });
});
