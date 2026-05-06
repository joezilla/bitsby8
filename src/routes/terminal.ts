import { Router, Request, Response } from 'express';
import { Dependencies } from '../types';
import { TerminalSerialManager } from '../terminal-serial';
import { getTerminalStatus } from '../services/status';
import { safeErrorMessage } from '../utils/safe-path';

export function registerTerminalRoutes(router: Router, deps: Dependencies): void {
  /**
   * @openapi
   * /api/terminal/status:
   *   get:
   *     tags: [Terminal]
   *     summary: Get terminal status
   *     description: Returns terminal serial port connection state, device, config, and preferred settings.
   *     responses:
   *       200:
   *         description: Terminal status
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 connected:
   *                   type: boolean
   *                 device:
   *                   type: string
   *                   nullable: true
   *                 config:
   *                   type: object
   *                 preferred:
   *                   type: object
   *                   properties:
   *                     port:
   *                       type: string
   *                     baud:
   *                       type: integer
   */
  router.get('/api/terminal/status', (_req: Request, res: Response) => {
    res.json(getTerminalStatus(deps));
  });

  /**
   * @openapi
   * /api/terminal/ports:
   *   get:
   *     tags: [Terminal]
   *     summary: List serial ports for terminal
   *     description: Enumerates serial ports available for the terminal connection.
   *     responses:
   *       200:
   *         description: List of serial ports
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ports:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/SerialPortInfo'
   *       500:
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  router.get('/api/terminal/ports', async (_req: Request, res: Response): Promise<void> => {
    try {
      const ports = await TerminalSerialManager.listPorts();

      // Format port information for UI
      const formattedPorts = ports.map(port => ({
        path: port.path,
        resolvedPath: port.resolvedPath,
        persistentPaths: port.persistentPaths,
        manufacturer: port.metadata.manufacturer,
        serialNumber: port.metadata.serialNumber,
        pnpId: port.metadata.pnpId,
        vendorId: port.metadata.vendorId,
        productId: port.metadata.productId,
        // Recommend persistent path if available
        recommended: port.persistentPaths.byId || port.persistentPaths.byPath || port.path,
      }));

      res.json({ ports: formattedPorts });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  /**
   * @openapi
   * /api/terminal/open:
   *   post:
   *     tags: [Terminal]
   *     summary: Open terminal serial port
   *     description: Open a serial port for the terminal connection.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [device]
   *             properties:
   *               device:
   *                 type: string
   *                 description: Serial port device path
   *                 example: /dev/ttyUSB1
   *               config:
   *                 type: object
   *                 description: Serial port configuration (baud, dataBits, stopBits, parity)
   *     responses:
   *       200:
   *         description: Port opened
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 device:
   *                   type: string
   *       400:
   *         description: Missing device path
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       500:
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  router.post('/api/terminal/open', async (req: Request, res: Response): Promise<void> => {
    try {
      const { device, config } = req.body;

      if (!device) {
        res.status(400).json({ error: 'Device path is required' });
        return;
      }

      await deps.terminalManager.openPort(device, config);

      // Broadcast terminal status update
      deps.io.emit('terminal:status', getTerminalStatus(deps));

      res.json({ success: true, device });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  /**
   * @openapi
   * /api/terminal/close:
   *   post:
   *     tags: [Terminal]
   *     summary: Close terminal serial port
   *     description: Close the terminal serial port connection.
   *     responses:
   *       200:
   *         description: Port closed
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *       500:
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  router.post('/api/terminal/close', async (_req: Request, res: Response): Promise<void> => {
    try {
      await deps.terminalManager.closePort();

      // Broadcast terminal status update
      deps.io.emit('terminal:status', getTerminalStatus(deps));

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  /**
   * @openapi
   * /api/terminal/config:
   *   put:
   *     tags: [Terminal]
   *     summary: Update terminal configuration
   *     description: Update serial port configuration (baud, data bits, stop bits, parity) for an open terminal connection.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [config]
   *             properties:
   *               config:
   *                 type: object
   *                 description: Serial port configuration
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
   *                 config:
   *                   type: object
   *       400:
   *         description: Missing configuration
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       500:
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  router.put('/api/terminal/config', async (req: Request, res: Response): Promise<void> => {
    try {
      const { config } = req.body;

      if (!config) {
        res.status(400).json({ error: 'Configuration is required' });
        return;
      }

      await deps.terminalManager.updateConfig(config);

      // Broadcast terminal status update
      deps.io.emit('terminal:status', getTerminalStatus(deps));

      res.json({ success: true, config: deps.terminalManager.getConfig() });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });
}
