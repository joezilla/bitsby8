/**
 * Two auth middleware factories, split by clientele.
 *
 * `createBearerOnlyAuth` — machine clients. Mounted on `/mcp/*`.
 * Accepts only `Authorization: Bearer <apiKey>`. Deliberately blind
 * to session cookies: browsers on the same origin could otherwise
 * attach the operator's session cookie to a POST to `/mcp` and get
 * bearer-equivalent authority through a CSRF vector.
 *
 * `createSessionOrBearerAuth` — everything on `/api/*`. Accepts EITHER
 * a valid session cookie (looked up in the in-memory SessionStore) OR
 * a valid Bearer API key. The UI uses cookies; curl/scripts use Bearer.
 *
 * Both factories take a `getApiKey` callback so config changes to
 * `apiKey` take effect live, without a daemon restart. The old
 * `restartRequired: true` on apiKey/adminPassword saves is retired
 * once callers switch to these factories.
 *
 * Bearer comparison uses `crypto.timingSafeEqual` — the previous
 * `token !== apiKey` was timing-leaky and made online guessing of the
 * key marginally easier.
 */

import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { SessionStore } from '../services/session-store';

const AUTH_WHITELIST = new Set([
  '/api/auth/info',
  '/api/auth/login',
  '/api/auth/logout',
]);

/**
 * True iff the request should skip auth regardless of the credential
 * configuration — Swagger UI and the auth-info/login/logout endpoints.
 * Login must obviously bypass because it's how you get authenticated
 * in the first place; logout is public so a stale cookie can always
 * clear itself.
 */
function isWhitelisted(req: Request): boolean {
  if (req.path.startsWith('/api/docs')) return true;
  return AUTH_WHITELIST.has(req.path);
}

/**
 * Constant-time compare of two strings. Falls back to `false` when
 * lengths mismatch so `timingSafeEqual` doesn't throw.
 */
function safeTokenEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function checkBearer(req: Request, apiKey: string): boolean {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7);
  return safeTokenEqual(token, apiKey);
}

/**
 * Bearer-only auth. Cookie-authenticated requests are rejected even
 * when a valid session exists, so a browser can't accidentally
 * authenticate to /mcp with the operator's UI session.
 *
 * `getApiKey` is a callback into `deps.runtimeConfig` so key rotations
 * take effect immediately without a restart.
 */
export function createBearerOnlyAuth(getApiKey: () => string | null | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const apiKey = getApiKey();
    if (!apiKey) {
      next();
      return;
    }
    if (checkBearer(req, apiKey)) {
      next();
      return;
    }
    res
      .status(401)
      .json({ error: 'Authentication required. Provide Authorization: Bearer <api-key>' });
  };
}

interface SessionOrBearerOptions {
  getApiKey: () => string | null | undefined;
  getAdminPasswordHash: () => string | null | undefined;
  sessionStore: SessionStore;
  cookieName: string;
}

/**
 * Session-or-Bearer auth for the /api/* mount.
 *
 * If NEITHER an api key NOR an admin password is configured, all
 * requests pass through (dev mode / fresh install).
 *
 * If a valid session cookie is present, allow.
 * Else if a valid Bearer token matches `apiKey`, allow.
 * Else 401.
 *
 * `getAdminPasswordHash` is threaded in so the middleware can tell
 * whether login is configured at all — without a password hash, we
 * shouldn't 401 on cookie-less requests just because someone set an
 * api key for machine access.
 */
export function createSessionOrBearerAuth(opts: SessionOrBearerOptions) {
  const { getApiKey, getAdminPasswordHash, sessionStore, cookieName } = opts;
  return (req: Request, res: Response, next: NextFunction): void => {
    if (isWhitelisted(req)) {
      next();
      return;
    }

    const apiKey = getApiKey() ?? null;
    const passwordHash = getAdminPasswordHash() ?? null;

    // Fully open: no credentials configured. Dev flow.
    if (!apiKey && !passwordHash) {
      next();
      return;
    }

    // Cookie path: any valid session accepts.
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
    const cookieToken = cookies?.[cookieName];
    if (cookieToken && sessionStore.validateSession(cookieToken)) {
      next();
      return;
    }

    // Bearer path: only when an api key is configured.
    if (apiKey && checkBearer(req, apiKey)) {
      next();
      return;
    }

    // If login is configured, prefer the "please log in" wording.
    // Otherwise (apiKey-only mode) point at Bearer.
    const message = passwordHash
      ? 'Authentication required.'
      : 'Authentication required. Provide Authorization: Bearer <api-key>';
    res.status(401).json({ error: message });
  };
}
