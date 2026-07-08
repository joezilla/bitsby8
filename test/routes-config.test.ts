/**
 * Integration tests for src/routes/config.ts.
 *
 * Mounts an Express router with a hand-built Dependencies stub and
 * drives it via supertest. Uses real temp files for the config so the
 * write-back path is genuinely exercised — the routes call
 * `writePartialConfig`, which does atomic tmp+rename + rotation.
 */

// Prevent the CI systemd environment (INVOCATION_ID set) from leaking into tests
jest.mock('../src/services/restart-manager', () => ({
  isSystemdManaged: jest.fn(() => false),
  scheduleRestart: jest.fn(),
}));

import express from 'express';
import request from 'supertest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { registerConfigRoutes } from '../src/routes/config';

async function makeTempOverride(initial: object): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-routes-'));
  const file = path.join(dir, 'fdcsds.overrides.json');
  await fs.writeFile(file, JSON.stringify(initial, null, 2));
  return file;
}

async function makeTempOverridePath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-routes-'));
  return path.join(dir, 'fdcsds.overrides.json');
}

function buildApp(overrides: Partial<any> = {}) {
  const app = express();
  app.use(express.json());
  const router = express.Router();

  // Bare-minimum Dependencies stub — only the fields the config routes touch.
  const deps: any = {
    runtimeConfig: { port: '/dev/ttyUSB0', baud: 230400, verbose: false, apiKey: null },
    baselineConfig: null,
    packageConfigFilePath: null,
    overrideConfigFilePath: null,
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
    test('reports both paths null and writable=false when no paths are configured', async () => {
      const { app } = buildApp();
      const res = await request(app).get('/api/config/status');
      expect(res.status).toBe(200);
      expect(res.body.packageConfigFilePath).toBeNull();
      expect(res.body.overrideConfigFilePath).toBeNull();
      expect(res.body.configFilePath).toBeNull();  // legacy alias
      expect(res.body.writable).toBe(false);
      expect(res.body.systemdManaged).toBe(false);
      expect(res.body.startupEpoch).toBe(1_700_000_000_000);
      expect(res.body.apiKeySet).toBe(false);
    });

    test('reports writable=true when the override file exists and is writable', async () => {
      const filePath = await makeTempOverride({});
      const { app } = buildApp({ overrideConfigFilePath: filePath });
      const res = await request(app).get('/api/config/status');
      expect(res.body.overrideConfigFilePath).toBe(filePath);
      expect(res.body.configFilePath).toBe(filePath); // legacy alias
      expect(res.body.writable).toBe(true);
      expect(typeof res.body.mtimeMs).toBe('number');
    });

    test('reports writable=true even when the override file does not exist yet, as long as the parent directory is writable', async () => {
      const filePath = await makeTempOverridePath();
      const { app } = buildApp({ overrideConfigFilePath: filePath });
      const res = await request(app).get('/api/config/status');
      expect(res.body.overrideConfigFilePath).toBe(filePath);
      expect(res.body.writable).toBe(true);
      expect(res.body.mtimeMs).toBeNull();
    });

    test('surfaces both baseline and override paths independently', async () => {
      const overridePath = await makeTempOverride({});
      const { app } = buildApp({
        overrideConfigFilePath: overridePath,
        packageConfigFilePath: '/etc/fdcsds/fdcsds.config.json',
      });
      const res = await request(app).get('/api/config/status');
      expect(res.body.packageConfigFilePath).toBe('/etc/fdcsds/fdcsds.config.json');
      expect(res.body.overrideConfigFilePath).toBe(overridePath);
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
      const filePath = await makeTempOverride({});
      const { app } = buildApp({ overrideConfigFilePath: filePath });
      const res = await request(app)
        .put('/api/config/serial')
        .send({ baud: 'not-a-number' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid config/i);
      expect(Array.isArray(res.body.issues)).toBe(true);
    });

    test('accepts a valid serial patch and writes it to the override file', async () => {
      const filePath = await makeTempOverride({});
      const baselineConfig = { port: '/dev/ttyUSB0', baud: 230400 };
      const { app } = buildApp({ overrideConfigFilePath: filePath, baselineConfig });
      const res = await request(app)
        .put('/api/config/serial')
        .send({ baud: 115200 });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.restartRequired).toBe(true);
      // The effective config in the response reflects baseline + override.
      expect(res.body.config.port).toBe('/dev/ttyUSB0');
      expect(res.body.config.baud).toBe(115200);
      // On disk, only the changed key is in the override — baseline stays untouched.
      const onDisk = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      expect(onDisk).toEqual({ baud: 115200 });
      expect(onDisk).not.toHaveProperty('port');
    });

    test('does NOT touch the /etc-style baseline file', async () => {
      const overrideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-o-'));
      const baselineDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fdcsds-b-'));
      const overridePath = path.join(overrideDir, 'fdcsds.overrides.json');
      const baselinePath = path.join(baselineDir, 'fdcsds.config.json');
      await fs.writeFile(baselinePath, JSON.stringify({ port: '/dev/ttyUSB0' }));
      const beforeMtime = (await fs.stat(baselinePath)).mtimeMs;

      const { app } = buildApp({
        overrideConfigFilePath: overridePath,
        packageConfigFilePath: baselinePath,
        baselineConfig: { port: '/dev/ttyUSB0' },
      });

      await new Promise(r => setTimeout(r, 20));
      const res = await request(app).put('/api/config/web').send({ webPort: 3001 });
      expect(res.status).toBe(200);
      const afterMtime = (await fs.stat(baselinePath)).mtimeMs;
      expect(afterMtime).toBe(beforeMtime);
    });

    test('rejects a GPIO patch that reuses a pin across drives', async () => {
      const filePath = await makeTempOverride({});
      const { app } = buildApp({ overrideConfigFilePath: filePath });
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

    test('a GPIO save replaces baseline gpioLeds wholesale (documents the layer semantics)', async () => {
      // The UI's GPIO save handler always ships the full gpioLeds
      // subtree, so the layer merge replaces baseline gpioLeds
      // wholesale. Confirming that here so the semantic doesn't
      // regress into a surprising deep-merge some day.
      const filePath = await makeTempOverride({});
      const baselineConfig = {
        gpioLeds: { enabled: true, drive0: { enable: 17, headLoad: 27, readOnly: 22 } },
      };
      const { app } = buildApp({ overrideConfigFilePath: filePath, baselineConfig });
      const res = await request(app)
        .put('/api/config/gpio')
        .send({ gpioLeds: { enabled: true, drive1: { enable: 17 } } });
      expect(res.status).toBe(200);
      expect(res.body.config.gpioLeds).toEqual({ enabled: true, drive1: { enable: 17 } });
      expect(res.body.config.gpioLeds).not.toHaveProperty('drive0');
    });

    test('returns 409 when no override file path is configured', async () => {
      const { app } = buildApp(); // overrideConfigFilePath: null
      const res = await request(app)
        .put('/api/config/web')
        .send({ webPort: 3001 });
      expect(res.status).toBe(409);
    });

    test('accepts a web patch and updates webPort in the override', async () => {
      const filePath = await makeTempOverride({});
      const { app } = buildApp({ overrideConfigFilePath: filePath });
      const res = await request(app)
        .put('/api/config/web')
        .send({ webPort: 3001, webHost: '0.0.0.0' });
      expect(res.status).toBe(200);
      const onDisk = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      expect(onDisk.webPort).toBe(3001);
      expect(onDisk.webHost).toBe('0.0.0.0');
    });

    test('creates the override file on first save', async () => {
      const filePath = await makeTempOverridePath();
      const { app } = buildApp({
        overrideConfigFilePath: filePath,
        baselineConfig: { webPort: 3000 },
      });
      const res = await request(app)
        .put('/api/config/web')
        .send({ webPort: 3001 });
      expect(res.status).toBe(200);
      const onDisk = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      expect(onDisk).toEqual({ webPort: 3001 });
    });
  });

  describe('POST /api/config/rollback', () => {
    test('rejects without ?confirm=1', async () => {
      const filePath = await makeTempOverride({ webPort: 3000 });
      const { app } = buildApp({ overrideConfigFilePath: filePath });
      const res = await request(app).post('/api/config/rollback');
      expect(res.status).toBe(400);
    });

    test('returns 409 when there is no backup to restore', async () => {
      const filePath = await makeTempOverride({ webPort: 3000 });
      const { app } = buildApp({ overrideConfigFilePath: filePath });
      const res = await request(app).post('/api/config/rollback?confirm=1');
      expect(res.status).toBe(409);
    });

    test('restores the previous save and returns the new effective config', async () => {
      const filePath = await makeTempOverride({ webPort: 3000 });
      // Prime one backup through the persistence layer.
      const { writePartialConfig } = require('../src/services/config-persistence');
      await writePartialConfig(filePath, { webPort: 3001 }, null);

      const { app } = buildApp({ overrideConfigFilePath: filePath });
      const res = await request(app).post('/api/config/rollback?confirm=1');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.config.webPort).toBe(3000);
    });

    test('returns 423 when configReadonly is set', async () => {
      const filePath = await makeTempOverride({ webPort: 3000 });
      const { app } = buildApp({ overrideConfigFilePath: filePath, configReadonly: true });
      const res = await request(app).post('/api/config/rollback?confirm=1');
      expect(res.status).toBe(423);
      expect(res.body.code).toBe('CONFIG_READONLY');
    });
  });

  describe('--config-readonly (kiosk mode)', () => {
    test('rejects section PUTs with 423 Locked', async () => {
      const filePath = await makeTempOverride({});
      const { app } = buildApp({ overrideConfigFilePath: filePath, configReadonly: true });
      const res = await request(app).put('/api/config/web').send({ webPort: 3001 });
      expect(res.status).toBe(423);
      expect(res.body.code).toBe('CONFIG_READONLY');
    });

    test('GET /api/config/status echoes configReadonly=true', async () => {
      const { app } = buildApp({ configReadonly: true });
      const res = await request(app).get('/api/config/status');
      expect(res.body.configReadonly).toBe(true);
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
