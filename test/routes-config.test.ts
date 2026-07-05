/**
 * Integration tests for src/routes/config.ts.
 *
 * Mounts an Express router with a hand-built Dependencies stub and
 * drives it via supertest. Uses real temp files for the config so the
 * write-back path is genuinely exercised — the routes call
 * `writePartialConfig`, which does atomic tmp+rename + rotation.
 */

import express from 'express';
import request from 'supertest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { registerConfigRoutes } from '../src/routes/config';

async function makeTempConfig(initial: object): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-routes-'));
  const file = path.join(dir, 'fdcsds.config');
  await fs.writeFile(file, JSON.stringify(initial, null, 2));
  return file;
}

function buildApp(overrides: Partial<any> = {}) {
  const app = express();
  app.use(express.json());
  const router = express.Router();

  // Bare-minimum Dependencies stub — only the fields the config routes touch.
  const deps: any = {
    runtimeConfig: { port: '/dev/ttyUSB0', baud: 230400, verbose: false, apiKey: null },
    configFilePath: null,
    startupEpoch: 1_700_000_000_000,
    server: null,
    terminalManager: { setVerbose: jest.fn() },
    ...overrides,
  };

  registerConfigRoutes(router, deps);
  app.use(router);
  return { app, deps };
}

describe('config routes', () => {
  describe('GET /api/config', () => {
    test('returns the current runtime config', async () => {
      const { app } = buildApp();
      const res = await request(app).get('/api/config');
      expect(res.status).toBe(200);
      expect(res.body.port).toBe('/dev/ttyUSB0');
      expect(res.body.baud).toBe(230400);
    });

    test('never echoes apiKey', async () => {
      const { app } = buildApp({
        runtimeConfig: { port: '/dev/ttyUSB0', apiKey: 'super-secret' },
      });
      const res = await request(app).get('/api/config');
      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty('apiKey');
    });
  });

  describe('GET /api/config/status', () => {
    test('reports configFilePath=null and writable=false when no file was loaded', async () => {
      const { app } = buildApp();
      const res = await request(app).get('/api/config/status');
      expect(res.status).toBe(200);
      expect(res.body.configFilePath).toBeNull();
      expect(res.body.writable).toBe(false);
      expect(res.body.systemdManaged).toBe(false);
      expect(res.body.startupEpoch).toBe(1_700_000_000_000);
      expect(res.body.apiKeySet).toBe(false);
    });

    test('reports writable=true for a real writable file', async () => {
      const filePath = await makeTempConfig({});
      const { app } = buildApp({ configFilePath: filePath });
      const res = await request(app).get('/api/config/status');
      expect(res.body.configFilePath).toBe(filePath);
      expect(res.body.writable).toBe(true);
      expect(typeof res.body.mtimeMs).toBe('number');
    });

    test('reports apiKeySet=true without leaking the value', async () => {
      const { app } = buildApp({
        runtimeConfig: { apiKey: 'abc' },
      });
      const res = await request(app).get('/api/config/status');
      expect(res.body.apiKeySet).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain('abc');
    });
  });

  describe('PUT /api/config/:section', () => {
    test('rejects unknown fields at the section boundary', async () => {
      const filePath = await makeTempConfig({});
      const { app } = buildApp({ configFilePath: filePath });
      const res = await request(app)
        .put('/api/config/serial')
        .send({ baud: 'not-a-number' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid config/i);
      expect(Array.isArray(res.body.issues)).toBe(true);
    });

    test('accepts a valid serial patch and writes it to disk', async () => {
      const filePath = await makeTempConfig({ port: '/dev/ttyUSB0', baud: 230400 });
      const { app } = buildApp({ configFilePath: filePath });
      const res = await request(app)
        .put('/api/config/serial')
        .send({ baud: 115200 });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.restartRequired).toBe(true);
      const onDisk = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      expect(onDisk.baud).toBe(115200);
      expect(onDisk.port).toBe('/dev/ttyUSB0'); // untouched
    });

    test('rejects a GPIO patch that reuses a pin across drives', async () => {
      const filePath = await makeTempConfig({});
      const { app } = buildApp({ configFilePath: filePath });
      const res = await request(app)
        .put('/api/config/gpio')
        .send({
          gpioLeds: {
            enabled: true,
            drive0: { enable: 17 },
            drive1: { enable: 17 },
          },
        });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.issues.some((i: any) => /used more than once/i.test(i.message))).toBe(true);
    });

    test('returns 409 when no config file was loaded', async () => {
      const { app } = buildApp(); // configFilePath: null
      const res = await request(app)
        .put('/api/config/web')
        .send({ webPort: 3001 });
      expect(res.status).toBe(409);
    });

    test('accepts a web patch and updates webPort', async () => {
      const filePath = await makeTempConfig({});
      const { app } = buildApp({ configFilePath: filePath });
      const res = await request(app)
        .put('/api/config/web')
        .send({ webPort: 3001, webHost: '0.0.0.0' });
      expect(res.status).toBe(200);
      const onDisk = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      expect(onDisk.webPort).toBe(3001);
      expect(onDisk.webHost).toBe('0.0.0.0');
    });
  });

  describe('POST /api/config (legacy runtime toggle)', () => {
    test('still accepts verbose', async () => {
      const setVerbose = jest.fn();
      const { app, deps } = buildApp({
        runtimeConfig: { verbose: false },
        terminalManager: { setVerbose },
      });
      const res = await request(app).post('/api/config').send({ verbose: true });
      expect(res.status).toBe(200);
      expect(deps.runtimeConfig.verbose).toBe(true);
      expect(setVerbose).toHaveBeenCalledWith(true);
    });
  });
});
