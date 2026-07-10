import { Router, Request, Response } from 'express';
import { Dependencies } from '../types';
import { safeErrorMessage } from '../utils/safe-path';
import { ServiceError } from '../services/service-error';
import {
  listClients,
  setClientName,
  setClientDrive,
  clearClientDrive,
  forgetClient,
} from '../services/client-service';
import { commitClientSplinter, saveClientSplinterSnapshot, saveClientSplinterAsDisk } from '../services/splinter-service';

function sendError(res: Response, error: unknown): void {
  if (error instanceof ServiceError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  res.status(500).json({ error: safeErrorMessage(error) });
}

/**
 * Per-client drive-bay management. Thin HTTP wrappers over client-service, which
 * both these routes and the MCP tools share.
 */
export function registerClientRoutes(router: Router, deps: Dependencies): void {
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
      res.json(await listClients(deps));
    } catch (error) {
      sendError(res, error);
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
      const name = typeof req.body?.name === 'string' ? req.body.name : '';
      await setClientName(deps, req.params.clientId, name);
      res.json({ success: true, clientId: req.params.clientId, name });
    } catch (error) {
      sendError(res, error);
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
      const drive = parseInt(req.params.drive, 10);
      const readonly = !!req.body?.readonly;
      await setClientDrive(deps, req.params.clientId, drive, req.body?.filename, readonly);
      res.json({ success: true, clientId: req.params.clientId, drive, filename: req.body?.filename, readonly });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.delete('/api/clients/:clientId/drives/:drive', async (req: Request, res: Response): Promise<void> => {
    try {
      const drive = parseInt(req.params.drive, 10);
      await clearClientDrive(deps, req.params.clientId, drive);
      res.json({ success: true, clientId: req.params.clientId, drive });
    } catch (error) {
      sendError(res, error);
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
      await forgetClient(deps, req.params.clientId);
      res.json({ success: true, clientId: req.params.clientId });
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * @openapi
   * /api/clients/{clientId}/drives/{drive}/splinter/commit:
   *   post:
   *     tags: [Clients]
   *     summary: Commit a client's splinter back onto its master image (hot-swap)
   *     description: Writes the client's private copy-on-write splinter for this drive back onto the shared master image, then hot-reloads every open handle (operator drives via a swap window, client sessions via resync) so live readers pick up the new contents. Client splinters re-attach by base name, keeping their own writes. Refused only when the base is held read-write by a live master-write path (an operator drive mounted read-write, or the connected master-write client), whose in-flight write would be clobbered.
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
   *       200: { description: Splinter committed to the master; response includes hotSwapped and the reloadedDrives list }
   *       404: { description: No splinter for this client/drive, or master missing }
   *       409: { description: Base is held read-write by a live master-write path }
   */
  router.post('/api/clients/:clientId/drives/:drive/splinter/commit', async (req: Request, res: Response): Promise<void> => {
    try {
      const drive = parseInt(req.params.drive, 10);
      const result = await commitClientSplinter(deps, req.params.clientId, drive);
      res.json({ success: true, ...result });
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * @openapi
   * /api/clients/{clientId}/drives/{drive}/splinter/save-snapshot:
   *   post:
   *     tags: [Clients]
   *     summary: Save a client's splinter as a snapshot of its master
   *     description: Captures the client's current copy-on-write splinter for this drive as a snapshot of the master image, without touching the master or the splinter.
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
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties: { label: { type: string } }
   *     responses:
   *       200: { description: Snapshot saved }
   *       404: { description: No splinter for this client/drive }
   */
  router.post('/api/clients/:clientId/drives/:drive/splinter/save-snapshot', async (req: Request, res: Response): Promise<void> => {
    try {
      const drive = parseInt(req.params.drive, 10);
      const label = typeof req.body?.label === 'string' ? req.body.label : '';
      const snapshot = await saveClientSplinterSnapshot(deps, req.params.clientId, drive, label);
      res.json({ success: true, snapshot });
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * @openapi
   * /api/clients/{clientId}/drives/{drive}/splinter/save-as-disk:
   *   post:
   *     tags: [Clients]
   *     summary: Save a client's splinter as a new named disk image
   *     description: Non-destructive publish — copies the client's copy-on-write splinter for this drive to a new named image in the disk library, without touching the live master. The name is suffixed (-2, -3, …) on collision; the extension defaults to the master's if omitted.
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
   *             required: [name]
   *             properties: { name: { type: string } }
   *     responses:
   *       200: { description: Saved; response includes the new filename }
   *       400: { description: Invalid filename or extension }
   *       404: { description: No splinter for this client/drive }
   */
  router.post('/api/clients/:clientId/drives/:drive/splinter/save-as-disk', async (req: Request, res: Response): Promise<void> => {
    try {
      const drive = parseInt(req.params.drive, 10);
      const name = typeof req.body?.name === 'string' ? req.body.name : '';
      const result = await saveClientSplinterAsDisk(deps, req.params.clientId, drive, name);
      res.json({ success: true, ...result });
    } catch (error) {
      sendError(res, error);
    }
  });
}
