/**
 * Built-in preset seeder (Bitsby8 Story 5.2).
 *
 * A preset IS a machine profile marked `source: 'preset'` — a living, editable
 * template. This seeds the built-in presets as profiles on startup (skipping any
 * a user has already edited/renamed, so boot never clobbers their work) and
 * offers reset-to-default, which re-applies the shipped definition in place.
 */

import { Dependencies } from '../types';
import { ServiceError } from './service-error';
import { PRESETS, MachinePreset } from './presets';
import { upsertPresetProfile } from './profile-service';
import { createLogger } from '../logger';

const log = createLogger('preset-seed');

/** Bind a preset's shipped startup disks to its seeded profile (profile_disks). */
async function seedPresetDisks(deps: Dependencies, def: MachinePreset): Promise<void> {
  for (const d of def.disks ?? []) {
    await deps.database.setProfileDisk(def.name, d.drive, d.filename, d.readonly ?? false);
  }
}

/** Seed any built-in preset whose profile name isn't present yet. Non-fatal. */
export async function loadSeedPresets(deps: Dependencies): Promise<number> {
  let n = 0;
  for (const def of PRESETS) {
    const existing = await deps.database.listMachineProfileVersions(def.name).catch(() => []);
    if (existing.length > 0) continue; // already present — don't overwrite on boot
    try {
      await upsertPresetProfile(deps, def.name, def.build(), def.description, def.uppercaseInput ?? false);
      await seedPresetDisks(deps, def);
      n++;
    } catch (err) {
      log.warn(`preset "${def.name}" not seeded: ${(err as Error).message}`);
    }
  }
  if (n) log.info(`seeded ${n} built-in presets`);
  return n;
}

/** Restore a built-in preset (matched by profile name) to its shipped config. */
export async function resetPreset(deps: Dependencies, name: string): Promise<void> {
  const def = PRESETS.find((p) => p.name === name);
  if (!def) throw new ServiceError(`"${name}" is not a built-in preset`, 404);
  await upsertPresetProfile(deps, def.name, def.build(), def.description, def.uppercaseInput ?? false);
  await seedPresetDisks(deps, def);
}

/** Whether a profile name corresponds to a built-in preset (has a reset default). */
export function isBuiltinPreset(name: string): boolean {
  return PRESETS.some((p) => p.name === name);
}
