import { Router, Request, Response } from 'express';
import { Dependencies } from '../types';
import { safeErrorMessage } from '../utils/safe-path';
import { getMultiClientSettings, applyMultiClientSettings } from '../services/multi-client-settings';
import { ServiceError } from '../services/service-error';

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
      res.json(await getMultiClientSettings(deps));
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  router.put('/api/settings', async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await applyMultiClientSettings(deps, req.body ?? {});
      res.json({ success: true, ...result });
    } catch (error) {
      if (error instanceof ServiceError) {
        res.status(error.statusCode).json({ error: error.message, ...(error.details ?? {}) });
        return;
      }
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });
}
