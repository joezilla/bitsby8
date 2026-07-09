import { Router, Request, Response } from 'express';
import { Dependencies } from '../types';
import { safeErrorMessage } from '../utils/safe-path';
import {
  SnapshotError,
  createSnapshot,
  listSnapshots,
  rollbackSnapshot,
  deleteSnapshot,
} from '../services/disk-snapshots';

/**
 * Translate a thrown error into an HTTP response. SnapshotError carries an
 * explicit status; anything else is a 500 with a sanitized message.
 */
function sendError(res: Response, error: unknown): void {
  if (error instanceof SnapshotError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  res.status(500).json({ error: safeErrorMessage(error) });
}

export function registerSnapshotRoutes(router: Router, deps: Dependencies): void {
  /**
   * @openapi
   * /api/images/{filename}/snapshots:
   *   get:
   *     tags: [Snapshots]
   *     summary: List snapshots for a disk image
   *     parameters:
   *       - in: path
   *         name: filename
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Snapshots for the disk, newest first
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 snapshots:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/Snapshot'
   *       400:
   *         description: Invalid filename
   *   post:
   *     tags: [Snapshots]
   *     summary: Create a snapshot of a disk image
   *     description: Captures a point-in-time full copy of the disk. Allowed while the disk is mounted.
   *     parameters:
   *       - in: path
   *         name: filename
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               label:
   *                 type: string
   *                 description: Optional human-readable label
   *     responses:
   *       200:
   *         description: Snapshot created
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 snapshot:
   *                   $ref: '#/components/schemas/Snapshot'
   *       404:
   *         description: Disk image not found
   */
  router.get('/api/images/:filename/snapshots', async (req: Request, res: Response): Promise<void> => {
    try {
      const snapshots = await listSnapshots(deps, req.params.filename);
      res.json({ snapshots });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/api/images/:filename/snapshots', async (req: Request, res: Response): Promise<void> => {
    try {
      const label = typeof req.body?.label === 'string' ? req.body.label : '';
      const snapshot = await createSnapshot(deps, req.params.filename, label);
      res.json({ success: true, snapshot });
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * @openapi
   * /api/images/{filename}/snapshots/{id}/restore:
   *   post:
   *     tags: [Snapshots]
   *     summary: Roll a disk image back to a snapshot
   *     description: Overwrites the disk image with the snapshot's contents. Fails if the disk is mounted on any drive.
   *     parameters:
   *       - in: path
   *         name: filename
   *         required: true
   *         schema:
   *           type: string
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Disk image rolled back
   *       404:
   *         description: Disk image or snapshot not found
   *       409:
   *         description: Disk is mounted on a drive
   */
  router.post('/api/images/:filename/snapshots/:id/restore', async (req: Request, res: Response): Promise<void> => {
    try {
      await rollbackSnapshot(deps, req.params.filename, req.params.id);
      res.json({ success: true, filename: req.params.filename, snapshotId: req.params.id });
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * @openapi
   * /api/images/{filename}/snapshots/{id}:
   *   delete:
   *     tags: [Snapshots]
   *     summary: Delete a snapshot
   *     parameters:
   *       - in: path
   *         name: filename
   *         required: true
   *         schema:
   *           type: string
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Snapshot deleted
   *       404:
   *         description: Snapshot not found
   */
  router.delete('/api/images/:filename/snapshots/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      await deleteSnapshot(deps, req.params.filename, req.params.id);
      res.json({ success: true, snapshotId: req.params.id });
    } catch (error) {
      sendError(res, error);
    }
  });
}
