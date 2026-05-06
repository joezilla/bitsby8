import { Router, Request, Response } from 'express';
import { Dependencies } from '../types';
import { safeErrorMessage } from '../utils/safe-path';

export function registerConfigRoutes(router: Router, deps: Dependencies): void {
  /**
   * @openapi
   * /api/config:
   *   get:
   *     tags: [Config]
   *     summary: Get current configuration
   *     description: Returns current runtime configuration including serial, web, terminal, and display options.
   *     responses:
   *       200:
   *         description: Current configuration
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 port:
   *                   type: string
   *                   description: Serial port device path
   *                 baud:
   *                   type: integer
   *                 web:
   *                   type: boolean
   *                 webPort:
   *                   type: integer
   *                 webHost:
   *                   type: string
   *                 terminalPort:
   *                   type: string
   *                 terminalBaud:
   *                   type: integer
   *                 terminalAutoconnect:
   *                   type: boolean
   *                 verbose:
   *                   type: boolean
   *                 debug:
   *                   type: boolean
   *                 logFile:
   *                   type: string
   *                 gpioLeds:
   *                   type: boolean
   */
  router.get('/api/config', (_req: Request, res: Response) => {
    // Return current runtime configuration
    const config: any = {
      // Serial options - use empty string as default
      port: deps.runtimeConfig?.port || '',
      baud: deps.runtimeConfig?.baud,

      // Web interface
      web: deps.runtimeConfig?.web,
      webPort: deps.runtimeConfig?.webPort,
      webHost: deps.runtimeConfig?.webHost,

      // Terminal options
      terminalPort: deps.runtimeConfig?.terminalPort,
      terminalBaud: deps.runtimeConfig?.terminalBaud,
      terminalAutoconnect: deps.runtimeConfig?.terminalAutoconnect,

      // Display options
      verbose: deps.runtimeConfig?.verbose,
      debug: deps.runtimeConfig?.debug,
      logFile: deps.runtimeConfig?.logFile,

      // GPIO LED options
      gpioLeds: deps.runtimeConfig?.gpioLeds,
    };
    res.json(config);
  });

  /**
   * @openapi
   * /api/config:
   *   post:
   *     tags: [Config]
   *     summary: Update configuration
   *     description: Update runtime configuration. Currently only `verbose` takes effect without restart.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               verbose:
   *                 type: boolean
   *                 description: Enable/disable verbose logging
   *     responses:
   *       200:
   *         description: Configuration updated
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 message:
   *                   type: string
   *       500:
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  router.post('/api/config', async (req: Request, res: Response): Promise<void> => {
    try {
      const updates = req.body;

      // Update runtime config if available
      if (deps.runtimeConfig) {
        // Update web options (these can take effect without restart)
        if (updates.verbose !== undefined) {
          deps.runtimeConfig.verbose = updates.verbose;
          if (deps.server) {
            deps.server.toggleVerbose();
          }
          deps.terminalManager.setVerbose(!!updates.verbose);
        }

        // Other options require restart, just notify the user
        // In a real implementation, we'd save to config file here
      }

      res.json({ success: true, message: 'Configuration updated. Some changes may require restart.' });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });
}
