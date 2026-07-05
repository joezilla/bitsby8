/**
 * Configuration API routes.
 *
 * - `GET  /api/config`          — current runtime config (never echoes `apiKey`).
 * - `POST /api/config`          — legacy runtime-toggle endpoint (verbose only).
 * - `GET  /api/config/schema`   — JSON Schema for the frontend to render field constraints.
 * - `GET  /api/config/status`   — writable? systemd? loaded path? startupEpoch? apiKey-set?
 * - `PUT  /api/config/serial`   \
 * - `PUT  /api/config/web`      | Per-section writes → merged, validated, atomically
 * - `PUT  /api/config/terminal` | written back to the config file the daemon loaded at
 * - `PUT  /api/config/logging`  | startup. Restart is not triggered here (Phase 2).
 * - `PUT  /api/config/gpio`     |
 * - `PUT  /api/config/data`     /
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs/promises';
import { z, ZodType } from 'zod';
import { Dependencies } from '../types';
import { safeErrorMessage } from '../utils/safe-path';
import {
  ConfigSchema,
  SerialSchema,
  WebSchema,
  TerminalSchema,
  LoggingSchema,
  DataSchema,
  GpioSchema,
} from '../config';
import { writePartialConfig, rollbackConfig, ConfigWriteError } from '../services/config-persistence';
import { isSystemdManaged, scheduleRestart } from '../services/restart-manager';

/**
 * Concurrency-guard token format used in `ETag` / `If-Match` headers.
 * Combines the daemon's startup epoch (invalidates every restart) with
 * the config file's mtime (invalidates every save). A second client
 * editing stale state gets a 409 instead of silently clobbering.
 */
function makeConfigEtag(startupEpoch: number, mtimeMs: number | null): string {
  return `"epoch-${startupEpoch}+mtime-${mtimeMs ?? 0}"`;
}

export function registerConfigRoutes(router: Router, deps: Dependencies): void {
  /**
   * @openapi
   * /api/config:
   *   get:
   *     tags: [Config]
   *     summary: Get current configuration
   *     description: Returns current runtime configuration. Never includes `apiKey` — call `GET /api/config/status` to check whether it's set.
   *     responses:
   *       200:
   *         description: Current configuration
   */
  router.get('/api/config', (_req: Request, res: Response) => {
    const rc = deps.runtimeConfig || {};
    const { apiKey: _hidden, ...safe } = rc as any;
    res.json({
      // Serial
      port: safe.port ?? '',
      baud: safe.baud,
      drive0: safe.drive0 ?? null,
      drive1: safe.drive1 ?? null,
      drive2: safe.drive2 ?? null,
      drive3: safe.drive3 ?? null,
      readonly: safe.readonly ?? [],

      // Web/API (apiKey deliberately omitted)
      web: safe.web,
      webPort: safe.webPort,
      webHost: safe.webHost,

      // Terminal
      terminalPort: safe.terminalPort,
      terminalBaud: safe.terminalBaud,
      terminalAutoconnect: safe.terminalAutoconnect,

      // Logging
      verbose: safe.verbose,
      debug: safe.debug,
      logFile: safe.logFile,

      // Data & mode
      dataDir: safe.dataDir,
      terminalOnly: safe.terminalOnly,

      // GPIO
      gpioLeds: safe.gpioLeds,
    });
  });

  /**
   * @openapi
   * /api/config:
   *   post:
   *     tags: [Config]
   *     summary: Toggle runtime-only knobs
   *     description: Legacy endpoint. Currently accepts `verbose` only. All other knobs must go through the per-section PUT endpoints and require a restart.
   */
  router.post('/api/config', async (req: Request, res: Response): Promise<void> => {
    try {
      const updates = req.body;
      if (deps.runtimeConfig) {
        if (updates.verbose !== undefined) {
          deps.runtimeConfig.verbose = updates.verbose;
          if (deps.server) deps.server.toggleVerbose();
          deps.terminalManager.setVerbose(!!updates.verbose);
        }
      }
      res.json({ success: true, message: 'Runtime toggles applied. Persistent changes go through PUT /api/config/:section.' });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  /**
   * @openapi
   * /api/config/schema:
   *   get:
   *     tags: [Config]
   *     summary: JSON Schema for the config document
   *     description: Emitted from the same Zod source of truth used to validate writes. Frontend renders field constraints from this — no duplicate schemas in the SPA.
   *     responses:
   *       200: { description: JSON Schema }
   */
  router.get('/api/config/schema', (_req: Request, res: Response) => {
    // Zod 4 exposes `z.toJSONSchema`; fall back to a hand-written summary
    // if the runtime is older, so the endpoint is always safe to call.
    try {
      const toJSONSchema = (z as any).toJSONSchema;
      if (typeof toJSONSchema === 'function') {
        res.json({
          root: toJSONSchema(ConfigSchema),
          sections: {
            serial: toJSONSchema(SerialSchema),
            web: toJSONSchema(WebSchema),
            terminal: toJSONSchema(TerminalSchema),
            logging: toJSONSchema(LoggingSchema),
            data: toJSONSchema(DataSchema),
            gpio: toJSONSchema(GpioSchema),
          },
        });
        return;
      }
    } catch {
      /* fall through */
    }
    res.json({
      note: 'JSON Schema generation is not available in this Zod build; refer to the OpenAPI spec.',
    });
  });

  /**
   * @openapi
   * /api/config/status:
   *   get:
   *     tags: [Config]
   *     summary: Config file and daemon status
   *     description: |
   *       Metadata the UI needs to decide whether the "Restart now" button
   *       is available, whether saves will work, and how to detect a
   *       successful restart (poll `startupEpoch`).
   */
  router.get('/api/config/status', async (_req: Request, res: Response) => {
    const p = deps.configFilePath;
    let writable = false;
    let mtimeMs: number | null = null;
    if (p) {
      try {
        await fs.access(p, (await import('fs')).constants.W_OK);
        writable = true;
      } catch {
        writable = false;
      }
      try {
        mtimeMs = (await fs.stat(p)).mtimeMs;
      } catch {
        mtimeMs = null;
      }
    }
    const etag = makeConfigEtag(deps.startupEpoch, mtimeMs);
    res.set('ETag', etag);
    res.json({
      configFilePath: p,
      writable,
      mtimeMs,
      systemdManaged: isSystemdManaged(),
      startupEpoch: deps.startupEpoch,
      apiKeySet: !!deps.runtimeConfig?.apiKey,
      configReadonly: deps.configReadonly,
      etag,
    });
  });

  /**
   * @openapi
   * /api/config/restart:
   *   post:
   *     tags: [Config]
   *     summary: Gracefully exit so systemd relaunches the daemon
   *     description: |
   *       Requires `?confirm=1` — the click path is destructive enough
   *       that a stray XHR shouldn't take the daemon down. Returns 501
   *       when the process isn't systemd-managed (dev / docker); the
   *       UI should render a copy-paste command in that case.
   *     parameters:
   *       - in: query
   *         name: confirm
   *         required: true
   *         schema: { type: string, enum: ['1'] }
   *     responses:
   *       202: { description: Restart scheduled — poll GET /api/config/status until startupEpoch changes }
   *       400: { description: Missing confirm flag }
   *       501: { description: Not systemd-managed; restart manually }
   */
  router.post('/api/config/restart', (req: Request, res: Response): void => {
    if (req.query.confirm !== '1') {
      res.status(400).json({ error: 'Missing ?confirm=1 — restart is destructive.' });
      return;
    }
    const ok = scheduleRestart();
    if (!ok) {
      res.status(501).json({
        error: 'Not systemd-managed; restart the daemon manually.',
        manualCommand: 'sudo systemctl restart fdcsds',
        systemdManaged: false,
      });
      return;
    }
    res.status(202).json({
      success: true,
      message: 'Restart scheduled. Poll GET /api/config/status until startupEpoch changes.',
      startupEpoch: deps.startupEpoch,
    });
  });

  /**
   * @openapi
   * /api/config/reload:
   *   post:
   *     tags: [Config]
   *     summary: Re-read runtime-toggleable knobs without restarting
   *     description: |
   *       Best-effort re-read of `verbose`, `debug`, and `logFile` from
   *       the current on-disk config. Serial / web / GPIO changes still
   *       need a full restart. Returns 200 with the set of fields that
   *       actually took effect.
   *     responses:
   *       200: { description: Live-reload result }
   */
  router.post('/api/config/reload', async (_req: Request, res: Response): Promise<void> => {
    if (!deps.configFilePath) {
      res.status(409).json({ error: 'No config file loaded — nothing to reload.' });
      return;
    }
    try {
      const raw = await fs.readFile(deps.configFilePath, 'utf-8');
      const parsed = JSON.parse(raw);
      const applied: string[] = [];
      if (deps.runtimeConfig) {
        if (typeof parsed.verbose === 'boolean' && parsed.verbose !== deps.runtimeConfig.verbose) {
          deps.runtimeConfig.verbose = parsed.verbose;
          if (deps.server) deps.server.toggleVerbose();
          deps.terminalManager.setVerbose(parsed.verbose);
          applied.push('verbose');
        }
        if (typeof parsed.debug === 'boolean' && parsed.debug !== deps.runtimeConfig.debug) {
          deps.runtimeConfig.debug = parsed.debug;
          applied.push('debug');
        }
        if (
          (parsed.logFile === null || typeof parsed.logFile === 'string') &&
          parsed.logFile !== deps.runtimeConfig.logFile
        ) {
          deps.runtimeConfig.logFile = parsed.logFile;
          applied.push('logFile');
        }
      }
      res.json({ success: true, applied });
    } catch (err) {
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  /**
   * @openapi
   * /api/config/rollback:
   *   post:
   *     tags: [Config]
   *     summary: Undo the last save by restoring `<config-file>.bak.1`
   *     description: |
   *       Atomically swaps `.bak.1` in as the live config file and
   *       shifts `.bak.2` → `.bak.1`, `.bak.3` → `.bak.2` so a second
   *       rollback walks further back. Requires `?confirm=1`. Refused
   *       in kiosk mode (`--config-readonly`).
   *     parameters:
   *       - in: query
   *         name: confirm
   *         required: true
   *         schema: { type: string, enum: ['1'] }
   *     responses:
   *       200: { description: Rolled back — includes the restored config and its new mtimeMs }
   *       400: { description: Missing confirm flag }
   *       409: { description: No backup to roll back to }
   *       423: { description: Config is read-only (--config-readonly) }
   */
  router.post('/api/config/rollback', async (req: Request, res: Response): Promise<void> => {
    if (req.query.confirm !== '1') {
      res.status(400).json({ error: 'Missing ?confirm=1 — rollback is destructive.' });
      return;
    }
    if (deps.configReadonly) {
      res.status(423).json({ error: 'Config is read-only (--config-readonly).', code: 'CONFIG_READONLY' });
      return;
    }
    if (!deps.configFilePath) {
      res.status(409).json({ error: 'No config file was loaded — nothing to roll back.' });
      return;
    }
    try {
      const { config, mtimeMs } = await rollbackConfig(deps.configFilePath);
      res.set('ETag', makeConfigEtag(deps.startupEpoch, mtimeMs));
      res.json({ success: true, config, mtimeMs, restartRequired: true });
    } catch (err) {
      if (err instanceof ConfigWriteError) {
        const status =
          err.code === 'NOT_WRITABLE' ? 403
          : err.code === 'VALIDATION_FAILED' ? 400
          : err.code === 'NO_CONFIG_FILE' ? 409
          : 500;
        res.status(status).json({ error: err.message, code: err.code, issues: err.issues });
        return;
      }
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  // -----------------------------------------------------------------------
  // Per-section PUTs
  // -----------------------------------------------------------------------

  registerSectionPut(router, deps, '/api/config/serial', SerialSchema);
  registerSectionPut(router, deps, '/api/config/web', WebSchema);
  registerSectionPut(router, deps, '/api/config/terminal', TerminalSchema);
  registerSectionPut(router, deps, '/api/config/logging', LoggingSchema);
  registerSectionPut(router, deps, '/api/config/data', DataSchema);

  // GPIO comes in as a full { gpioLeds: {...} } shape — the section
  // schema is the inner object, so wrap it here.
  registerSectionPut(router, deps, '/api/config/gpio', z.object({ gpioLeds: GpioSchema }));
}

/**
 * Register a `PUT /api/config/:section` handler backed by a Zod schema.
 * Validates the request body against `schema`, then hands the sanitized
 * subtree to `writePartialConfig` which merges + revalidates against
 * the full schema before writing the config file atomically.
 */
function registerSectionPut(
  router: Router,
  deps: Dependencies,
  routePath: string,
  schema: ZodType,
): void {
  router.put(routePath, async (req: Request, res: Response): Promise<void> => {
    if (deps.configReadonly) {
      res.status(423).json({
        error: 'Config is read-only (--config-readonly).',
        code: 'CONFIG_READONLY',
      });
      return;
    }
    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Invalid config payload',
        issues: parseResult.error.issues.map(i => ({ path: i.path, message: i.message })),
      });
      return;
    }

    try {
      if (!deps.configFilePath) {
        res.status(409).json({
          error:
            'No config file was loaded at startup; the daemon has nothing to write to. ' +
            'Start with --config <path> or drop a config file into one of the default locations.',
        });
        return;
      }
      // Optional concurrency guard: if the caller sent an If-Match
      // ETag, reject the write when the file has moved on since they
      // last read it (someone else saved / the daemon restarted).
      const ifMatch = req.header('if-match');
      if (ifMatch) {
        let currentMtime: number | null = null;
        try {
          currentMtime = (await fs.stat(deps.configFilePath)).mtimeMs;
        } catch {
          /* fall through — treat missing file as mismatch */
        }
        const currentEtag = makeConfigEtag(deps.startupEpoch, currentMtime);
        if (ifMatch !== currentEtag) {
          res.status(409).json({
            error: 'Config file changed since you last loaded it. Reload and try again.',
            code: 'STALE_ETAG',
            expected: currentEtag,
            got: ifMatch,
          });
          return;
        }
      }
      const { config, mtimeMs } = await writePartialConfig(
        deps.configFilePath,
        parseResult.data as any,
      );
      res.set('ETag', makeConfigEtag(deps.startupEpoch, mtimeMs));
      res.json({ success: true, config, mtimeMs, restartRequired: true });
    } catch (err) {
      if (err instanceof ConfigWriteError) {
        const status = err.code === 'NOT_WRITABLE' ? 403 : err.code === 'VALIDATION_FAILED' ? 400 : 500;
        res.status(status).json({ error: err.message, code: err.code, issues: err.issues });
        return;
      }
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });
}
