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
  // Prefer Svelte frontend build (frontend/dist/), fall back to legacy public/
  const frontendDist = path.resolve(process.cwd(), 'frontend', 'dist');
  const repoPublic = path.resolve(process.cwd(), 'public');
  const distPublic = path.resolve(__dirname, '../../public');

  let publicDir: string;
  if (existsSync(frontendDist)) {
    publicDir = frontendDist;
  } else if (existsSync(repoPublic)) {
    publicDir = repoPublic;
  } else {
    publicDir = distPublic;
  }

  if (existsSync(publicDir)) {
    app.use(express.static(publicDir));
  } else {
    console.warn('Warning: public assets directory not found');
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
      res.status(404).send('Web interface not found');
    }
  });
}
