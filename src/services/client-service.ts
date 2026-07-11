/**
 * Per-client drive-bay management — the single source of truth shared by the
 * REST routes (src/routes/clients.ts) and the MCP tools (src/mcp-server.ts).
 *
 * A client's override on a drive wins over the global mount; unset drives
 * inherit the global mount. The DB stores the image basename (so cascades match
 * by name); the in-memory ClientMountRegistry holds the absolute path (what a
 * DriveSession opens). Only meaningful when multi-client serving is enabled, but
 * the config is editable regardless (pre-provisioning).
 */

import * as path from 'path';
import { Dependencies } from '../types';
import { safeResolvePath } from '../utils/safe-path';
import { getClientMountRegistry } from '../client-mount-registry';
import { getMountRegistry } from '../mount-registry';
import { ServiceError } from './service-error';

/** Per-client bays mirror the operator UI's four drive slots. */
export const CLIENT_BAYS = 4;

function assertClientId(id: string): void {
  if (!id || id.includes('/') || id.includes('\\') || id.includes('..')) {
    throw new ServiceError('Invalid client id', 400);
  }
}

function assertDrive(drive: number): void {
  if (isNaN(drive) || drive < 0 || drive >= CLIENT_BAYS) {
    throw new ServiceError('Invalid drive', 400);
  }
}

export interface ClientDriveInfo {
  drive: number;
  filename: string | null;
  readonly: boolean;
  source: 'override' | 'global' | 'none';
  dirty: boolean;
}

export interface ClientInfo {
  clientId: string;
  name: string;
  connected: boolean;
  connectedAt: number | null;
  isMaster: boolean;
  hasSplinters: boolean;
  drives: ClientDriveInfo[];
}

async function buildClient(
  deps: Dependencies,
  clientId: string,
  connected: { id: string; connectedAt: number } | null,
): Promise<ClientInfo> {
  const label = await deps.database.getClientLabel(clientId);
  const overrides = await deps.database.listClientMounts(clientId);
  const overrideByDrive = new Map(overrides.map((o) => [o.drive, o]));
  const splinters = await deps.database.listClientSplinters();
  const dirtyByDrive = new Map(
    splinters.filter((s) => s.client_id === clientId).map((s) => [s.drive, s.dirty === 1]),
  );

  const global = getMountRegistry();
  const drives: ClientDriveInfo[] = [];
  for (let d = 0; d < CLIENT_BAYS; d++) {
    const ov = overrideByDrive.get(d);
    const g = global.get(d);
    if (ov) {
      drives.push({ drive: d, filename: ov.filename, readonly: ov.readonly === 1, source: 'override', dirty: dirtyByDrive.get(d) ?? false });
    } else if (g) {
      drives.push({ drive: d, filename: path.basename(g.filename), readonly: g.readonly, source: 'global', dirty: dirtyByDrive.get(d) ?? false });
    } else {
      drives.push({ drive: d, filename: null, readonly: false, source: 'none', dirty: false });
    }
  }

  return {
    clientId,
    name: label?.name ?? '',
    connected: connected !== null,
    connectedAt: connected?.connectedAt ?? null,
    isMaster: clientId === deps.writeMaster,
    hasSplinters: dirtyByDrive.size > 0,
    drives,
  };
}

/** Known (DB) + connected clients with per-drive effective mounts. */
export async function listClients(deps: Dependencies): Promise<{ clients: ClientInfo[]; anonymous: { id: string; connectedAt: number }[] }> {
  const connected = deps.connectionManager?.list() ?? [];
  const connectedById = new Map<string, { id: string; connectedAt: number }>();
  for (const c of connected) {
    if (c.clientId) connectedById.set(c.clientId, { id: c.id, connectedAt: c.connectedAt });
  }
  const known = await deps.database.listKnownClientIds();
  const ids = Array.from(new Set([...known, ...connectedById.keys()])).sort();

  const clients = await Promise.all(ids.map((id) => buildClient(deps, id, connectedById.get(id) ?? null)));
  const anonymous = connected.filter((c) => !c.clientId).map((c) => ({ id: c.id, connectedAt: c.connectedAt }));
  return { clients, anonymous };
}

/** Set a client's friendly name. */
export async function setClientName(deps: Dependencies, clientId: string, name: string): Promise<void> {
  assertClientId(clientId);
  await deps.database.setClientLabel(clientId, name);
}

/** Set a client's per-drive mount override. Validates the image exists. */
export async function setClientDrive(deps: Dependencies, clientId: string, drive: number, filename: string, readonly: boolean): Promise<void> {
  assertClientId(clientId);
  assertDrive(drive);
  if (!filename || typeof filename !== 'string' || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    throw new ServiceError('Invalid filename', 400);
  }
  const full = safeResolvePath(deps.config.disksDir, filename);
  if (!full) throw new ServiceError('Disk image not found', 404);

  await deps.database.setClientMount(clientId, drive, filename, readonly); // basename in DB
  getClientMountRegistry().set(clientId, drive, full, readonly);           // absolute path in registry
  await deps.connectionManager?.syncClient(clientId);
}

/** Clear a client's per-drive override (fall back to the global mount). */
export async function clearClientDrive(deps: Dependencies, clientId: string, drive: number): Promise<void> {
  assertClientId(clientId);
  assertDrive(drive);
  await deps.database.deleteClientMount(clientId, drive);
  getClientMountRegistry().clear(clientId, drive);
  await deps.connectionManager?.syncClient(clientId);
}

/** Forget a client: clear its splinters (blobs + rows), overrides, and name. */
export async function forgetClient(deps: Dependencies, clientId: string): Promise<void> {
  assertClientId(clientId);
  const splinters = (await deps.database.listClientSplinters()).filter((s) => s.client_id === clientId);
  const fsp = await import('fs/promises');
  await Promise.all(splinters.map((s) => fsp.unlink(s.path).catch(() => { /* best-effort */ })));
  for (const s of splinters) await deps.database.deleteClientSplinter(clientId, s.drive);

  await deps.database.deleteClientMountsForClient(clientId);
  await deps.database.deleteClientLabel(clientId);
  getClientMountRegistry().clearClient(clientId);
  await deps.connectionManager?.syncClient(clientId);
}
