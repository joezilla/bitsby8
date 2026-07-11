/**
 * Route tests for /api/settings — the multi-client feature flag, writeMaster,
 * and the toggle-off guard that refuses disabling while >1 client is connected.
 */

import express from 'express';
import request from 'supertest';
import { registerSettingsRoutes } from '../src/routes/settings';

function buildApp(overrides: Partial<any> = {}) {
  // In-memory settings store standing in for the DB.
  const store = new Map<string, string>();
  const database: any = {
    getSetting: async (k: string) => store.get(k) ?? null,
    setSetting: async (k: string, v: string) => { store.set(k, v); },
  };

  const app = express();
  app.use(express.json());
  const router = express.Router();
  const deps: any = {
    database,
    multiClientServing: false,
    writeMaster: 'serial',
    connectionManager: { count: () => 0 },
    ...overrides,
  };
  registerSettingsRoutes(router, deps);
  app.use(router);
  return { app, deps };
}

describe('settings routes', () => {
  test('GET returns defaults', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ multiClientServing: false, writeMaster: 'serial' });
  });

  test('PUT enables multi-client and updates the live cache', async () => {
    const { app, deps } = buildApp();
    const res = await request(app).put('/api/settings').send({ multiClientServing: true });
    expect(res.status).toBe(200);
    expect(res.body.multiClientServing).toBe(true);
    expect(deps.multiClientServing).toBe(true);
  });

  test('PUT sets writeMaster', async () => {
    const { app, deps } = buildApp();
    const res = await request(app).put('/api/settings').send({ writeMaster: 'altair-1' });
    expect(res.status).toBe(200);
    expect(res.body.writeMaster).toBe('altair-1');
    expect(deps.writeMaster).toBe('altair-1');
  });

  test('PUT rejects a non-boolean multiClientServing', async () => {
    const { app } = buildApp();
    const res = await request(app).put('/api/settings').send({ multiClientServing: 'yes' });
    expect(res.status).toBe(400);
  });

  test('toggle-off is refused while >1 client is connected', async () => {
    const { app } = buildApp({ multiClientServing: true, connectionManager: { count: () => 2 } });
    const res = await request(app).put('/api/settings').send({ multiClientServing: false });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CLIENTS_CONNECTED');
    expect(res.body.connected).toBe(2);
  });

  test('toggle-off is allowed with one client connected', async () => {
    const { app, deps } = buildApp({ multiClientServing: true, connectionManager: { count: () => 1 } });
    const res = await request(app).put('/api/settings').send({ multiClientServing: false });
    expect(res.status).toBe(200);
    expect(deps.multiClientServing).toBe(false);
  });
});
