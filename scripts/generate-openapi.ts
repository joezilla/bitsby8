#!/usr/bin/env ts-node
/**
 * Generate OpenAPI spec JSON from JSDoc annotations.
 * Usage: npx ts-node scripts/generate-openapi.ts
 * Output: dist/openapi.json
 */

import swaggerJsdoc from 'swagger-jsdoc';
import * as fs from 'fs';
import * as path from 'path';
import { openapiDefinition } from '../src/openapi-def';

const spec = swaggerJsdoc(openapiDefinition) as Record<string, unknown>;

const outDir = path.resolve(__dirname, '..', 'dist');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const outPath = path.join(outDir, 'openapi.json');
fs.writeFileSync(outPath, JSON.stringify(spec, null, 2));

const paths = spec.paths as Record<string, unknown> | undefined;
console.log(`OpenAPI spec written to ${outPath}`);
console.log(`  ${Object.keys(paths || {}).length} paths documented`);
