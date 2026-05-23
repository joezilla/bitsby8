/**
 * Security middleware: Helmet, CORS, rate limiting.
 */

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
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
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'", 'ws:', 'wss:'],
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
  return [
    `http://${config.host}:${config.port}`,
    `http://localhost:${config.port}`,
    `http://127.0.0.1:${config.port}`,
  ];
}
