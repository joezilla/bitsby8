import { Router, Request, Response } from 'express';
import { Dependencies } from '../types';
import { safeErrorMessage } from '../utils/safe-path';
import { getMultiClientServing, setMultiClientServing, getWriteMaster, setWriteMaster } from '../services/feature-flags';

/**
 * Operator-facing runtime settings stored in the DB (not the config file).
 * These apply live and are managed from the UI.
 */
export function registerSettingsRoutes(router: Router, deps: Dependencies): void {
  /**
   * @openapi
   * /api/settings:
   *   get:
   *     tags: [Settings]
   *     summary: Get runtime feature settings
   *     responses:
   *       200:
   *         description: Current runtime settings
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 multiClientServing:
   *                   type: boolean
   *                   description: Multi-client disk serving (concurrent clients + per-client splinters).
   *   put:
   *     tags: [Settings]
   *     summary: Update runtime feature settings
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               multiClientServing:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: Updated settings
   *       400:
   *         description: Invalid payload
   */
  router.get('/api/settings', async (_req: Request, res: Response): Promise<void> => {
    try {
      const multiClientServing = await getMultiClientServing(deps.database);
      const writeMaster = await getWriteMaster(deps.database);
      res.json({ multiClientServing, writeMaster });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  router.put('/api/settings', async (req: Request, res: Response): Promise<void> => {
    try {
      const { multiClientServing, writeMaster } = req.body ?? {};
      if (multiClientServing !== undefined && typeof multiClientServing !== 'boolean') {
        res.status(400).json({ error: 'multiClientServing must be a boolean' });
        return;
      }
      if (writeMaster !== undefined && typeof writeMaster !== 'string') {
        res.status(400).json({ error: 'writeMaster must be a string' });
        return;
      }
      // Guard: refuse to turn multi-client serving OFF while more than one
      // client is connected — the operator must disconnect extras first.
      if (multiClientServing === false && deps.multiClientServing) {
        const connected = deps.connectionManager?.count() ?? 0;
        if (connected > 1) {
          res.status(409).json({
            error: `Cannot disable multi-client serving while ${connected} clients are connected. Disconnect all but one first.`,
            code: 'CLIENTS_CONNECTED',
            connected,
          });
          return;
        }
      }
      if (multiClientServing !== undefined) {
        await setMultiClientServing(deps.database, multiClientServing);
        deps.multiClientServing = multiClientServing; // live cache
      }
      if (writeMaster !== undefined) {
        await setWriteMaster(deps.database, writeMaster);
        deps.writeMaster = writeMaster; // live cache
      }
      res.json({
        success: true,
        multiClientServing: deps.multiClientServing,
        writeMaster: deps.writeMaster,
      });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });
}
