/**
 * Security middleware: Helmet, CORS, rate limiting, cookie parsing, auth.
 */

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import * as os from 'os';
import { WebServerConfig } from '../types';
import { createSessionOrBearerAuth } from './auth';
import { SessionStore } from '../services/session-store';
import { SESSION_COOKIE_NAME } from '../routes/auth';

export interface SecurityMiddlewareOptions {
  getApiKey: () => string | null | undefined;
  getAdminPasswordHash: () => string | null | undefined;
  sessionStore: SessionStore;
}

export function setupSecurityMiddleware(
  app: express.Application,
  config: WebServerConfig,
  authOpts: SecurityMiddlewareOptions,
): void {
  // Helmet security headers.
  // HSTS and upgrade-insecure-requests are disabled: this server is intended
  // for LAN / localhost use over plain HTTP. With either enabled, Safari (and
  // some Chrome configurations) try to upgrade subresource URLs to HTTPS,
  // there is no TLS listener, and the page renders empty.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          upgradeInsecureRequests: null,
        },
      },
      hsts: { maxAge: 0 },
      crossOriginEmbedderPolicy: false,
    })
  );

  // CORS
  const allowedOrigins = buildAllowedOrigins(config);
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      // Session cookie needs to flow on cross-origin XHR / fetch. Without
      // this, `credentials: 'include'` on the client is a no-op.
      credentials: true,
    })
  );

  // Rate limiting: general /api/*
  //
  // This is a LAN/localhost appliance (see the Helmet HSTS note above): the
  // operator's browser drives the cockpit from a private address, and a live
  // Run cockpit legitimately polls its instance heartbeat plus bursts a handful
  // of reads on every page load. The old skip exempted ONLY loopback, so an
  // operator on 10.x/192.168.x shared one 200/min bucket across every tab,
  // reload, and reconnect — and when it emptied, the essential GET /api/instances
  // poll 429'd and the cockpit surfaced "too many requests" with no user input.
  // Trust the private LAN (already fully trusted here — auth still applies) and
  // reserve the limiter for routed/public origins, the actual abuse vector.
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    skip: (req) => isTrustedLanIp(req.ip),
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/', apiLimiter);

  // Aggressive rate limit specifically on POST /api/auth/login. The
  // general 200/min limit is far too generous for password guessing,
  // and skip-for-localhost is exactly wrong here — SSH-tunneled brute
  // force lands on 127.0.0.1. Cap 5/min per IP, no skip.
  const loginLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'Too many login attempts. Try again in a minute.',
      code: 'RATE_LIMITED',
    },
  });
  app.use('/api/auth/login', loginLimiter);

  // Cookie parser — must run before the auth middleware so
  // `req.cookies.fdcSession` is populated by the time session lookup happens.
  app.use(cookieParser());

  // Session-or-Bearer auth on /api/*. Bearer-only auth on /mcp/*
  // is wired separately in web-server.ts:setup.
  app.use(
    '/api/',
    createSessionOrBearerAuth({
      getApiKey: authOpts.getApiKey,
      getAdminPasswordHash: authOpts.getAdminPasswordHash,
      sessionStore: authOpts.sessionStore,
      cookieName: SESSION_COOKIE_NAME,
    }),
  );

  // JSON body parser (100 KB default). /mcp is deliberately excluded:
  // write_cpm_file ships file contents as base64 inside the JSON body,
  // so a CP/M file near the disk-size ceiling needs several MB. That
  // route gets its own, much larger limit in web-server.ts. Keeping the
  // tight default everywhere else preserves the small-body guard on the
  // general API surface.
  const generalJson = express.json();
  app.use((req, res, next) => {
    if (req.path === '/mcp' || req.path.startsWith('/mcp/')) {
      next();
      return;
    }
    generalJson(req, res, next);
  });
}

/**
 * True for loopback and private/LAN client addresses — the trusted origins for
 * this appliance. Used to exempt the operator's own network from the general
 * API rate limiter (the strict login limiter deliberately does NOT skip).
 *
 * Covers IPv4 loopback/private/link-local (incl. IPv4-mapped IPv6 like
 * `::ffff:10.1.1.94`) and IPv6 loopback/unique-local/link-local. Anything else
 * — a routed/public address — stays rate limited.
 */
export function isTrustedLanIp(ip: string | undefined): boolean {
  if (!ip) return false;
  // Normalize IPv4-mapped IPv6 (`::ffff:a.b.c.d`) down to the bare IPv4.
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;

  if (v4.includes('.')) {
    const o = v4.split('.').map(Number);
    if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    const [a, b] = o;
    if (a === 127) return true; // loopback 127.0.0.0/8
    if (a === 10) return true; // private 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // private 172.16.0.0/12
    if (a === 192 && b === 168) return true; // private 192.168.0.0/16
    if (a === 169 && b === 254) return true; // link-local 169.254.0.0/16
    return false;
  }

  // IPv6.
  const v6 = ip.toLowerCase();
  if (v6 === '::1') return true; // loopback
  if (v6.startsWith('fe80:')) return true; // link-local fe80::/10
  if (v6.startsWith('fc') || v6.startsWith('fd')) return true; // unique-local fc00::/7
  return false;
}

export function buildAllowedOrigins(config: WebServerConfig): string[] {
  const port = config.port;
  const origins = new Set<string>([
    `http://${config.host}:${port}`,
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ]);

  // Always add the machine's hostname and mDNS alias — users often browse to
  // http://raspberrypi.local:3000/ instead of the numeric IP.
  const host = os.hostname();
  if (host) {
    origins.add(`http://${host}:${port}`);
    if (!host.endsWith('.local')) {
      origins.add(`http://${host}.local:${port}`);
    }
  }

  // When bound to 0.0.0.0 / ::, the server is reachable at every LAN interface.
  // Add each non-internal address so browsers hitting the machine by its LAN
  // IP (e.g. http://10.1.1.94:3000/) pass CORS.
  if (config.host === '0.0.0.0' || config.host === '::' || config.host === '') {
    for (const ifaces of Object.values(os.networkInterfaces())) {
      for (const iface of ifaces ?? []) {
        if (iface.internal) continue;
        const addr = iface.family === 'IPv6' ? `[${iface.address}]` : iface.address;
        origins.add(`http://${addr}:${port}`);
      }
    }
  }

  return [...origins];
}
