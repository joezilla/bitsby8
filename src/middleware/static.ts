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
  // Svelte frontend build output
  const frontendDist = path.resolve(process.cwd(), 'frontend', 'dist');
  const distFrontend = path.resolve(__dirname, '../../frontend/dist');

  let publicDir: string;
  if (existsSync(frontendDist)) {
    publicDir = frontendDist;
  } else {
    publicDir = distFrontend;
  }

  if (existsSync(publicDir)) {
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
