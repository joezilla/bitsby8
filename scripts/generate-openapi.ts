#!/usr/bin/env ts-node
/**
 * Generate OpenAPI spec JSON from JSDoc annotations in routes.
 *
 * Usage:
 *   ts-node scripts/generate-openapi.ts           # write openapi.json at repo root
 *   ts-node scripts/generate-openapi.ts --check   # write to a temp file and diff
 *                                                 # against committed openapi.json;
 *                                                 # exit 1 on drift
 */

import swaggerJsdoc from 'swagger-jsdoc';
import * as fs from 'fs';
import * as path from 'path';
import { openapiDefinition } from '../src/openapi-def';

const check = process.argv.includes('--check');
const committedPath = path.resolve(__dirname, '..', 'openapi.json');

const spec = swaggerJsdoc(openapiDefinition) as Record<string, unknown>;
const generated = JSON.stringify(spec, null, 2) + '\n';

if (check) {
  const committed = fs.existsSync(committedPath)
    ? fs.readFileSync(committedPath, 'utf8')
    : null;
  if (committed === null) {
    console.error(`openapi.json is missing at ${committedPath}.`);
    console.error('Run `pnpm docs` and commit the result.');
    process.exit(1);
  }
  if (committed !== generated) {
    console.error('openapi.json is stale relative to route JSDoc.');
    console.error('Run `pnpm docs` and commit the result in the same PR.');
    process.exit(1);
  }
  const paths = spec.paths as Record<string, unknown> | undefined;
  console.log(`openapi.json is up to date (${Object.keys(paths || {}).length} paths).`);
  process.exit(0);
}

fs.writeFileSync(committedPath, generated);
const paths = spec.paths as Record<string, unknown> | undefined;
console.log(`OpenAPI spec written to ${committedPath}`);
console.log(`  ${Object.keys(paths || {}).length} paths documented`);
