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

function manager(deps: Dependencies): InstanceManager {
  if (!deps.instanceManager) {
    throw new ServiceError('Virtual machine instances are not available', 409);
  }
  return deps.instanceManager;
}

/** Resolve a machine spec from either a preset id or an inline MachineProfile. */
function resolveSpec(input: { preset?: string; profile?: MachineProfile }): {
  profile: MachineProfile;
  profileRef: string;
} {
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
  throw new ServiceError('A machine `preset` or `profile` is required', 400);
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
  input: { preset?: string; profile?: MachineProfile },
  driver: InstanceDriver,
): Promise<InstanceInfo> {
  const { profile, profileRef } = resolveSpec(input);
  return manager(deps).createTransient(profile, profileRef, driver);
}

export async function defineInstance(
  deps: Dependencies,
  input: { preset?: string; profile?: MachineProfile },
  driver: InstanceDriver,
): Promise<InstanceInfo> {
  const { profile, profileRef } = resolveSpec(input);
  return manager(deps).define(profile, profileRef, driver);
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
