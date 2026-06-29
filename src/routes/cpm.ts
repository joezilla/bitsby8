import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Dependencies } from '../types';
import { safeResolvePath, safeErrorMessage } from '../utils/safe-path';
import { CpmFilesystem } from '../cpm-filesystem';
import { MAX_DRIVES } from '../protocol';

export function registerCpmRoutes(router: Router, deps: Dependencies): void {
  // Helper: validate filename and check disk exists
  const validateDiskFilename = (filename: string, res: Response): string | null => {
    if (!filename) {
      res.status(400).json({ error: 'Filename is required' });
      return null;
    }
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      res.status(400).json({ error: 'Invalid filename' });
      return null;
    }
    const filePath = safeResolvePath(deps.config.disksDir, filename);
    if (!filePath) {
      res.status(404).json({ error: 'Disk image not found' });
      return null;
    }
    return filePath;
  };

  // Helper: check if a disk image is currently mounted on any drive
  const isDiskMounted = (filename: string): number | false => {
    for (let i = 0; i < MAX_DRIVES; i++) {
      const driveState = deps.driveManager.getDriveState(i);
      if (driveState && driveState.mounted && driveState.filename) {
        if (path.basename(driveState.filename) === filename) return i;
      }
    }
    return false;
  };

  // Configure multer for CP/M file uploads (memory storage - small files)
  const cpmUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 256 * 1024 }, // 256KB max (CP/M file limit)
  });

  /**
   * @openapi
   * /api/images/{filename}/cpm/info:
   *   get:
   *     tags: [CP/M]
   *     summary: Get CP/M disk info
   *     description: Returns CP/M disk parameters, free space, file count, and mount status.
   *     parameters:
   *       - in: path
   *         name: filename
   *         required: true
   *         schema:
   *           type: string
   *         description: Disk image filename
   *     responses:
   *       200:
   *         description: CP/M disk information
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 params:
   *                   type: object
   *                   description: CP/M disk parameter block
   *                 freeSpace:
   *                   type: integer
   *                   description: Free space in bytes
   *                 fileCount:
   *                   type: integer
   *                 mounted:
   *                   oneOf:
   *                     - type: integer
   *                     - type: boolean
   *                   description: Drive number if mounted, false otherwise
   *       400:
   *         description: Invalid filename
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       404:
   *         description: Disk image not found
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
  router.get('/api/images/:filename/cpm/info', async (req: Request, res: Response): Promise<void> => {
    try {
      const filePath = validateDiskFilename(req.params.filename, res);
      if (!filePath) return;

      const imageData = await fs.readFile(filePath);
      const cpm = new CpmFilesystem(imageData);
      const params = cpm.getParams();
      const freeSpace = cpm.getFreeSpace();
      const files = cpm.listFiles();

      res.json({
        params,
        freeSpace,
        fileCount: files.length,
        mounted: isDiskMounted(req.params.filename),
      });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  /**
   * @openapi
   * /api/images/{filename}/cpm/files:
   *   get:
   *     tags: [CP/M]
   *     summary: List CP/M files
   *     description: List all files on the CP/M disk image.
   *     parameters:
   *       - in: path
   *         name: filename
   *         required: true
   *         schema:
   *           type: string
   *         description: Disk image filename
   *     responses:
   *       200:
   *         description: List of CP/M files
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 files:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/CpmFileInfo'
   *       400:
   *         description: Invalid filename
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       404:
   *         description: Disk image not found
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
  router.get('/api/images/:filename/cpm/files', async (req: Request, res: Response): Promise<void> => {
    try {
      const filePath = validateDiskFilename(req.params.filename, res);
      if (!filePath) return;

      const imageData = await fs.readFile(filePath);
      const cpm = new CpmFilesystem(imageData);
      const files = cpm.listFiles();

      res.json({
        files: files.map(f => ({
          user: f.user,
          filename: f.filename,
          extension: f.extension,
          size: f.size,
          readonly: f.readonly,
          system: f.system,
          extents: f.extents.length,
        })),
      });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  /**
   * @openapi
   * /api/images/{filename}/cpm/files/{cpmFile}:
   *   get:
   *     tags: [CP/M]
   *     summary: Download a CP/M file
   *     description: Extract and download a single file from the CP/M disk image. The cpmFile param format is "USER:NAME.EXT" (e.g. "0:ASM.COM").
   *     parameters:
   *       - in: path
   *         name: filename
   *         required: true
   *         schema:
   *           type: string
   *         description: Disk image filename
   *       - in: path
   *         name: cpmFile
   *         required: true
   *         schema:
   *           type: string
   *         description: "CP/M file identifier in format USER:NAME.EXT"
   *         example: "0:ASM.COM"
   *     responses:
   *       200:
   *         description: File content
   *         content:
   *           application/octet-stream:
   *             schema:
   *               type: string
   *               format: binary
   *       400:
   *         description: Invalid filename
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       404:
   *         description: Disk image or CP/M file not found
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
  router.get('/api/images/:filename/cpm/files/:cpmFile', async (req: Request, res: Response): Promise<void> => {
    try {
      const filePath = validateDiskFilename(req.params.filename, res);
      if (!filePath) return;

      const parsed = CpmFilesystem.parseFilenameParam(req.params.cpmFile);
      const imageData = await fs.readFile(filePath);
      const cpm = new CpmFilesystem(imageData);
      const fileData = cpm.readFile(parsed.filename, parsed.extension, parsed.user);

      const dlName = `${parsed.filename.trimEnd()}.${parsed.extension.trimEnd()}`;
      res.setHeader('Content-Type', 'application/octet-stream');
      const dlNameAscii = dlName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${dlNameAscii}"; filename*=UTF-8''${encodeURIComponent(dlName)}`
      );
      res.setHeader('Content-Length', fileData.length.toString());
      res.send(fileData);
    } catch (error) {
      if ((error as Error).message.includes('not found')) {
        res.status(404).json({ error: safeErrorMessage(error) });
      } else {
        res.status(500).json({ error: safeErrorMessage(error) });
      }
    }
  });

  /**
   * @openapi
   * /api/images/{filename}/cpm/files:
   *   post:
   *     tags: [CP/M]
   *     summary: Upload file to CP/M disk image
   *     description: Write a file into the CP/M filesystem on the disk image. Fails if the disk is currently mounted. Max 256KB.
   *     parameters:
   *       - in: path
   *         name: filename
   *         required: true
   *         schema:
   *           type: string
   *         description: Disk image filename
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             required: [file]
   *             properties:
   *               file:
   *                 type: string
   *                 format: binary
   *                 description: File to upload
   *               cpmFilename:
   *                 type: string
   *                 description: "Override CP/M filename (format: USER:NAME.EXT)"
   *     responses:
   *       200:
   *         description: File written to disk image
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 filename:
   *                   type: string
   *                 size:
   *                   type: integer
   *       400:
   *         description: No file uploaded or invalid filename
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       404:
   *         description: Disk image not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       409:
   *         description: Disk image is mounted
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
  router.post(
    '/api/images/:filename/cpm/files',
    cpmUpload.single('file'),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const filePath = validateDiskFilename(req.params.filename, res);
        if (!filePath) return;

        // Refuse write if disk is mounted
        const mountedDrive = isDiskMounted(req.params.filename);
        if (mountedDrive !== false) {
          res.status(409).json({
            error: `Cannot modify: disk image is mounted on drive ${mountedDrive}`,
          });
          return;
        }

        if (!req.file) {
          res.status(400).json({ error: 'No file uploaded' });
          return;
        }

        // Use override name from body, or original filename
        const cpmName = (req.body && req.body.cpmFilename) || req.file.originalname;
        const parsed = CpmFilesystem.parseFilenameParam(cpmName);

        const imageData = await fs.readFile(filePath);
        const cpm = new CpmFilesystem(imageData);
        cpm.writeFile(parsed.filename, parsed.extension, req.file.buffer, parsed.user);

        // Write modified image back atomically
        await fs.writeFile(filePath, cpm.getImageData());

        res.json({
          success: true,
          filename: `${parsed.filename.trimEnd()}.${parsed.extension.trimEnd()}`,
          size: req.file.buffer.length,
        });
      } catch (error) {
        res.status(500).json({ error: safeErrorMessage(error) });
      }
    }
  );

  /**
   * @openapi
   * /api/images/{filename}/cpm/files/{cpmFile}:
   *   delete:
   *     tags: [CP/M]
   *     summary: Delete a CP/M file
   *     description: Remove a file from the CP/M filesystem on the disk image. Fails if the disk is currently mounted.
   *     parameters:
   *       - in: path
   *         name: filename
   *         required: true
   *         schema:
   *           type: string
   *         description: Disk image filename
   *       - in: path
   *         name: cpmFile
   *         required: true
   *         schema:
   *           type: string
   *         description: "CP/M file identifier in format USER:NAME.EXT"
   *         example: "0:ASM.COM"
   *     responses:
   *       200:
   *         description: File deleted from disk image
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 filename:
   *                   type: string
   *       400:
   *         description: Invalid filename
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       404:
   *         description: Disk image or CP/M file not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       409:
   *         description: Disk image is mounted
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
  router.delete('/api/images/:filename/cpm/files/:cpmFile', async (req: Request, res: Response): Promise<void> => {
    try {
      const filePath = validateDiskFilename(req.params.filename, res);
      if (!filePath) return;

      // Refuse write if disk is mounted
      const mountedDrive = isDiskMounted(req.params.filename);
      if (mountedDrive !== false) {
        res.status(409).json({
          error: `Cannot modify: disk image is mounted on drive ${mountedDrive}`,
        });
        return;
      }

      const parsed = CpmFilesystem.parseFilenameParam(req.params.cpmFile);
      const imageData = await fs.readFile(filePath);
      const cpm = new CpmFilesystem(imageData);
      cpm.deleteFile(parsed.filename, parsed.extension, parsed.user);

      // Write modified image back atomically
      await fs.writeFile(filePath, cpm.getImageData());

      res.json({
        success: true,
        filename: `${parsed.filename.trimEnd()}.${parsed.extension.trimEnd()}`,
      });
    } catch (error) {
      if ((error as Error).message.includes('not found')) {
        res.status(404).json({ error: safeErrorMessage(error) });
      } else {
        res.status(500).json({ error: safeErrorMessage(error) });
      }
    }
  });
}
