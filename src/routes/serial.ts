import { Router, Request, Response } from 'express';
import { Dependencies } from '../types';
import { TerminalSerialManager } from '../terminal-serial';
import { BaudRate } from '../protocol';
import { safeErrorMessage } from '../utils/safe-path';
import { broadcastStatus } from '../services/disk-serving';

export function registerSerialRoutes(router: Router, deps: Dependencies): void {
  /**
   * @openapi
   * /api/serial/ports:
   *   get:
   *     tags: [Serial]
   *     summary: List available serial ports
   *     description: Enumerates serial ports on the host, including persistent device paths.
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
  router.get('/api/serial/ports', async (_req: Request, res: Response): Promise<void> => {
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
   * /api/serial/config:
   *   put:
   *     tags: [Serial]
   *     summary: Update primary serial configuration
   *     description: Change the serial device and baud rate for the primary FDC connection. Will close and reopen the port if needed.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [device, baudRate]
   *             properties:
   *               device:
   *                 type: string
   *                 description: Serial port device path
   *                 example: /dev/ttyUSB0
   *               baudRate:
   *                 type: integer
   *                 description: Baud rate
   *                 enum: [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600]
   *     responses:
   *       200:
   *         description: Serial configuration updated
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 serial:
   *                   type: object
   *                   properties:
   *                     device:
   *                       type: string
   *                     baudRate:
   *                       type: integer
   *                     connected:
   *                       type: boolean
   *       400:
   *         description: Missing or invalid parameters
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
  router.put('/api/serial/config', async (req: Request, res: Response): Promise<void> => {
    const { device, baudRate } = req.body || {};

    if (!device) {
      res.status(400).json({ error: 'Device path is required' });
      return;
    }

    const parsedBaud = typeof baudRate === 'string' ? parseInt(baudRate, 10) : baudRate;
    if (!parsedBaud || !Object.values(BaudRate).includes(parsedBaud as BaudRate)) {
      res.status(400).json({ error: 'Valid baudRate is required' });
      return;
    }

    const needsChange =
      !deps.serialManager.isOpen() ||
      deps.serialManager.getDevice() !== device ||
      deps.serialManager.getBaudRate() !== (parsedBaud as BaudRate);

    try {
      if (deps.server) {
        deps.server.pause();
        await new Promise(resolve => setTimeout(resolve, 25));
      }

      if (needsChange) {
        await deps.serialManager.closePort().catch(() => {});
        await deps.serialManager.openPort(device, parsedBaud as BaudRate);
      }

      if (deps.runtimeConfig) {
        deps.runtimeConfig.port = device;
        deps.runtimeConfig.baud = parsedBaud;
      }

      broadcastStatus(deps);

      res.json({
        success: true,
        serial: {
          device,
          baudRate: parsedBaud,
          connected: deps.serialManager.isOpen(),
        },
      });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    } finally {
      if (deps.server) {
        deps.server.resume();
      }
    }
  });
}
