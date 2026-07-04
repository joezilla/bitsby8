/**
 * Security middleware: Helmet, CORS, rate limiting.
 */

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import * as os from 'os';
import { WebServerConfig } from '../types';
import { createAuthMiddleware } from './auth';

export function setupSecurityMiddleware(
  app: express.Application,
  config: WebServerConfig,
  apiKey?: string | null
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
    })
  );

  // Rate limiting
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    skip: (req) => req.ip === '127.0.0.1' || req.ip === '::1',
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/', apiLimiter);

  // API key authentication
  app.use('/api/', createAuthMiddleware(apiKey));

  // JSON body parser
  app.use(express.json());
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
