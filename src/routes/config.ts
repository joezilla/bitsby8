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
import { writePartialConfig, ConfigWriteError } from '../services/config-persistence';
import { isSystemdManaged } from '../services/restart-manager';

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
    res.json({
      configFilePath: p,
      writable,
      mtimeMs,
      systemdManaged: isSystemdManaged(),
      startupEpoch: deps.startupEpoch,
      apiKeySet: !!deps.runtimeConfig?.apiKey,
    });
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
      const { config, mtimeMs } = await writePartialConfig(
        deps.configFilePath,
        parseResult.data as any,
      );
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
