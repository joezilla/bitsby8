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
import { getSim, listKernels } from './bundle-registry';
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
  /** Default config values baked into the card's schema (keys depend on the kind). */
  defaults?: Record<string, number | string>;
}

/** What an authored behavior resolves into: its card type, config schema, and
 * the (normalized) behavior to store. For `io` this comes from a host kernel. */
interface AuthoredShape {
  type: string;
  configSchema: Record<string, unknown>;
  behavior: CardBehavior;
}

/** Override a schema's defaults with the user's chosen values (matching keys). */
function withUserDefaults(
  schema: Record<string, unknown>,
  d: Record<string, number | string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, spec] of Object.entries(schema)) {
    out[k] = k in d ? { ...(spec as Record<string, unknown>), default: d[k] } : spec;
  }
  return out;
}

/** Resolve a behavior to its card shape — declarative (memory/cpu) or kernel-backed (io). */
async function shapeFor(b: CardBehavior, d: Record<string, number | string>): Promise<AuthoredShape> {
  if (!b || typeof b !== 'object') throw new ServiceError('behavior is required', 400);

  if (b.resolvesTo === 'memory') {
    if (b.memKind !== 'ram' && b.memKind !== 'rom') {
      throw new ServiceError("memory behavior needs memKind 'ram' or 'rom'", 400);
    }
    if (d.size !== undefined && (typeof d.size !== 'number' || d.size < 1)) {
      throw new ServiceError('default size must be at least 1', 400);
    }
    return {
      type: 'memory',
      configSchema: {
        base: { type: 'u16', default: numDefault(d.base, 0x0000), min: 0, max: 0xffff, description: 'Start address' },
        size: { type: 'u16', default: numDefault(d.size, 0x1000), min: 1, max: 0xffff, description: 'Region size in bytes' },
      },
      behavior: b,
    };
  }

  if (b.resolvesTo === 'cpu') {
    if (b.cpuKind !== 'i8080' && b.cpuKind !== 'z80') {
      throw new ServiceError("cpu behavior needs cpuKind 'i8080' or 'z80'", 400);
    }
    return {
      type: 'cpu',
      configSchema: {
        resetVector: { type: 'u16', default: numDefault(d.resetVector, 0x0000), min: 0, max: 0xffff, description: 'Power-on jump' },
      },
      behavior: b,
    };
  }

  if (b.resolvesTo === 'io') {
    const kernel = (await listKernels()).find((k) => k.id === b.kernel);
    if (!kernel) {
      throw new ServiceError(`No behavior kernel "${b.kernel}" — this engine build may be too old`, 400);
    }
    return {
      type: kernel.type,
      configSchema: withUserDefaults(kernel.configSchema, d),
      // Store the kernel id + the endpoint it binds to (Story 5.6/5.7).
      behavior: { resolvesTo: 'io', kernel: kernel.id, binding: kernel.binding },
    };
  }

  throw new ServiceError(`unknown behavior.resolvesTo: ${JSON.stringify((b as { resolvesTo?: string }).resolvesTo)}`, 400);
}

const numDefault = (v: number | string | undefined, fallback: number): number =>
  typeof v === 'number' ? v : fallback;

/** Author a declarative card and register it into the Catalog. */
export async function authorCard(deps: Dependencies, input: AuthorCardInput): Promise<CardDefinitionDoc> {
  const name = (input.name ?? '').trim();
  if (!NAME_RE.test(name)) {
    throw new ServiceError('Card name must be 1–64 chars (letters, digits, space, _ . -)', 400);
  }
  const version = input.version ?? '1.0.0';
  if (!SEMVER.test(version)) throw new ServiceError('Card version must be semver (x.y.z)', 400);

  const d = input.defaults ?? {};
  for (const [k, v] of Object.entries(d)) {
    if (typeof v === 'number' && !u16(v)) {
      throw new ServiceError(`default ${k} must be an integer in 0x0000–0xFFFF`, 400);
    }
  }

  const shape = await shapeFor(input.behavior, d);

  // An authored card must not shadow a built-in seed card of the same Identity.
  const sim = await getSim();
  if (sim.seedBundles.some((s) => `${s.manifest.name}@${s.manifest.version}` === `${name}@${version}`)) {
    throw new ServiceError(`"${name}@${version}" is a built-in seed card; choose another name or version`, 409);
  }

  const manifest: CardManifestInput = {
    name,
    version,
    type: shape.type,
    kind: 'card',
    maker: input.maker?.trim() || 'authored',
    summary: input.summary?.trim() || undefined,
    configSchema: shape.configSchema,
    behavior: shape.behavior,
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
