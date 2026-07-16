/**
 * Static file serving and Swagger UI middleware.
 */

import express from 'express';
import * as path from 'path';
import { existsSync } from 'fs';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { openapiDefinition } from '../openapi-def';

export function setupStaticMiddleware(app: express.Application): void {
  // Svelte frontend build output.
  //
  // Resolve the bundle RELATIVE TO THE RUNNING BACKEND (__dirname), never the
  // process CWD. The two are the same in every real launch mode:
  //   - installed: /usr/lib/fdcsds/dist/middleware → /usr/lib/fdcsds/frontend/dist
  //   - `pnpm dev` (ts-node): <repo>/src/middleware → <repo>/frontend/dist
  //   - `node dist/index.js`: <repo>/dist/middleware → <repo>/frontend/dist
  // so co-locating guarantees the SPA served always matches the backend serving
  // it. Preferring process.cwd()/frontend/dist (the old behavior) decoupled the
  // two: the systemd unit runs with WorkingDirectory=/var/lib/fdcsds, and if a
  // stale checkout's frontend/dist ever sat in the CWD it would be served over
  // the fresh, co-located bundle — an old SPA against a new backend, reporting a
  // "fresh" build via /api/status (which reads build-info.json __dirname-
  // relative) while actually shipping pre-fix code (e.g. the 15fps monitor REST
  // poll that trips the rate limiter). Co-located is the single source of truth;
  // the CWD path is kept only as a last-resort fallback when it's absent.
  const distFrontend = path.resolve(__dirname, '../../frontend/dist');
  const cwdFrontend = path.resolve(process.cwd(), 'frontend', 'dist');

  let publicDir: string;
  if (existsSync(distFrontend)) {
    publicDir = distFrontend;
  } else {
    publicDir = cwdFrontend;
  }

  if (existsSync(publicDir)) {
    console.log(`Serving frontend from ${publicDir}`);
    app.use(express.static(publicDir));
  } else {
    console.warn('Warning: frontend build not found — run "cd frontend && npm run build"');
  }

  // Swagger UI
  const swaggerSpec = swaggerJsdoc(openapiDefinition);
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get('/api/docs.json', (_req, res) => res.json(swaggerSpec));

  // Serve the web interface (SPA fallback)
  app.get('/', (_req, res) => {
    if (existsSync(publicDir)) {
      res.sendFile(path.join(publicDir, 'index.html'));
    } else {
      res.status(404).send('Web interface not found — run "cd frontend && npm run build"');
    }
  });
}
