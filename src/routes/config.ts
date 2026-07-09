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
import { createLogger } from '../logger';
import { getStatus } from '../services/status';

const log = createLogger('routes:config');
import {
  ConfigSchema,
  SerialSchema,
  WebSchema,
  McpSchema,
  DiskServingSchema,
  TerminalSchema,
  LoggingSchema,
  DataSchema,
  GpioSchema,
} from '../config';
import { setMcpHttpEnabled, isMcpHttpEnabled, activeMcpSessionCount } from '../mcp-http';
import { writePartialConfig, rollbackConfig, ConfigWriteError } from '../services/config-persistence';
import { isSystemdManaged, scheduleRestart } from '../services/restart-manager';
import { hashPassword } from '../services/password';

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
    // Strip secrets before echoing to the client. apiKey is a machine
    // credential; adminPassword is a bcrypt hash — neither belongs in
    // an API response. The UI reads their presence via /api/config/status.
    const { apiKey: _hiddenKey, adminPassword: _hiddenPw, ...safe } = rc as any;
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

      // MCP over HTTP (opt-in; requires apiKey to be set)
      enableMcpHttp: safe.enableMcpHttp,

      // Disk serving: TCP-based (WebSocket) FDC transport. On by
      // default — absent means enabled, only explicit false disables.
      enableWsTransport: safe.enableWsTransport ?? true,

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
            mcp: toJSONSchema(McpSchema),
            diskServing: toJSONSchema(DiskServingSchema),
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
    // The override file is the one that mutates on save — writability
    // and mtime both track it. The baseline is admin-managed and never
    // written by the daemon, so it's reported for display only.
    const overridePath = deps.overrideConfigFilePath;
    const packagePath = deps.packageConfigFilePath;
    let writable = false;
    let mtimeMs: number | null = null;
    if (overridePath) {
      try {
        await fs.access(overridePath, (await import('fs')).constants.W_OK);
        writable = true;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        // Missing file is fine — the directory just needs to be writable
        // so the first save can create the override.
        if (code === 'ENOENT') {
          try {
            const path = await import('path');
            await fs.access(path.dirname(overridePath), (await import('fs')).constants.W_OK);
            writable = true;
          } catch {
            writable = false;
          }
        } else {
          writable = false;
        }
      }
      try {
        mtimeMs = (await fs.stat(overridePath)).mtimeMs;
      } catch {
        mtimeMs = null;
      }
    }
    const etag = makeConfigEtag(deps.startupEpoch, mtimeMs);
    res.set('ETag', etag);
    res.json({
      packageConfigFilePath: packagePath,
      overrideConfigFilePath: overridePath,
      // `configFilePath` kept as an alias for the override path for one
      // release — old frontends looking for it stay functional.
      configFilePath: overridePath,
      writable,
      mtimeMs,
      systemdManaged: isSystemdManaged(),
      startupEpoch: deps.startupEpoch,
      apiKeySet: !!deps.runtimeConfig?.apiKey,
      adminPasswordSet: !!deps.runtimeConfig?.adminPassword,
      mcpHttpEnabled: !!deps.runtimeConfig?.enableMcpHttp,
      mcpHttpLive: isMcpHttpEnabled(),
      mcpHttpSessions: activeMcpSessionCount(),
      // TCP-based disk serving (WebSocket FDC transport). On by default;
      // only an explicit false in the config disables it.
      wsTransportEnabled: deps.runtimeConfig?.enableWsTransport !== false,
      wsTransportConnected: deps.wsTransport?.isOpen() ?? false,
      configReadonly: deps.configReadonly,
      etag,
    });
  });

  /**
   * @openapi
   * /api/config/web/apikey:
   *   get:
   *     tags: [Config]
   *     summary: Reveal the current API key (plaintext)
   *     description: |
   *       Returns the configured `apiKey` verbatim so an authenticated
   *       operator can copy it back out at any time (password managers,
   *       MCP client config, curl scripts). Unlike `adminPassword` — which
   *       is bcrypt-hashed and unrecoverable — the API key is stored as
   *       plaintext, so it can be read back. Protected by the same
   *       session-or-Bearer auth as every other `/api/*` route, so only an
   *       authenticated admin can reach it. Returns `{ apiKey: null }` when
   *       no key is set.
   *     responses:
   *       200: { description: The current API key (or null if unset) }
   */
  router.get('/api/config/web/apikey', (_req: Request, res: Response) => {
    res.json({ apiKey: deps.runtimeConfig?.apiKey ?? null });
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
    const overridePath = deps.overrideConfigFilePath;
    if (!overridePath) {
      res.status(409).json({ error: 'No override file path configured — nothing to reload.' });
      return;
    }
    try {
      // Compute the effective (baseline + current override on disk) so
      // runtime-toggleable knobs pick up an override that's been re-saved
      // as well as any admin edit to the baseline since startup.
      let overrideOnDisk: Record<string, unknown> = {};
      try {
        const raw = await fs.readFile(overridePath, 'utf-8');
        overrideOnDisk = JSON.parse(raw);
      } catch (err) {
        // ENOENT is fine — no override yet, effective == baseline.
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
      const baseline = (deps.baselineConfig ?? {}) as Record<string, unknown>;
      const effective = { ...baseline, ...overrideOnDisk };
      const applied: string[] = [];
      if (deps.runtimeConfig) {
        if (typeof effective.verbose === 'boolean' && effective.verbose !== deps.runtimeConfig.verbose) {
          deps.runtimeConfig.verbose = effective.verbose;
          if (deps.server) deps.server.toggleVerbose();
          deps.terminalManager.setVerbose(effective.verbose);
          applied.push('verbose');
        }
        if (typeof effective.debug === 'boolean' && effective.debug !== deps.runtimeConfig.debug) {
          deps.runtimeConfig.debug = effective.debug;
          applied.push('debug');
        }
        if (
          (effective.logFile === null || typeof effective.logFile === 'string') &&
          effective.logFile !== deps.runtimeConfig.logFile
        ) {
          deps.runtimeConfig.logFile = effective.logFile as string | null;
          applied.push('logFile');
        }
      }
      res.json({ success: true, applied });
    } catch (err) {
      log.error(
        { err, route: '/api/config/reload', configFile: overridePath },
        `Config reload failed: ${(err as Error)?.message ?? String(err)}`,
      );
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
    if (!deps.overrideConfigFilePath) {
      res.status(409).json({ error: 'No override file path configured — nothing to roll back.' });
      return;
    }
    try {
      const { config, mtimeMs } = await rollbackConfig(
        deps.overrideConfigFilePath,
        deps.baselineConfig,
      );
      res.set('ETag', makeConfigEtag(deps.startupEpoch, mtimeMs));
      res.json({ success: true, config, mtimeMs, restartRequired: true });
    } catch (err) {
      if (err instanceof ConfigWriteError) {
        const status =
          err.code === 'NOT_WRITABLE' ? 403
          : err.code === 'VALIDATION_FAILED' ? 400
          : err.code === 'NO_CONFIG_FILE' ? 409
          : 500;
        if (status >= 500) {
          log.error(
            { err, route: '/api/config/rollback', code: err.code, configFile: deps.overrideConfigFilePath, issues: err.issues },
            `Config rollback failed (${err.code})`,
          );
        }
        res.status(status).json({ error: err.message, code: err.code, issues: err.issues });
        return;
      }
      log.error(
        { err, route: '/api/config/rollback', configFile: deps.overrideConfigFilePath },
        `Unhandled error on rollback: ${(err as Error)?.message ?? String(err)}`,
      );
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  // -----------------------------------------------------------------------
  // Per-section PUTs
  // -----------------------------------------------------------------------

  registerSectionPut(router, deps, '/api/config/serial', SerialSchema);
  registerWebConfigPut(router, deps);
  registerSectionPut(router, deps, '/api/config/terminal', TerminalSchema);
  registerSectionPut(router, deps, '/api/config/logging', LoggingSchema);
  registerSectionPut(router, deps, '/api/config/data', DataSchema);

  // MCP HTTP: dedicated handler because it takes effect live (no restart)
  // and refuses to enable when no api key is set.
  registerMcpConfigPut(router, deps);

  // Disk serving (WS/TCP transport): dedicated handler — applied live,
  // and disabling it drops any active virtual FDC client.
  registerDiskServingConfigPut(router, deps);

  // GPIO comes in as a full { gpioLeds: {...} } shape — the section
  // schema is the inner object, so wrap it here.
  registerSectionPut(router, deps, '/api/config/gpio', z.object({ gpioLeds: GpioSchema }));
}

/**
 * @openapi
 * /api/config/mcp:
 *   put:
 *     tags: [Config]
 *     summary: Toggle MCP-over-HTTP for remote AI clients
 *     description: |
 *       Persists `enableMcpHttp` and flips the runtime guard immediately —
 *       no daemon restart. Refuses to enable when no API key is set (400).
 *       Disabling drops any live MCP sessions.
 */
function registerMcpConfigPut(router: Router, deps: Dependencies): void {
  router.put('/api/config/mcp', async (req: Request, res: Response): Promise<void> => {
    if (deps.configReadonly) {
      res.status(423).json({
        error: 'Config is read-only (--config-readonly).',
        code: 'CONFIG_READONLY',
      });
      return;
    }
    const parseResult = McpSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Invalid config payload',
        issues: parseResult.error.issues.map(i => ({ path: i.path, message: i.message })),
      });
      return;
    }
    const wantEnabled = parseResult.data.enableMcpHttp;
    if (wantEnabled && !deps.runtimeConfig?.apiKey) {
      res.status(400).json({
        error: 'Set an API key in Web & API before enabling MCP over HTTP.',
        code: 'MCP_REQUIRES_API_KEY',
      });
      return;
    }
    if (!deps.overrideConfigFilePath) {
      res.status(409).json({
        error:
          'No override file path configured; the daemon has nowhere to persist runtime changes.',
      });
      return;
    }
    const ifMatch = req.header('if-match');
    if (ifMatch) {
      let currentMtime: number | null = null;
      try {
        currentMtime = (await fs.stat(deps.overrideConfigFilePath)).mtimeMs;
      } catch { /* ENOENT / other → treat as mtime 0 */ }
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
    try {
      const { config, mtimeMs } = await writePartialConfig(
        deps.overrideConfigFilePath,
        parseResult.data as any,
        deps.baselineConfig,
      );
      if (deps.runtimeConfig) {
        deps.runtimeConfig.enableMcpHttp = wantEnabled ?? false;
      }
      setMcpHttpEnabled(!!deps.runtimeConfig?.apiKey && !!wantEnabled);
      res.set('ETag', makeConfigEtag(deps.startupEpoch, mtimeMs));
      // restartRequired: false — this section is live-applied.
      res.json({ success: true, config, mtimeMs, restartRequired: false });
    } catch (err) {
      if (err instanceof ConfigWriteError) {
        const status = err.code === 'NOT_WRITABLE' ? 403 : err.code === 'VALIDATION_FAILED' ? 400 : 500;
        if (status >= 500) {
          log.error(
            { err, route: '/api/config/mcp', code: err.code, configFile: deps.overrideConfigFilePath, issues: err.issues },
            `MCP config save failed (${err.code})`,
          );
        }
        res.status(status).json({ error: err.message, code: err.code, issues: err.issues });
        return;
      }
      log.error(
        { err, route: '/api/config/mcp', configFile: deps.overrideConfigFilePath },
        `Unhandled error on /api/config/mcp: ${(err as Error)?.message ?? String(err)}`,
      );
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });
}

/**
 * @openapi
 * /api/config/disk-serving:
 *   put:
 *     tags: [Config]
 *     summary: Toggle TCP-based (WebSocket) disk serving
 *     description: |
 *       Persists `enableWsTransport` and applies it live — no daemon
 *       restart. When disabled, the /fdc-ws upgrade endpoint stops
 *       accepting virtual FDC clients (403) and any client currently
 *       connected is dropped. On by default: an absent field is treated
 *       as enabled.
 */
function registerDiskServingConfigPut(router: Router, deps: Dependencies): void {
  router.put('/api/config/disk-serving', async (req: Request, res: Response): Promise<void> => {
    if (deps.configReadonly) {
      res.status(423).json({
        error: 'Config is read-only (--config-readonly).',
        code: 'CONFIG_READONLY',
      });
      return;
    }
    const parseResult = DiskServingSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Invalid config payload',
        issues: parseResult.error.issues.map(i => ({ path: i.path, message: i.message })),
      });
      return;
    }
    if (!deps.overrideConfigFilePath) {
      res.status(409).json({
        error:
          'No override file path configured; the daemon has nowhere to persist runtime changes.',
      });
      return;
    }
    const ifMatch = req.header('if-match');
    if (ifMatch) {
      let currentMtime: number | null = null;
      try {
        currentMtime = (await fs.stat(deps.overrideConfigFilePath)).mtimeMs;
      } catch { /* ENOENT / other → treat as mtime 0 */ }
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
    try {
      const { config, mtimeMs } = await writePartialConfig(
        deps.overrideConfigFilePath,
        parseResult.data as any,
        deps.baselineConfig,
      );
      // Live-apply: flip the runtime guard and, when turning the
      // transport off, drop any virtual FDC client that's connected now.
      const wantEnabled = parseResult.data.enableWsTransport;
      if (deps.runtimeConfig && wantEnabled !== undefined) {
        deps.runtimeConfig.enableWsTransport = wantEnabled;
        if (!wantEnabled) {
          deps.wsTransport.closeConnection();
        }
      }
      deps.io.emit('status', getStatus(deps));
      res.set('ETag', makeConfigEtag(deps.startupEpoch, mtimeMs));
      // restartRequired: false — this section is live-applied.
      res.json({ success: true, config, mtimeMs, restartRequired: false });
    } catch (err) {
      if (err instanceof ConfigWriteError) {
        const status = err.code === 'NOT_WRITABLE' ? 403 : err.code === 'VALIDATION_FAILED' ? 400 : 500;
        if (status >= 500) {
          log.error(
            { err, route: '/api/config/disk-serving', code: err.code, configFile: deps.overrideConfigFilePath, issues: err.issues },
            `Disk-serving config save failed (${err.code})`,
          );
        }
        res.status(status).json({ error: err.message, code: err.code, issues: err.issues });
        return;
      }
      log.error(
        { err, route: '/api/config/disk-serving', configFile: deps.overrideConfigFilePath },
        `Unhandled error on /api/config/disk-serving: ${(err as Error)?.message ?? String(err)}`,
      );
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });
}

/**
 * @openapi
 * /api/config/web:
 *   put:
 *     tags: [Config]
 *     summary: Update the Web & API section (includes apiKey and adminPassword)
 *     description: |
 *       Same shape as the other section PUTs, but two fields need
 *       special handling:
 *
 *       - `apiKey` is a machine token; when non-null the value is
 *         written verbatim. Change is applied live (no restart) — the
 *         auth middleware reads apiKey via a runtime callback.
 *       - `adminPassword` is bcrypt-hashed here before the write. Only
 *         the hash reaches disk; the plaintext never persists. Sending
 *         `null` clears the hash; omitting the key leaves it unchanged.
 *         Change is applied live (no restart).
 *
 *       Fields that still require a daemon restart (webPort, webHost,
 *       enabling/disabling the web listener) are surfaced via
 *       `restartRequired: true` in the response. When the patch only
 *       touched auth fields, `restartRequired: false`.
 */
function registerWebConfigPut(router: Router, deps: Dependencies): void {
  const AUTH_ONLY_KEYS = new Set(['apiKey', 'adminPassword']);

  router.put('/api/config/web', async (req: Request, res: Response): Promise<void> => {
    if (deps.configReadonly) {
      res.status(423).json({
        error: 'Config is read-only (--config-readonly).',
        code: 'CONFIG_READONLY',
      });
      return;
    }
    const parseResult = WebSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Invalid config payload',
        issues: parseResult.error.issues.map(i => ({ path: i.path, message: i.message })),
      });
      return;
    }
    const patch: Record<string, unknown> = { ...parseResult.data };

    try {
      if (!deps.overrideConfigFilePath) {
        res.status(409).json({
          error:
            'No override file path configured; the daemon has nowhere to persist runtime changes.',
        });
        return;
      }

      // Pre-hash a non-null, non-empty adminPassword. Empty string is
      // treated as "clear the password" (equivalent to null) — the
      // Config page's optional-string input can't easily send `null`,
      // so we accept the falsy string to keep the frontend simple.
      if (typeof patch.adminPassword === 'string' && patch.adminPassword.length > 0) {
        patch.adminPassword = await hashPassword(patch.adminPassword);
      } else if (patch.adminPassword === '') {
        patch.adminPassword = null;
      }

      const ifMatch = req.header('if-match');
      if (ifMatch) {
        let currentMtime: number | null = null;
        try {
          currentMtime = (await fs.stat(deps.overrideConfigFilePath)).mtimeMs;
        } catch {
          /* ENOENT — override doesn't exist yet, treat as mtime 0 */
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
        deps.overrideConfigFilePath,
        patch as any,
        deps.baselineConfig,
      );

      // Live-apply the auth fields so a caller doesn't need to hit
      // Restart to make the new key / password take effect.
      if (deps.runtimeConfig) {
        if ('apiKey' in patch) deps.runtimeConfig.apiKey = patch.apiKey as string | null;
        if ('adminPassword' in patch) {
          deps.runtimeConfig.adminPassword = patch.adminPassword as string | null;
        }
      }

      // If only auth fields changed, no restart needed. Any other web
      // field still requires one (webPort / webHost / web-enable).
      const touchedKeys = Object.keys(patch);
      const restartRequired = touchedKeys.some(k => !AUTH_ONLY_KEYS.has(k));

      res.set('ETag', makeConfigEtag(deps.startupEpoch, mtimeMs));
      res.json({ success: true, config, mtimeMs, restartRequired });
    } catch (err) {
      if (err instanceof ConfigWriteError) {
        const status = err.code === 'NOT_WRITABLE' ? 403 : err.code === 'VALIDATION_FAILED' ? 400 : 500;
        if (status >= 500) {
          log.error(
            { err, route: '/api/config/web', code: err.code, configFile: deps.overrideConfigFilePath, issues: err.issues },
            `Web config save failed (${err.code})`,
          );
        }
        res.status(status).json({ error: err.message, code: err.code, issues: err.issues });
        return;
      }
      log.error(
        { err, route: '/api/config/web', configFile: deps.overrideConfigFilePath },
        `Unhandled error on /api/config/web: ${(err as Error)?.message ?? String(err)}`,
      );
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });
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
      if (!deps.overrideConfigFilePath) {
        res.status(409).json({
          error:
            'No override file path configured; the daemon has nowhere to persist runtime changes.',
        });
        return;
      }
      // Optional concurrency guard: if the caller sent an If-Match
      // ETag, reject the write when the override has moved on since
      // they last read it (someone else saved / the daemon restarted).
      const ifMatch = req.header('if-match');
      if (ifMatch) {
        let currentMtime: number | null = null;
        try {
          currentMtime = (await fs.stat(deps.overrideConfigFilePath)).mtimeMs;
        } catch {
          /* ENOENT — override doesn't exist yet, treat as mtime 0 */
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
        deps.overrideConfigFilePath,
        parseResult.data as any,
        deps.baselineConfig,
      );
      res.set('ETag', makeConfigEtag(deps.startupEpoch, mtimeMs));
      res.json({ success: true, config, mtimeMs, restartRequired: true });
    } catch (err) {
      if (err instanceof ConfigWriteError) {
        const status = err.code === 'NOT_WRITABLE' ? 403 : err.code === 'VALIDATION_FAILED' ? 400 : 500;
        // Log server-visible internal failures (5xx). 4xx are the caller's
        // fault and we already return a structured payload — no need to
        // spam the journal on every bad request.
        if (status >= 500) {
          log.error(
            { err, route: routePath, code: err.code, configFile: deps.overrideConfigFilePath, issues: err.issues },
            `Config save failed (${err.code}) on ${routePath}`,
          );
        }
        res.status(status).json({ error: err.message, code: err.code, issues: err.issues });
        return;
      }
      // Unknown error — safe message goes to the client, full stack + type
      // go to the log so we can actually diagnose it after the fact.
      log.error(
        { err, route: routePath, configFile: deps.overrideConfigFilePath },
        `Unhandled error on ${routePath}: ${(err as Error)?.message ?? String(err)}`,
      );
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });
}
