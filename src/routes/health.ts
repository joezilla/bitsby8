import { Router, Request, Response } from 'express';
import { Dependencies } from '../types';
import { getStatus } from '../services/status';

export function registerHealthRoutes(router: Router, deps: Dependencies): void {
  /**
   * @openapi
   * /api/health:
   *   get:
   *     tags: [Health]
   *     summary: Health check
   *     description: Returns server health status and current timestamp.
   *     responses:
   *       200:
   *         description: Server is running
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 status:
   *                   type: string
   *                   example: ok
   *                 timestamp:
   *                   type: string
   *                   format: date-time
   */
  router.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  /**
   * @openapi
   * /api/status:
   *   get:
   *     tags: [Health]
   *     summary: Full server status
   *     description: Returns serial connection state, disk serving state, drive statuses, and timestamp.
   *     responses:
   *       200:
   *         description: Current server status
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 serial:
   *                   type: object
   *                   properties:
   *                     connected:
   *                       type: boolean
   *                     device:
   *                       type: string
   *                       nullable: true
   *                     baudRate:
   *                       type: integer
   *                     configuredPort:
   *                       type: string
   *                     configuredBaudRate:
   *                       type: integer
   *                 diskServing:
   *                   type: object
   *                   properties:
   *                     enabled:
   *                       type: boolean
   *                     running:
   *                       type: boolean
   *                 drives:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/DriveState'
   *                 timestamp:
   *                   type: string
   *                   format: date-time
   */
  router.get('/api/status', (_req: Request, res: Response) => {
    res.json(getStatus(deps));
  });
}
