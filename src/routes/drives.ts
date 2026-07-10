import { Router, Request, Response } from 'express';
import * as path from 'path';
import { Dependencies } from '../types';
import { safeResolvePath, safeErrorMessage } from '../utils/safe-path';
import { getDrivesStatus } from '../services/status';
import { broadcastStatus } from '../services/disk-serving';
import { commitTransientDrive, saveTransientSnapshot } from '../services/transient-service';
import { ServiceError } from '../services/service-error';
import { MAX_DRIVES } from '../protocol';

export function registerDriveRoutes(router: Router, deps: Dependencies): void {
  /**
   * @openapi
   * /api/drives:
   *   get:
   *     tags: [Drives]
   *     summary: Get drive status
   *     description: Returns mount status, filename, read-only flag, head-loaded state, and current track for each drive.
   *     responses:
   *       200:
   *         description: Array of drive states
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/DriveState'
   */
  router.get('/api/drives', (_req: Request, res: Response) => {
    res.json(getDrivesStatus(deps));
  });

  /**
   * @openapi
   * /api/drives/{id}/mount:
   *   post:
   *     tags: [Drives]
   *     summary: Mount disk image to drive
   *     description: Mount a disk image file onto the specified drive slot.
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *           minimum: 0
   *           maximum: 15
   *         description: Drive number (0-15)
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [filename]
   *             properties:
   *               filename:
   *                 type: string
   *                 description: Disk image filename (in disks directory)
   *                 example: cpm63k.dsk
   *     responses:
   *       200:
   *         description: Drive mounted
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 drive:
   *                   type: integer
   *                 filename:
   *                   type: string
   *       400:
   *         description: Missing filename or invalid drive ID
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
  router.post('/api/drives/:id/mount', async (req: Request, res: Response): Promise<void> => {
    try {
      const driveId = parseInt(req.params.id);
      const { filename } = req.body;

      if (!filename) {
        res.status(400).json({ error: 'Filename is required' });
        return;
      }

      if (driveId < 0 || driveId >= MAX_DRIVES) {
        res.status(400).json({ error: 'Invalid drive ID' });
        return;
      }

      // Validate filename (prevent path traversal)
      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        res.status(400).json({ error: 'Invalid filename' });
        return;
      }

      // Construct full path (symlink-safe)
      const fullPath = safeResolvePath(deps.config.disksDir, filename);
      if (!fullPath) {
        res.status(404).json({ error: 'Disk image not found' });
        return;
      }

      // Mount the drive
      await deps.driveManager.mountDrive(driveId, fullPath);

      // Save to database
      try {
        const readonly = deps.driveManager.isReadOnly(driveId);
        await deps.database.saveDriveAssignment(driveId, filename, readonly);
      } catch (dbError) {
        console.error('Failed to save drive assignment to database:', dbError);
        // Continue anyway - mount succeeded even if DB save failed
      }

      // Broadcast status update
      broadcastStatus(deps);

      res.json({ success: true, drive: driveId, filename });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  /**
   * @openapi
   * /api/drives/{id}/unmount:
   *   post:
   *     tags: [Drives]
   *     summary: Unmount drive
   *     description: Unmount the disk image from the specified drive slot.
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *           minimum: 0
   *           maximum: 15
   *         description: Drive number (0-15)
   *     responses:
   *       200:
   *         description: Drive unmounted
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 drive:
   *                   type: integer
   *       400:
   *         description: Invalid drive ID
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
  router.post('/api/drives/:id/unmount', async (req: Request, res: Response): Promise<void> => {
    try {
      const driveId = parseInt(req.params.id);

      if (driveId < 0 || driveId >= MAX_DRIVES) {
        res.status(400).json({ error: 'Invalid drive ID' });
        return;
      }

      await deps.driveManager.unmountDrive(driveId);

      // Clear from database
      try {
        await deps.database.clearDriveAssignment(driveId);
      } catch (dbError) {
        console.error('Failed to clear drive assignment from database:', dbError);
        // Continue anyway - unmount succeeded even if DB clear failed
      }

      // Broadcast status update
      broadcastStatus(deps);

      res.json({ success: true, drive: driveId });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  /**
   * @openapi
   * /api/drives/{id}/readonly:
   *   put:
   *     tags: [Drives]
   *     summary: Set drive read-only status
   *     description: Toggle write protection on a mounted drive. May remount the file with the correct mode.
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *           minimum: 0
   *           maximum: 15
   *         description: Drive number (0-15)
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [readonly]
   *             properties:
   *               readonly:
   *                 type: boolean
   *                 description: Write-protect the drive
   *     responses:
   *       200:
   *         description: Read-only status updated
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 drive:
   *                   type: integer
   *                 readonly:
   *                   type: boolean
   *       400:
   *         description: Invalid drive ID
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
  router.put('/api/drives/:id/readonly', async (req: Request, res: Response): Promise<void> => {
    try {
      const driveId = parseInt(req.params.id);
      const { readonly } = req.body;

      if (driveId < 0 || driveId >= MAX_DRIVES) {
        res.status(400).json({ error: 'Invalid drive ID' });
        return;
      }

      // Update write protection (may remount file with correct mode)
      await deps.driveManager.writeProtect(driveId, readonly);

      // Update database if drive is mounted
      try {
        const driveState = deps.driveManager.getDriveState(driveId);
        if (driveState && driveState.mounted && driveState.filename) {
          const filename = path.basename(driveState.filename);
          await deps.database.saveDriveAssignment(driveId, filename, readonly);
        }
      } catch (dbError) {
        console.error('Failed to update drive assignment in database:', dbError);
        // Continue anyway - readonly change succeeded even if DB update failed
      }

      // Broadcast status update
      broadcastStatus(deps);

      res.json({ success: true, drive: driveId, readonly });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  /**
   * @openapi
   * /api/drives/{id}/transient/commit:
   *   post:
   *     tags: [Drives]
   *     summary: Commit a transient drive's changes to its master image
   *     description: Writes the copy-on-write scratch back onto the read-only master image. The drive stays mounted and transient. Fails if the drive is not transient-backed or the master is mounted on another drive.
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: Changes committed to the master
   *       400:
   *         description: Invalid drive ID or drive is not transient-backed
   *       409:
   *         description: Master image is mounted on another drive
   */
  router.post('/api/drives/:id/transient/commit', async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await commitTransientDrive(deps, parseInt(req.params.id));
      broadcastStatus(deps);
      res.json({ success: true, ...result });
    } catch (error) {
      if (error instanceof ServiceError) { res.status(error.statusCode).json({ error: error.message }); return; }
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  /**
   * @openapi
   * /api/drives/{id}/transient/save-snapshot:
   *   post:
   *     tags: [Drives]
   *     summary: Save a transient drive's changes as a snapshot
   *     description: Captures the current copy-on-write scratch as a snapshot of the master image, without touching the master.
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: integer
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               label:
   *                 type: string
   *     responses:
   *       200:
   *         description: Snapshot saved
   *       400:
   *         description: Invalid drive ID or drive is not transient-backed
   */
  router.post('/api/drives/:id/transient/save-snapshot', async (req: Request, res: Response): Promise<void> => {
    try {
      const label = typeof req.body?.label === 'string' ? req.body.label : '';
      const snapshot = await saveTransientSnapshot(deps, parseInt(req.params.id), label);
      res.json({ success: true, snapshot });
    } catch (error) {
      if (error instanceof ServiceError) { res.status(error.statusCode).json({ error: error.message }); return; }
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });
}
