/**
 * Multi-client serving settings (feature flag + write-master) — shared by the
 * REST settings route and the MCP tools. Wraps the DB-backed feature-flags with
 * validation, the toggle-off guard, and the live deps cache update.
 */

import { Dependencies } from '../types';
import {
  getMultiClientServing,
  setMultiClientServing,
  getWriteMaster,
  setWriteMaster,
} from './feature-flags';
import { ServiceError } from './service-error';

export interface MultiClientSettings {
  multiClientServing: boolean;
  writeMaster: string;
}

export async function getMultiClientSettings(deps: Dependencies): Promise<MultiClientSettings> {
  return {
    multiClientServing: await getMultiClientServing(deps.database),
    writeMaster: await getWriteMaster(deps.database),
  };
}

/**
 * Apply a partial settings change. Refuses to disable multi-client serving while
 * more than one client is connected (the operator must disconnect extras first).
 * Updates the DB and the live deps cache. Returns the effective settings.
 */
export async function applyMultiClientSettings(
  deps: Dependencies,
  patch: { multiClientServing?: unknown; writeMaster?: unknown },
): Promise<MultiClientSettings> {
  const { multiClientServing, writeMaster } = patch;
  if (multiClientServing !== undefined && typeof multiClientServing !== 'boolean') {
    throw new ServiceError('multiClientServing must be a boolean', 400);
  }
  if (writeMaster !== undefined && typeof writeMaster !== 'string') {
    throw new ServiceError('writeMaster must be a string', 400);
  }

  if (multiClientServing === false && deps.multiClientServing) {
    const connected = deps.connectionManager?.count() ?? 0;
    if (connected > 1) {
      throw new ServiceError(
        `Cannot disable multi-client serving while ${connected} clients are connected. Disconnect all but one first.`,
        409,
        { code: 'CLIENTS_CONNECTED', connected },
      );
    }
  }

  if (multiClientServing !== undefined) {
    await setMultiClientServing(deps.database, multiClientServing);
    deps.multiClientServing = multiClientServing; // live cache
  }
  if (writeMaster !== undefined) {
    await setWriteMaster(deps.database, writeMaster as string);
    deps.writeMaster = writeMaster as string; // live cache
  }
  return { multiClientServing: deps.multiClientServing, writeMaster: deps.writeMaster };
}
