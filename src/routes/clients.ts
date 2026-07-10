import { Router, Request, Response } from 'express';
import * as path from 'path';
import { Dependencies } from '../types';
import { safeResolvePath, safeErrorMessage } from '../utils/safe-path';
import { getClientMountRegistry } from '../client-mount-registry';
import { getMountRegistry } from '../mount-registry';

// Per-client bays mirror the operator UI's four drive slots.
const CLIENT_BAYS = 4;

function badClientId(id: string): boolean {
  return !id || id.includes('/') || id.includes('\\') || id.includes('..');
}

/**
 * Per-client drive-bay management. A client's override on a drive wins over the
 * global mount; unset drives inherit global. Only meaningful when multi-client
 * serving is enabled, but the config is editable regardless (pre-provisioning).
 */
export function registerClientRoutes(router: Router, deps: Dependencies): void {
  const clientReg = getClientMountRegistry();

  async function buildClient(clientId: string, connected: { id: string; connectedAt: number } | null) {
    const label = await deps.database.getClientLabel(clientId);
    const overrides = await deps.database.listClientMounts(clientId);
    const overrideByDrive = new Map(overrides.map((o) => [o.drive, o]));
    const splinters = await deps.database.listClientSplinters();
    const dirtyByDrive = new Map(
      splinters.filter((s) => s.client_id === clientId).map((s) => [s.drive, s.dirty === 1]),
    );

    const global = getMountRegistry();
    const drives = [];
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

  /**
   * @openapi
   * /api/clients:
   *   get:
   *     tags: [Clients]
   *     summary: List known + connected clients with their effective drive bays
   *     responses:
   *       200:
   *         description: Clients with per-drive effective mounts
   */
  router.get('/api/clients', async (_req: Request, res: Response): Promise<void> => {
    try {
      const connected = deps.connectionManager?.list() ?? [];
      // Live connections keyed by clientId (anonymous ones have no persistent id).
      const connectedById = new Map<string, { id: string; connectedAt: number }>();
      for (const c of connected) {
        if (c.clientId) connectedById.set(c.clientId, { id: c.id, connectedAt: c.connectedAt });
      }
      const known = await deps.database.listKnownClientIds();
      const ids = Array.from(new Set([...known, ...connectedById.keys()])).sort();

      const clients = await Promise.all(ids.map((id) => buildClient(id, connectedById.get(id) ?? null)));
      // Anonymous live connections (no clientId) surfaced separately.
      const anonymous = connected.filter((c) => !c.clientId).map((c) => ({ id: c.id, connectedAt: c.connectedAt }));
      res.json({ clients, anonymous });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  /**
   * @openapi
   * /api/clients/{clientId}/name:
   *   put:
   *     tags: [Clients]
   *     summary: Set a client's friendly name
   *     parameters:
   *       - in: path
   *         name: clientId
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties: { name: { type: string } }
   *     responses:
   *       200: { description: Name updated }
   */
  router.put('/api/clients/:clientId/name', async (req: Request, res: Response): Promise<void> => {
    try {
      const { clientId } = req.params;
      if (badClientId(clientId)) { res.status(400).json({ error: 'Invalid client id' }); return; }
      const name = typeof req.body?.name === 'string' ? req.body.name : '';
      await deps.database.setClientLabel(clientId, name);
      res.json({ success: true, clientId, name });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  /**
   * @openapi
   * /api/clients/{clientId}/drives/{drive}:
   *   put:
   *     tags: [Clients]
   *     summary: Set a client's per-drive mount override
   *     parameters:
   *       - in: path
   *         name: clientId
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: drive
   *         required: true
   *         schema: { type: integer }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [filename]
   *             properties:
   *               filename: { type: string }
   *               readonly: { type: boolean }
   *     responses:
   *       200: { description: Override set }
   *       404: { description: Image not found }
   *   delete:
   *     tags: [Clients]
   *     summary: Clear a client's per-drive override (inherit global)
   *     parameters:
   *       - in: path
   *         name: clientId
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: drive
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       200: { description: Override cleared }
   */
  router.put('/api/clients/:clientId/drives/:drive', async (req: Request, res: Response): Promise<void> => {
    try {
      const { clientId } = req.params;
      const drive = parseInt(req.params.drive, 10);
      const filename = req.body?.filename;
      const readonly = !!req.body?.readonly;
      if (badClientId(clientId)) { res.status(400).json({ error: 'Invalid client id' }); return; }
      if (isNaN(drive) || drive < 0 || drive >= CLIENT_BAYS) { res.status(400).json({ error: 'Invalid drive' }); return; }
      if (!filename || typeof filename !== 'string' || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        res.status(400).json({ error: 'Invalid filename' }); return;
      }
      const full = safeResolvePath(deps.config.disksDir, filename);
      if (!full) { res.status(404).json({ error: 'Disk image not found' }); return; }

      await deps.database.setClientMount(clientId, drive, filename, readonly); // basename in DB
      clientReg.set(clientId, drive, full, readonly);                          // full path in registry
      await deps.connectionManager?.syncClient(clientId);
      res.json({ success: true, clientId, drive, filename, readonly });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  router.delete('/api/clients/:clientId/drives/:drive', async (req: Request, res: Response): Promise<void> => {
    try {
      const { clientId } = req.params;
      const drive = parseInt(req.params.drive, 10);
      if (badClientId(clientId)) { res.status(400).json({ error: 'Invalid client id' }); return; }
      if (isNaN(drive) || drive < 0 || drive >= CLIENT_BAYS) { res.status(400).json({ error: 'Invalid drive' }); return; }
      await deps.database.deleteClientMount(clientId, drive);
      clientReg.clear(clientId, drive);
      await deps.connectionManager?.syncClient(clientId);
      res.json({ success: true, clientId, drive });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  /**
   * @openapi
   * /api/clients/{clientId}:
   *   delete:
   *     tags: [Clients]
   *     summary: Forget a client (clear its overrides, splinters, and name)
   *     parameters:
   *       - in: path
   *         name: clientId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Client forgotten }
   */
  router.delete('/api/clients/:clientId', async (req: Request, res: Response): Promise<void> => {
    try {
      const { clientId } = req.params;
      if (badClientId(clientId)) { res.status(400).json({ error: 'Invalid client id' }); return; }

      // Remove splinter blobs + rows.
      const splinters = (await deps.database.listClientSplinters()).filter((s) => s.client_id === clientId);
      const fsp = await import('fs/promises');
      await Promise.all(splinters.map((s) => fsp.unlink(s.path).catch(() => { /* best-effort */ })));
      for (const s of splinters) await deps.database.deleteClientSplinter(clientId, s.drive);

      await deps.database.deleteClientMountsForClient(clientId);
      await deps.database.deleteClientLabel(clientId);
      clientReg.clearClient(clientId);
      await deps.connectionManager?.syncClient(clientId);
      res.json({ success: true, clientId });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });
}
