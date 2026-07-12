/**
 * Declarative card authoring (Bitsby8 Story 5.4).
 *
 * Create a Card Definition with NO code by choosing a declarative behavior — a
 * memory board (RAM/EPROM) or a CPU board — plus a name and default config. The
 * card registers into the Catalog as `source: 'authored'` (content-addressed
 * like any card) and resolves through the host-synthesized bundle
 * ({@link synthesizeAuthoredBundle}), so it seats on a backplane and runs
 * exactly like a seed card. Custom *code* behavior stays gated for Story 5.5.
 */

import { Dependencies } from '../types';
import { ServiceError } from './service-error';
import {
  registerCardDefinition,
  getCardDefinition,
  CardDefinitionDoc,
  CardManifestInput,
} from './catalog';
import { getSim } from './bundle-registry';
import { CardBehavior } from './authored-bundle';

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9 _.-]{0,63}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const u16 = (n: number) => Number.isInteger(n) && n >= 0 && n <= 0xffff;

export interface AuthorCardInput {
  name: string;
  version?: string;
  maker?: string;
  summary?: string;
  behavior: CardBehavior;
  /** Default config values baked into the card's schema. */
  defaults?: { base?: number; size?: number; resetVector?: number };
}

/** The 8sim-native card type a behavior maps to. */
function typeFor(b: CardBehavior): string {
  return b.resolvesTo === 'cpu' ? 'cpu' : 'memory';
}

/** Generate the config schema for a declarative behavior, seeded with defaults. */
function schemaFor(b: CardBehavior, d: AuthorCardInput['defaults'] = {}): Record<string, unknown> {
  if (b.resolvesTo === 'memory') {
    return {
      base: { type: 'u16', default: d.base ?? 0x0000, min: 0, max: 0xffff, description: 'Start address' },
      size: { type: 'u16', default: d.size ?? 0x1000, min: 1, max: 0xffff, description: 'Region size in bytes' },
    };
  }
  return {
    resetVector: { type: 'u16', default: d.resetVector ?? 0x0000, min: 0, max: 0xffff, description: 'Power-on jump' },
  };
}

function validateBehavior(b: CardBehavior): void {
  if (!b || typeof b !== 'object') throw new ServiceError('behavior is required', 400);
  if (b.resolvesTo === 'memory') {
    if (b.memKind !== 'ram' && b.memKind !== 'rom') {
      throw new ServiceError("memory behavior needs memKind 'ram' or 'rom'", 400);
    }
    return;
  }
  if (b.resolvesTo === 'cpu') {
    if (b.cpuKind !== 'i8080' && b.cpuKind !== 'z80') {
      throw new ServiceError("cpu behavior needs cpuKind 'i8080' or 'z80'", 400);
    }
    return;
  }
  throw new ServiceError(`unknown behavior.resolvesTo: ${JSON.stringify((b as { resolvesTo?: string }).resolvesTo)}`, 400);
}

/** Author a declarative card and register it into the Catalog. */
export async function authorCard(deps: Dependencies, input: AuthorCardInput): Promise<CardDefinitionDoc> {
  const name = (input.name ?? '').trim();
  if (!NAME_RE.test(name)) {
    throw new ServiceError('Card name must be 1–64 chars (letters, digits, space, _ . -)', 400);
  }
  const version = input.version ?? '1.0.0';
  if (!SEMVER.test(version)) throw new ServiceError('Card version must be semver (x.y.z)', 400);
  validateBehavior(input.behavior);

  const d = input.defaults ?? {};
  for (const [k, v] of Object.entries(d)) {
    if (v !== undefined && !u16(v)) throw new ServiceError(`default ${k} must be an integer in 0x0000–0xFFFF`, 400);
  }
  if (input.behavior.resolvesTo === 'memory' && d.size !== undefined && d.size < 1) {
    throw new ServiceError('default size must be at least 1', 400);
  }

  // An authored card must not shadow a built-in seed card of the same Identity.
  const sim = await getSim();
  if (sim.seedBundles.some((s) => `${s.manifest.name}@${s.manifest.version}` === `${name}@${version}`)) {
    throw new ServiceError(`"${name}@${version}" is a built-in seed card; choose another name or version`, 409);
  }

  const manifest: CardManifestInput = {
    name,
    version,
    type: typeFor(input.behavior),
    kind: 'card',
    maker: input.maker?.trim() || 'authored',
    summary: input.summary?.trim() || undefined,
    configSchema: schemaFor(input.behavior, d),
    behavior: input.behavior,
  };

  return registerCardDefinition(deps, { manifest, entry: 'authored', source: 'authored' });
}

/** Delete an authored card (refuses to touch seed/imported cards). */
export async function deleteAuthoredCard(deps: Dependencies, id: string): Promise<void> {
  const doc = await getCardDefinition(deps, id).catch(() => undefined);
  if (!doc) throw new ServiceError(`No such card: ${id}`, 404);
  if (doc.source !== 'authored') {
    throw new ServiceError(`Only authored cards can be deleted (${id} is ${doc.source})`, 409);
  }
  const removed = await deps.database.deleteCardDefinition(id);
  if (!removed) throw new ServiceError(`No such card: ${id}`, 404);
}
