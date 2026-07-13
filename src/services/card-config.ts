/**
 * Card config validation (Bitsby8 Story 2.4, FR-7) — define-time validation of
 * a Card Instance's settings against its Card Definition's Config Schema.
 *
 * Synchronous and schema-only (no ESM/sim dependency), so the backplane editor
 * and profile save both get immediate, specific errors, and defaults are filled
 * from the schema. This is the define-time complement to the Resolver's
 * run-time `withDefaults` check.
 */

import { Dependencies } from '../types';
import { ServiceError } from './service-error';

export interface ConfigParamSpec {
  type: 'u8' | 'u16' | 'enum' | string;
  default?: number | string;
  min?: number;
  max?: number;
  enum?: ReadonlyArray<number | string>;
  description?: string;
}

export interface ConfigError {
  param: string;
  message: string;
}

export interface ConfigValidation {
  /** The config with schema defaults filled in (only valid when errors is empty). */
  resolved: Record<string, unknown>;
  errors: ConfigError[];
}

const hex = (n: number): string => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`;

function rangeFor(spec: ConfigParamSpec): { min: number; max: number } {
  const width = spec.type === 'u16' ? 0xffff : 0xff;
  return { min: spec.min ?? 0, max: spec.max ?? width };
}

/**
 * Validate `config` against a Config Schema. Returns the defaults-filled
 * `resolved` config plus any `errors` (each naming the parameter and the
 * specific violation). Never throws.
 */
export function validateCardConfig(
  schema: Record<string, ConfigParamSpec>,
  config: Record<string, unknown> = {},
): ConfigValidation {
  const errors: ConfigError[] = [];
  const resolved: Record<string, unknown> = {};

  // Reject settings that aren't in the schema.
  for (const key of Object.keys(config ?? {})) {
    if (!(key in schema)) {
      errors.push({ param: key, message: `Unknown setting "${key}" for this card` });
    }
  }

  for (const [param, spec] of Object.entries(schema)) {
    const provided = config != null && param in config;
    const value = provided ? config[param] : spec.default;

    if (value === undefined || value === null) {
      errors.push({ param, message: `${param} is required` });
      continue;
    }

    if (spec.type === 'enum') {
      const allowed = spec.enum ?? [];
      if (!allowed.includes(value as number | string)) {
        errors.push({ param, message: `${param} must be one of ${allowed.join(', ')} (got ${String(value)})` });
        continue;
      }
      resolved[param] = value;
      continue;
    }

    // Numeric (u8 / u16).
    const { min, max } = rangeFor(spec);
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      errors.push({ param, message: `${param} must be an integer (got ${String(value)})` });
      continue;
    }
    if (value < min || value > max) {
      errors.push({ param, message: `${param} must be in ${hex(min)}–${hex(max)} (got ${hex(value)})` });
      continue;
    }
    resolved[param] = value;
  }

  return { resolved, errors };
}

/**
 * Validate one Card Instance's config against its Card Definition's schema
 * (looked up in the Catalog). Throws a 400 ServiceError with a specific message
 * on any violation, or a 404 if the card isn't in the Catalog. Returns the
 * defaults-filled config.
 */
export async function resolveCardInstanceConfig(
  deps: Dependencies,
  ref: string,
  config: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const rec = await deps.database.getCardDefinitionById(ref);
  if (!rec) {
    throw new ServiceError(`Card "${ref}" is not in the Catalog`, 404, { ref });
  }
  const schema = (JSON.parse(rec.manifest).configSchema ?? {}) as Record<string, ConfigParamSpec>;
  const { resolved, errors } = validateCardConfig(schema, config);
  if (errors.length) {
    throw new ServiceError(
      `Invalid settings for ${ref}: ${errors.map((e) => e.message).join('; ')}`,
      400,
      { ref, errors },
    );
  }
  return resolved;
}

/** Validate a config against a Catalog card's schema WITHOUT throwing on
 * invalid values — returns `{ resolved, errors }` for live UI/agent feedback.
 * Throws 404 only when the card itself isn't in the Catalog. */
export async function checkCardConfig(
  deps: Dependencies,
  ref: string,
  config: Record<string, unknown> = {},
): Promise<ConfigValidation> {
  const rec = await deps.database.getCardDefinitionById(ref);
  if (!rec) throw new ServiceError(`Card "${ref}" is not in the Catalog`, 404, { ref });
  const schema = (JSON.parse(rec.manifest).configSchema ?? {}) as Record<string, ConfigParamSpec>;
  return validateCardConfig(schema, config);
}

/** Validate + resolve every Card Instance in a Profile (order preserved). */
export async function resolveProfileCards(
  deps: Dependencies,
  cards: Array<{ id: string; ref: string; config?: Record<string, unknown> }>,
): Promise<Array<{ id: string; ref: string; config: Record<string, unknown> }>> {
  const out: Array<{ id: string; ref: string; config: Record<string, unknown> }> = [];
  for (const c of cards) {
    if (!c || typeof c.id !== 'string' || typeof c.ref !== 'string') {
      throw new ServiceError('Each card instance needs an id and a ref (name@version)', 400);
    }
    out.push({ id: c.id, ref: c.ref, config: await resolveCardInstanceConfig(deps, c.ref, c.config ?? {}) });
  }
  return out;
}
