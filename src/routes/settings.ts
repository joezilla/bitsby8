import { Router, Request, Response } from 'express';
import { Dependencies } from '../types';
import { safeErrorMessage } from '../utils/safe-path';
import { getMultiClientServing, setMultiClientServing } from '../services/feature-flags';

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
      res.json({ multiClientServing });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  router.put('/api/settings', async (req: Request, res: Response): Promise<void> => {
    try {
      const value = req.body?.multiClientServing;
      if (typeof value !== 'boolean') {
        res.status(400).json({ error: 'multiClientServing must be a boolean' });
        return;
      }
      await setMultiClientServing(deps.database, value);
      res.json({ success: true, multiClientServing: value });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });
}
