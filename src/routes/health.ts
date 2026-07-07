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
   *                 system:
   *                   type: object
   *                   properties:
   *                     version:
   *                       type: string
   *                       description: Upstream semver of the running build.
   *                     build:
   *                       type: string
   *                       nullable: true
   *                     commit:
   *                       type: string
   *                       nullable: true
   *                     dirty:
   *                       type: boolean
   *                     builtAt:
   *                       type: string
   *                       format: date-time
   *                       nullable: true
   *                     uptimeSeconds:
   *                       type: integer
   *                     latestVersion:
   *                       type: string
   *                       nullable: true
   *                       description: Newest release on GitHub, or null if the poll has not completed.
   *                     latestUrl:
   *                       type: string
   *                       nullable: true
   *                     updateAvailable:
   *                       type: boolean
   *                       description: True when latestVersion is strictly newer than version.
   *                     updateCheckedAt:
   *                       type: string
   *                       format: date-time
   *                       nullable: true
   *                 timestamp:
   *                   type: string
   *                   format: date-time
   */
  router.get('/api/status', (_req: Request, res: Response) => {
    res.json(getStatus(deps));
  });

  /**
   * @openapi
   * /api/auth/info:
   *   get:
   *     tags: [Health]
   *     summary: Auth probe (unauthenticated)
   *     description: |
   *       Whitelisted past the auth middleware so the SPA can discover
   *       what kind of authentication (if any) the daemon requires
   *       before making its first authenticated call. Deliberately
   *       reveals no state beyond the booleans — no key hint, no user
   *       list, no session.
   *
   *       Two distinct booleans because the credentials are
   *       independent:
   *       - `loginRequired: true` when an `adminPassword` is set. The
   *         UI must prompt the operator to log in via
   *         `POST /api/auth/login`.
   *       - `apiKeyRequired: true` when an `apiKey` is set. Machine
   *         clients (MCP over HTTP, curl) must pass
   *         `Authorization: Bearer <apiKey>`.
   *
   *       `authRequired` is retained for one release as a legacy alias
   *       equal to `loginRequired || apiKeyRequired` so the previous
   *       AuthGate contract keeps working across an in-place upgrade.
   *     responses:
   *       200:
   *         description: Credential requirements for this daemon.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 loginRequired: { type: boolean }
   *                 apiKeyRequired: { type: boolean }
   *                 authRequired: { type: boolean, description: Legacy alias — remove after 2.1. }
   */
  router.get('/api/auth/info', (_req: Request, res: Response) => {
    const loginRequired = !!deps.runtimeConfig?.adminPassword;
    const apiKeyRequired = !!deps.runtimeConfig?.apiKey;
    res.json({
      loginRequired,
      apiKeyRequired,
      authRequired: loginRequired || apiKeyRequired,
    });
  });
}
