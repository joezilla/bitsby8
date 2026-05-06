import { Router, Request, Response } from 'express';
import { Dependencies } from '../types';
import { enableDiskServing, disableDiskServing } from '../services/disk-serving';
import { safeErrorMessage } from '../utils/safe-path';

export function registerDiskServingRoutes(router: Router, deps: Dependencies): void {
  /**
   * @openapi
   * /api/disk-serving/enable:
   *   post:
   *     tags: [Disk Serving]
   *     summary: Enable disk serving
   *     description: Start the FDC server to serve disk images over serial. Opens serial port and begins listening for Altair commands.
   *     responses:
   *       200:
   *         description: Disk serving enabled
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 message:
   *                   type: string
   *                 enabled:
   *                   type: boolean
   *       500:
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  router.post('/api/disk-serving/enable', async (_req: Request, res: Response): Promise<void> => {
    try {
      if (deps.diskServingEnabled) {
        res.json({ success: true, message: 'Disk serving is already enabled', enabled: true });
        return;
      }

      await enableDiskServing(deps);
      res.json({ success: true, message: 'Disk serving enabled', enabled: true });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  /**
   * @openapi
   * /api/disk-serving/disable:
   *   post:
   *     tags: [Disk Serving]
   *     summary: Disable disk serving
   *     description: Stop the FDC server and close the primary serial port.
   *     responses:
   *       200:
   *         description: Disk serving disabled
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 message:
   *                   type: string
   *                 enabled:
   *                   type: boolean
   *       500:
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  router.post('/api/disk-serving/disable', async (_req: Request, res: Response): Promise<void> => {
    try {
      if (!deps.diskServingEnabled) {
        res.json({ success: true, message: 'Disk serving is already disabled', enabled: false });
        return;
      }

      await disableDiskServing(deps);
      res.json({ success: true, message: 'Disk serving disabled', enabled: false });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });
}
