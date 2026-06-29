import { Router, Request, Response } from 'express';
import { Dependencies } from '../types';
import { safeResolvePath, safeErrorMessage } from '../utils/safe-path';
import { startRawReplay, startXmodemSend } from '../services/transfer';

export function registerReplayRoutes(router: Router, deps: Dependencies): void {
  /**
   * @openapi
   * /api/replay/start:
   *   post:
   *     tags: [Replay]
   *     summary: Start replay or XMODEM send
   *     description: Start a raw text replay or XMODEM binary transfer of a script file over the terminal serial port.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [scriptName]
   *             properties:
   *               scriptName:
   *                 type: string
   *                 description: Script filename to send
   *               mode:
   *                 type: string
   *                 enum: [raw, xmodem]
   *                 default: raw
   *                 description: Transfer mode
   *               chunkSize:
   *                 type: integer
   *                 description: Bytes per chunk (raw mode)
   *               interByteDelayMs:
   *                 type: integer
   *                 description: Delay between bytes in ms (raw mode)
   *               interLineDelayMs:
   *                 type: integer
   *                 description: Delay between lines in ms (raw mode)
   *               lineEnding:
   *                 type: string
   *                 enum: [cr, lf, crlf, raw]
   *                 description: Line ending conversion (raw mode)
   *               useCrc:
   *                 type: boolean
   *                 description: Use CRC-16 instead of checksum (xmodem mode)
   *     responses:
   *       200:
   *         description: Transfer started
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 mode:
   *                   type: string
   *                 scriptName:
   *                   type: string
   *       400:
   *         description: Missing scriptName or invalid name
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       404:
   *         description: Script file not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       409:
   *         description: Transfer already in progress
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
  router.post('/api/replay/start', async (req: Request, res: Response): Promise<void> => {
    try {
      const { scriptName, mode, chunkSize, interByteDelayMs, interLineDelayMs, lineEnding, useCrc } = req.body;

      if (!scriptName) {
        res.status(400).json({ error: 'scriptName is required' });
        return;
      }

      // Check for active transfer
      if ((deps.replayEngine && deps.replayEngine.isRunning()) ||
          (deps.xmodemSender && deps.xmodemSender.isRunning())) {
        res.status(409).json({ error: 'A transfer is already in progress' });
        return;
      }

      // Validate filename
      if (scriptName.includes('..') || scriptName.includes('/') || scriptName.includes('\\')) {
        res.status(400).json({ error: 'Invalid script name' });
        return;
      }

      const filePath = safeResolvePath(deps.config.scriptsDir, scriptName);
      if (!filePath) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      if (mode === 'xmodem') {
        startXmodemSend(deps, filePath, scriptName, useCrc);
      } else {
        startRawReplay(deps, filePath, scriptName, chunkSize, interByteDelayMs, interLineDelayMs, lineEnding);
      }

      res.json({ success: true, mode: mode || 'raw', scriptName });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  /**
   * @openapi
   * /api/replay/cancel:
   *   post:
   *     tags: [Replay]
   *     summary: Cancel active transfer
   *     description: Cancel a running raw replay or XMODEM transfer.
   *     responses:
   *       200:
   *         description: Cancel result
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 message:
   *                   type: string
   */
  router.post('/api/replay/cancel', (_req: Request, res: Response) => {
    if (deps.replayEngine && deps.replayEngine.isRunning()) {
      deps.replayEngine.cancel();
      res.json({ success: true, message: 'Replay cancel requested' });
    } else if (deps.xmodemSender && deps.xmodemSender.isRunning()) {
      deps.xmodemSender.cancel();
      res.json({ success: true, message: 'XMODEM cancel requested' });
    } else {
      res.json({ success: true, message: 'No active transfer' });
    }
  });

  /**
   * @openapi
   * /api/replay/status:
   *   get:
   *     tags: [Replay]
   *     summary: Get transfer status
   *     description: Returns whether a transfer is active, its mode, and the last progress update.
   *     responses:
   *       200:
   *         description: Transfer status
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 active:
   *                   type: boolean
   *                 mode:
   *                   type: string
   *                   enum: [raw, xmodem]
   *                 progress:
   *                   nullable: true
   *                   $ref: '#/components/schemas/ReplayProgress'
   */
  router.get('/api/replay/status', (_req: Request, res: Response) => {
    if (deps.replayEngine && deps.replayEngine.isRunning()) {
      res.json({ active: true, mode: 'raw', progress: deps.replayEngine.getLastProgress() });
    } else if (deps.xmodemSender && deps.xmodemSender.isRunning()) {
      res.json({ active: true, mode: 'xmodem', progress: deps.xmodemSender.getLastProgress() });
    } else {
      // Return last progress if available (for recently completed transfers)
      const lastReplay = deps.replayEngine?.getLastProgress();
      const lastXmodem = deps.xmodemSender?.getLastProgress();
      const lastProgress = lastReplay || lastXmodem;
      res.json({ active: false, progress: lastProgress || null });
    }
  });
}
