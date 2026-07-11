/**
 * Instance service (Bitsby8 Story 1.7) — the thin, shared surface over
 * `InstanceManager` consumed by BOTH the REST routes and the MCP tools, so the
 * agentic dev loop (create-transient → console I/O → destroy) and the operator
 * UI drive identical semantics (FR-26/27/28). Adds the availability guard and
 * preset resolution; the manager owns the actual lifecycle.
 */

import { Dependencies } from '../types';
import { ServiceError } from './service-error';
import type { InstanceInfo, InstanceDriver, InstanceManager } from './instance-manager';
import { MachineProfile } from './resolver';
import { getPreset, listPresets, MachinePreset } from './presets';
import { resolveProfileRef } from './profile-service';

function manager(deps: Dependencies): InstanceManager {
  if (!deps.instanceManager) {
    throw new ServiceError('Virtual machine instances are not available', 409);
  }
  return deps.instanceManager;
}

/** What an instance can be created from: a stored Profile, a built-in preset,
 * or an inline MachineProfile. */
export interface InstanceSpecInput {
  /** A stored Machine Profile reference: `name@version`, or a bare name → latest. */
  profileRef?: string;
  /** A built-in machine preset id. */
  preset?: string;
  /** An inline MachineProfile. */
  profile?: MachineProfile;
  /** Launch-time speed override: a Hz number (e.g. 2000000 for authentic 2 MHz) or 'max'. */
  speed?: number | 'max';
}

/** Normalize a speed input (number | 'max' | numeric string) or undefined. */
function normalizeSpeed(speed: unknown): number | 'max' | undefined {
  if (speed === undefined || speed === null) return undefined;
  if (speed === 'max') return 'max';
  const n = typeof speed === 'string' ? Number(speed) : speed;
  if (typeof n === 'number' && Number.isFinite(n) && n > 0) return n;
  throw new ServiceError(`speed must be a positive Hz number or 'max', got ${JSON.stringify(speed)}`, 400);
}

/** Resolve a machine spec from a stored Profile, a preset, or an inline profile. */
async function resolveSpec(
  deps: Dependencies,
  input: InstanceSpecInput,
): Promise<{ profile: MachineProfile; profileRef: string }> {
  if (input.profileRef) {
    const { profile, doc } = await resolveProfileRef(deps, input.profileRef);
    return { profile, profileRef: doc.id };
  }
  if (input.preset) {
    const preset: MachinePreset | undefined = getPreset(input.preset);
    if (!preset) {
      throw new ServiceError(
        `Unknown machine preset: ${input.preset}. Known: ${listPresets().map((p) => p.id).join(', ')}`,
        404,
      );
    }
    return { profile: preset.build(), profileRef: `preset:${preset.id}` };
  }
  if (input.profile) {
    return { profile: input.profile, profileRef: 'inline' };
  }
  throw new ServiceError('A `profileRef`, `preset`, or inline `profile` is required', 400);
}

export function listMachinePresets() {
  return listPresets();
}

export function listInstances(deps: Dependencies): InstanceInfo[] {
  return manager(deps).list();
}

export function getInstance(deps: Dependencies, id: string): InstanceInfo {
  return manager(deps).get(id);
}

export async function createTransientInstance(
  deps: Dependencies,
  input: InstanceSpecInput,
  driver: InstanceDriver,
): Promise<InstanceInfo> {
  const { profile, profileRef } = await resolveSpec(deps, input);
  return manager(deps).createTransient(profile, profileRef, driver, normalizeSpeed(input.speed));
}

export async function defineInstance(
  deps: Dependencies,
  input: InstanceSpecInput,
  driver: InstanceDriver,
): Promise<InstanceInfo> {
  const { profile, profileRef } = await resolveSpec(deps, input);
  return manager(deps).define(profile, profileRef, driver, normalizeSpeed(input.speed));
}

export async function startInstance(deps: Dependencies, id: string): Promise<InstanceInfo> {
  return manager(deps).start(id);
}

export async function stopInstance(deps: Dependencies, id: string): Promise<InstanceInfo> {
  return manager(deps).stop(id);
}

export async function destroyInstance(deps: Dependencies, id: string): Promise<void> {
  return manager(deps).destroy(id);
}

export function writeInstanceConsole(deps: Dependencies, id: string, input: string): void {
  manager(deps).writeConsole(id, input);
}

export function readInstanceConsole(
  deps: Dependencies,
  id: string,
  cursor = 0,
): { data: string; cursor: number } {
  return manager(deps).readConsole(id, cursor);
}
