/**
 * UI auth routes: /api/auth/login, /api/auth/logout, /api/auth/change-password.
 *
 * These are the human side of the auth story. Machines continue to
 * use `Authorization: Bearer <apiKey>` and never touch these endpoints.
 *
 * All three sit in the /api/auth whitelist inside the auth middleware
 * (see src/middleware/auth.ts) so they're reachable without prior
 * authentication — an operator has to be able to log in before they
 * have a session.
 *
 * Cookie:
 *   fdcSession=<random 32-byte base64url>
 *   HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000  (30 days)
 *
 *   `HttpOnly` blocks JS access, so an XSS bug can't exfiltrate the
 *   session token. `SameSite=Lax` mitigates cross-site POSTs (CSRF)
 *   while still letting the operator follow bookmarks / links into
 *   the SPA and land already-authenticated. `Secure` is deliberately
 *   omitted — the daemon speaks plain HTTP on the LAN by design (see
 *   the HSTS-off comment in src/middleware/security.ts).
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Dependencies } from '../types';
import { hashPassword, verifyPassword } from '../services/password';
import { writePartialConfig, ConfigWriteError } from '../services/config-persistence';
import { createLogger } from '../logger';
import { safeErrorMessage } from '../utils/safe-path';

const log = createLogger('routes:auth');

export const SESSION_COOKIE_NAME = 'fdcSession';
const SESSION_COOKIE_MAX_AGE_SEC = 30 * 24 * 60 * 60;

const LoginBody = z.object({
  password: z.string().min(1),
});

const ChangePasswordBody = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

/**
 * Build the Set-Cookie value for a fresh session. Kept as one line
 * of truth so the login and change-password handlers agree on the
 * attributes.
 */
function sessionCookieHeader(sessionId: string): string {
  return (
    `${SESSION_COOKIE_NAME}=${sessionId}` +
    `; HttpOnly` +
    `; SameSite=Lax` +
    `; Path=/` +
    `; Max-Age=${SESSION_COOKIE_MAX_AGE_SEC}`
  );
}

function expiredCookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export function registerAuthRoutes(router: Router, deps: Dependencies): void {
  const { sessionStore } = deps;
  if (!sessionStore) {
    throw new Error('registerAuthRoutes: sessionStore missing from deps');
  }

  /**
   * @openapi
   * /api/auth/login:
   *   post:
   *     tags: [Auth]
   *     summary: Verify the admin password and issue a session cookie
   *     description: |
   *       Body `{ password }`. Compared (bcrypt) against the
   *       `adminPassword` hash in the runtime config. Success sets
   *       `fdcSession=<id>; HttpOnly; SameSite=Lax; Path=/;
   *       Max-Age=2592000` and returns 200. Bad password returns 401.
   *       When no admin password is configured, returns 400 with
   *       `code: LOGIN_NOT_CONFIGURED`.
   *     responses:
   *       200: { description: Session cookie issued }
   *       400: { description: Login not configured (no adminPassword set) }
   *       401: { description: Invalid password }
   */
  router.post('/api/auth/login', async (req: Request, res: Response): Promise<void> => {
    const parseResult = LoginBody.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Body must be { password: string }',
        issues: parseResult.error.issues.map(i => ({ path: i.path, message: i.message })),
      });
      return;
    }

    const passwordHash = deps.runtimeConfig?.adminPassword ?? null;
    if (!passwordHash) {
      res.status(400).json({
        error: 'Login is not configured on this daemon — no admin password has been set.',
        code: 'LOGIN_NOT_CONFIGURED',
      });
      return;
    }

    try {
      const ok = await verifyPassword(parseResult.data.password, passwordHash);
      if (!ok) {
        res.status(401).json({ error: 'Invalid password.' });
        return;
      }
      const sessionId = sessionStore.createSession();
      res.setHeader('Set-Cookie', sessionCookieHeader(sessionId));
      res.json({ success: true });
    } catch (err) {
      log.error(
        { err, route: '/api/auth/login' },
        `Login failed: ${(err as Error)?.message ?? String(err)}`,
      );
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });

  /**
   * @openapi
   * /api/auth/logout:
   *   post:
   *     tags: [Auth]
   *     summary: Destroy the current session
   *     description: |
   *       Reads the session ID from the `fdcSession` cookie, drops it
   *       from the in-memory store, and returns a cleared cookie.
   *       Idempotent: called without a cookie or with a stale one it
   *       still returns 200 so a "logout" click from a browser whose
   *       session already expired doesn't error.
   *     responses:
   *       200: { description: Session cleared }
   */
  router.post('/api/auth/logout', (req: Request, res: Response): void => {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
    const sessionId = cookies?.[SESSION_COOKIE_NAME];
    if (sessionId) sessionStore.destroySession(sessionId);
    res.setHeader('Set-Cookie', expiredCookieHeader());
    res.json({ success: true });
  });

  /**
   * @openapi
   * /api/auth/change-password:
   *   post:
   *     tags: [Auth]
   *     summary: Rotate the admin password
   *     description: |
   *       Requires the current session (auth middleware handles it).
   *       Body `{ oldPassword, newPassword }` — the OLD password must
   *       still verify against the stored hash even though the caller
   *       is already authenticated. This is the mitigation against a
   *       stolen cookie being used to permanently lock the operator
   *       out. On success, the new hash lands in the override config
   *       (via writePartialConfig, so backup rotation applies) and
   *       every OTHER session is destroyed — the calling browser
   *       stays logged in.
   *     responses:
   *       200: { description: Password rotated }
   *       400: { description: Body invalid, or login not configured yet }
   *       401: { description: Old password incorrect }
   */
  router.post('/api/auth/change-password', async (req: Request, res: Response): Promise<void> => {
    const parseResult = ChangePasswordBody.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Body must be { oldPassword, newPassword }',
        issues: parseResult.error.issues.map(i => ({ path: i.path, message: i.message })),
      });
      return;
    }

    if (!deps.overrideConfigFilePath) {
      res.status(409).json({
        error: 'No override file configured; password cannot be persisted.',
      });
      return;
    }

    const currentHash = deps.runtimeConfig?.adminPassword ?? null;
    if (!currentHash) {
      res.status(400).json({
        error:
          'Admin password is not set yet. Use PUT /api/config/web to set it for the first time.',
        code: 'LOGIN_NOT_CONFIGURED',
      });
      return;
    }

    try {
      const ok = await verifyPassword(parseResult.data.oldPassword, currentHash);
      if (!ok) {
        res.status(401).json({ error: 'Old password is incorrect.' });
        return;
      }
      const newHash = await hashPassword(parseResult.data.newPassword);
      const { config } = await writePartialConfig(
        deps.overrideConfigFilePath,
        { adminPassword: newHash },
        deps.baselineConfig,
      );
      // Live-apply to runtime so the next /api/auth/login uses the new
      // hash without needing a daemon restart.
      if (deps.runtimeConfig) {
        deps.runtimeConfig.adminPassword = newHash;
      }
      // Keep the current session; kick every other browser.
      const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
      const currentSessionId = cookies?.[SESSION_COOKIE_NAME];
      if (currentSessionId) {
        sessionStore.destroyAllExcept(currentSessionId);
      } else {
        // No cookie on the caller (they authenticated via Bearer) —
        // just drop every existing session.
        sessionStore.destroyAll();
      }
      res.json({ success: true, mtimeMs: config ? undefined : undefined });
    } catch (err) {
      if (err instanceof ConfigWriteError) {
        const status =
          err.code === 'NOT_WRITABLE' ? 403 : err.code === 'VALIDATION_FAILED' ? 400 : 500;
        if (status >= 500) {
          log.error(
            { err, route: '/api/auth/change-password', code: err.code, issues: err.issues },
            `Password change failed (${err.code})`,
          );
        }
        res.status(status).json({ error: err.message, code: err.code, issues: err.issues });
        return;
      }
      log.error(
        { err, route: '/api/auth/change-password' },
        `Unhandled error on /api/auth/change-password: ${(err as Error)?.message ?? String(err)}`,
      );
      res.status(500).json({ error: safeErrorMessage(err) });
    }
  });
}
