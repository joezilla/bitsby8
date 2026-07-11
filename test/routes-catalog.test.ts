/**
 * Route tests for /api/catalog/cards — list + get by Identity (Bitsby8 FR-2).
 */

import express from 'express';
import request from 'supertest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Database } from '../src/database';
import { registerCatalogRoutes } from '../src/routes/catalog';
import { registerCardDefinition } from '../src/services/catalog';
import { Dependencies } from '../src/types';

async function buildApp() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-rcat-'));
  const database = new Database(path.join(dir, 'test.db'));
  await database.initialize();
  const deps = { database } as unknown as Dependencies;

  await registerCardDefinition(deps, {
    manifest: {
      name: 'mits-88-2sio',
      version: '1.0.0',
      type: 'serial',
      maker: 'MITS',
      configSchema: { basePort: { type: 'u8', default: 0x10 } },
    },
    entry: 'seed:mits-88-2sio',
    source: 'seed',
  });

  const app = express();
  app.use(express.json());
  const router = express.Router();
  registerCatalogRoutes(router, deps);
  app.use(router);
  return app;
}

describe('GET /api/catalog/cards', () => {
  test('lists registered card definitions', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/catalog/cards');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.cards)).toBe(true);
    expect(res.body.cards).toHaveLength(1);
    expect(res.body.cards[0].id).toBe('mits-88-2sio@1.0.0');
    expect(res.body.cards[0].digest).toMatch(/^sha256:/);
  });
});

describe('GET /api/catalog/cards/:id', () => {
  test('returns a card by Identity', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/catalog/cards/mits-88-2sio@1.0.0');
    expect(res.status).toBe(200);
    expect(res.body.card.name).toBe('mits-88-2sio');
    expect(res.body.card.manifest.configSchema).toBeDefined();
  });

  test('404s for an unknown Identity', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/catalog/cards/nope@9.9.9');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});
