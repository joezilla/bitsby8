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
}
