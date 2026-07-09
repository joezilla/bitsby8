import { Router, Request, Response } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import { Dependencies } from '../types';
import { safeResolvePath, safeErrorMessage } from '../utils/safe-path';
import { listDiskImages, listDiskImagesWithDetails } from '../services/file-listing';
import {
  MAX_DISK_IMAGE_SIZE,
  isAllowedDiskImageExtension,
  detectForbiddenMagic,
} from '../utils/disk-image-validation';
import { MAX_DRIVES } from '../protocol';
import { CpmFilesystem, paramsForFormat, inferFormatFromSize } from '../cpm-filesystem';
import { deleteSnapshotsForDisk, renameSnapshotsForDisk } from '../services/disk-snapshots';

export function registerImageRoutes(router: Router, deps: Dependencies): void {
  /**
   * @openapi
   * /api/images:
   *   get:
   *     tags: [Images]
   *     summary: List disk images
   *     description: Returns filenames of all disk images (.dsk, .img, .ima) in the disks directory.
   *     responses:
   *       200:
   *         description: List of disk image filenames
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 images:
   *                   type: array
   *                   items:
   *                     type: string
   *       500:
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  router.get('/api/images', async (_req: Request, res: Response): Promise<void> => {
    try {
      const images = await listDiskImages(deps);
      res.json({ images });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  /**
   * @openapi
   * /api/images/details:
   *   get:
   *     tags: [Images]
   *     summary: List disk images with details
   *     description: Returns all disk images with file size, description, and notes.
   *     responses:
   *       200:
   *         description: Detailed disk image list
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 images:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/DiskImageInfo'
   *       500:
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  router.get('/api/images/details', async (_req: Request, res: Response): Promise<void> => {
    try {
      const images = await listDiskImagesWithDetails(deps);
      res.json({ images });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  // Configure multer for disk image uploads
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, deps.config.disksDir);
    },
    filename: (_req, file, cb) => {
      // Use original filename
      cb(null, file.originalname);
    },
  });

  const upload = multer({
    storage: storage,
    fileFilter: (_req, file, cb) => {
      // Only accept .dsk, .img, .ima files
      if (isAllowedDiskImageExtension(file.originalname)) {
        cb(null, true);
      } else {
        cb(new Error('Only .dsk, .img, and .ima files are allowed'));
      }
    },
    limits: {
      fileSize: MAX_DISK_IMAGE_SIZE,
    },
  });

  /**
   * @openapi
   * /api/images/upload:
   *   post:
   *     tags: [Images]
   *     summary: Upload disk image
   *     description: Upload a disk image file (.dsk, .img, .ima). Max 10MB.
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             required: [diskImage]
   *             properties:
   *               diskImage:
   *                 type: string
   *                 format: binary
   *                 description: Disk image file
   *     responses:
   *       200:
   *         description: Upload successful
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
   *         description: No file or invalid type
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
  const uploadLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    skip: (req) => req.ip === '127.0.0.1' || req.ip === '::1',
  });

  router.post(
    '/api/images/upload',
    uploadLimiter,
    upload.single('diskImage'),
    async (req: Request, res: Response): Promise<void> => {
      try {
        if (!req.file) {
          res.status(400).json({ error: 'No file uploaded' });
          return;
        }

        // Magic bytes check -- reject executables/archives disguised as disk images
        const uploadedPath = path.join(deps.config.disksDir, req.file.filename);
        const fh = await fs.open(uploadedPath, 'r');
        const magicBuf = Buffer.alloc(8);
        await fh.read(magicBuf, 0, 8, 0);
        await fh.close();
        const forbiddenLabel = detectForbiddenMagic(magicBuf);
        if (forbiddenLabel) {
          await fs.unlink(uploadedPath);
          res.status(400).json({ error: `Rejected: file appears to be a ${forbiddenLabel} file` });
          return;
        }

        res.json({
          success: true,
          filename: req.file.filename,
          size: req.file.size,
        });
      } catch (error) {
        res.status(500).json({ error: safeErrorMessage(error) });
      }
    }
  );

  /**
   * @openapi
   * /api/images/{filename}/clone:
   *   post:
   *     tags: [Images]
   *     summary: Clone disk image
   *     description: Create a copy of an existing disk image with a "-copy" suffix.
   *     parameters:
   *       - in: path
   *         name: filename
   *         required: true
   *         schema:
   *           type: string
   *         description: Source disk image filename
   *     responses:
   *       200:
   *         description: Clone successful
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 filename:
   *                   type: string
   *                   description: New filename of the clone
   *       400:
   *         description: Invalid filename
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       404:
   *         description: Source file not found
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
  router.post('/api/images/:filename/clone', async (req: Request, res: Response): Promise<void> => {
    try {
      const filename = req.params.filename;

      if (!filename) {
        res.status(400).json({ error: 'Filename is required' });
        return;
      }

      // Validate filename (prevent path traversal)
      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        res.status(400).json({ error: 'Invalid filename' });
        return;
      }

      const sourcePath = safeResolvePath(deps.config.disksDir, filename);
      if (!sourcePath) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      // Generate new filename
      const ext = path.extname(filename);
      const baseName = path.basename(filename, ext);
      let copyNumber = 1;
      let newFilename = `${baseName}-copy${ext}`;
      let newPath = path.join(deps.config.disksDir, newFilename);

      // Find available filename
      while (existsSync(newPath)) {
        copyNumber++;
        newFilename = `${baseName}-copy${copyNumber}${ext}`;
        newPath = path.join(deps.config.disksDir, newFilename);
      }

      // Copy the file
      await fs.copyFile(sourcePath, newPath);

      res.json({ success: true, filename: newFilename });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  /**
   * @openapi
   * /api/images/create:
   *   post:
   *     tags: [Images]
   *     summary: Create blank disk image
   *     description: Create a new empty disk image in the specified format.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [filename, format, extension]
   *             properties:
   *               filename:
   *                 type: string
   *                 description: Base filename (alphanumeric, underscores, hyphens, periods, spaces)
   *                 example: newdisk
   *               format:
   *                 type: string
   *                 enum: [8inch, minidisk, 8mb]
   *                 description: "Disk format: 8inch = 8-inch floppy (77 tracks, 330K), minidisk = 5.25\" mini-disk (17 tracks, 75K), 8mb = 8 MB hard disk (1863 tracks, ~7.8 MB)"
   *               extension:
   *                 type: string
   *                 enum: [.dsk, .img, .ima]
   *                 description: File extension
   *     responses:
   *       200:
   *         description: Disk image created
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
   *                 format:
   *                   type: string
   *       400:
   *         description: Missing or invalid parameters
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       409:
   *         description: File already exists
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
  router.post('/api/images/create', async (req: Request, res: Response): Promise<void> => {
    try {
      const { filename, format, extension } = req.body;

      // Validate required parameters
      if (!filename || !format || !extension) {
        res.status(400).json({ error: 'Filename, format, and extension are required' });
        return;
      }

      // Validate filename (prevent path traversal, allow only safe characters)
      const safeFilenameRegex = /^[a-zA-Z0-9_\-. ]+$/;
      if (!safeFilenameRegex.test(filename)) {
        res.status(400).json({
          error: 'Invalid filename. Only letters, numbers, spaces, underscores, hyphens, and periods allowed.',
        });
        return;
      }

      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        res.status(400).json({ error: 'Invalid filename' });
        return;
      }

      // Validate extension
      const validExtensions = ['.dsk', '.img', '.ima'];
      if (!validExtensions.includes(extension.toLowerCase())) {
        res.status(400).json({ error: 'Invalid extension. Must be .dsk, .img, or .ima' });
        return;
      }

      const params = paramsForFormat(format);
      if (!params) {
        res.status(400).json({ error: 'Invalid format. Must be 8inch, minidisk, or 8mb' });
        return;
      }

      // Construct full filename and path
      const fullFilename = filename.endsWith(extension) ? filename : `${filename}${extension}`;
      const filePath = path.join(deps.config.disksDir, fullFilename);

      // Check if file already exists
      if (existsSync(filePath)) {
        res.status(409).json({ error: 'File already exists' });
        return;
      }

      // Format a proper MITS 8" style image — correct sector framing,
      // 0xE5-filled data, ready for CP/M to mount and use.
      const image = CpmFilesystem.formatImage(params);
      await fs.writeFile(filePath, image);

      res.json({
        success: true,
        filename: fullFilename,
        size: image.length,
        format,
      });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  /**
   * @openapi
   * /api/images/{filename}:
   *   delete:
   *     tags: [Images]
   *     summary: Delete disk image
   *     description: Delete a disk image file. Fails if the image is currently mounted on any drive.
   *     parameters:
   *       - in: path
   *         name: filename
   *         required: true
   *         schema:
   *           type: string
   *         description: Disk image filename
   *     responses:
   *       200:
   *         description: File deleted
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
   *         description: File not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       409:
   *         description: File is mounted on a drive
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
  /**
   * @openapi
   * /api/images/{filename}/format:
   *   post:
   *     tags: [Images]
   *     summary: Reformat a disk image
   *     description: Erases every byte on the image and lays down a fresh MITS 8" sector layout. Fails if the disk is mounted.
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
   *               format:
   *                 type: string
   *                 enum: [8inch, minidisk, 8mb]
   *                 description: Target format. Omit to derive from the current image size.
   *     responses:
   *       200:
   *         description: Image reformatted
   *       409:
   *         description: Disk is mounted
   */
  router.post('/api/images/:filename/format', async (req: Request, res: Response): Promise<void> => {
    try {
      const filename = req.params.filename;
      if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        res.status(400).json({ error: 'Invalid filename' });
        return;
      }
      const filePath = safeResolvePath(deps.config.disksDir, filename);
      if (!filePath) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      // Refuse if mounted anywhere.
      for (let i = 0; i < MAX_DRIVES; i++) {
        const state = deps.driveManager.getDriveState(i);
        if (state && state.mounted && state.filename && path.basename(state.filename) === filename) {
          res.status(409).json({ error: `Cannot format: image is mounted on drive ${i}` });
          return;
        }
      }

      // Pick format: explicit body wins; otherwise infer from current
      // image size so a reformat on an 8" .dsk keeps its 8" geometry.
      let format: string | undefined = req.body?.format;
      if (!format) {
        const stats = await fs.stat(filePath);
        format = inferFormatFromSize(stats.size) ?? undefined;
      }
      const params = format ? paramsForFormat(format) : null;
      if (!params) {
        res.status(400).json({ error: 'Unknown format. Pass one of: 8inch, minidisk, 8mb' });
        return;
      }

      const image = CpmFilesystem.formatImage(params);
      await fs.writeFile(filePath, image);

      res.json({ success: true, filename, size: image.length, format });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  router.delete('/api/images/:filename', async (req: Request, res: Response): Promise<void> => {
    try {
      const filename = req.params.filename;

      if (!filename) {
        res.status(400).json({ error: 'Filename is required' });
        return;
      }

      // Validate filename (prevent path traversal)
      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        res.status(400).json({ error: 'Invalid filename' });
        return;
      }

      const filePath = safeResolvePath(deps.config.disksDir, filename);
      if (!filePath) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      // Check if the file is currently mounted on any drive
      for (let i = 0; i < MAX_DRIVES; i++) {
        const driveState = deps.driveManager.getDriveState(i);
        if (driveState && driveState.mounted && driveState.filename) {
          const mountedFilename = path.basename(driveState.filename);
          if (mountedFilename === filename) {
            res.status(409).json({
              error: `Cannot delete: File is currently mounted on drive ${i}`,
            });
            return;
          }
        }
      }

      // Delete the file
      await fs.unlink(filePath);

      // Also delete notes from database
      await deps.database.deleteDiskNote(filename);

      // Drop any snapshots of this image so they don't orphan.
      await deleteSnapshotsForDisk(deps, filename);

      // Drop any per-image write policy.
      await deps.database.deleteDiskPolicy(filename);

      res.json({ success: true, filename });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  /**
   * @openapi
   * /api/images/{filename}/notes:
   *   put:
   *     tags: [Images]
   *     summary: Update disk image notes
   *     description: Set or update the description and notes for a disk image.
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
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               description:
   *                 type: string
   *                 description: Short description
   *               notes:
   *                 type: string
   *                 description: Extended notes
   *     responses:
   *       200:
   *         description: Notes updated
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
   *         description: File not found
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
  router.put('/api/images/:filename/notes', async (req: Request, res: Response): Promise<void> => {
    try {
      const filename = req.params.filename;
      const { description, notes } = req.body;

      if (!filename) {
        res.status(400).json({ error: 'Filename is required' });
        return;
      }

      // Validate filename (prevent path traversal)
      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        res.status(400).json({ error: 'Invalid filename' });
        return;
      }

      // Check if file exists (symlink-safe)
      const filePath = safeResolvePath(deps.config.disksDir, filename);
      if (!filePath) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      // Update notes in database
      await deps.database.upsertDiskNote(
        filename,
        description || '',
        notes || ''
      );

      res.json({ success: true, filename });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  /**
   * @openapi
   * /api/images/{filename}/rename:
   *   put:
   *     tags: [Images]
   *     summary: Rename a disk image
   *     description: Rename a disk image file. Fails if the image is mounted on any drive, if the target filename already exists, or if the new name contains path separators / traversal sequences. Carries the description and notes over to the new filename.
   *     parameters:
   *       - in: path
   *         name: filename
   *         required: true
   *         schema:
   *           type: string
   *         description: Current disk image filename
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [newFilename]
   *             properties:
   *               newFilename:
   *                 type: string
   *                 description: Desired new filename (basename only, no slashes)
   *     responses:
   *       200:
   *         description: Rename successful
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 filename:
   *                   type: string
   *                   description: New filename
   *       400:
   *         description: Missing or invalid filename
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       404:
   *         description: Source file not found
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       409:
   *         description: Mounted, or target name already exists
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
  router.put('/api/images/:filename/rename', async (req: Request, res: Response): Promise<void> => {
    try {
      const filename = req.params.filename;
      const newFilenameRaw = req.body?.newFilename;

      if (!filename) {
        res.status(400).json({ error: 'Filename is required' });
        return;
      }
      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        res.status(400).json({ error: 'Invalid filename' });
        return;
      }
      if (typeof newFilenameRaw !== 'string') {
        res.status(400).json({ error: 'newFilename is required' });
        return;
      }
      const newFilename = newFilenameRaw.trim();
      if (!newFilename) {
        res.status(400).json({ error: 'newFilename cannot be empty' });
        return;
      }
      if (newFilename.includes('..') || newFilename.includes('/') || newFilename.includes('\\')) {
        res.status(400).json({ error: 'Invalid new filename: path separators not allowed' });
        return;
      }
      if (newFilename.startsWith('.')) {
        res.status(400).json({ error: 'Invalid new filename: cannot start with a dot' });
        return;
      }
      if (newFilename.length > 200) {
        res.status(400).json({ error: 'New filename is too long (max 200 chars)' });
        return;
      }

      // No-op rename: succeed without touching anything.
      if (newFilename === filename) {
        res.json({ success: true, filename });
        return;
      }

      const sourcePath = safeResolvePath(deps.config.disksDir, filename);
      if (!sourcePath) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      // Refuse to rename a mounted image — the open fd would dangle.
      for (let i = 0; i < MAX_DRIVES; i++) {
        const driveState = deps.driveManager.getDriveState(i);
        if (driveState && driveState.mounted && driveState.filename) {
          if (path.basename(driveState.filename) === filename) {
            res.status(409).json({
              error: `Cannot rename: image is mounted on drive ${i}`,
            });
            return;
          }
        }
      }

      // Don't clobber an existing image.
      const destPath = path.join(deps.config.disksDir, newFilename);
      if (existsSync(destPath)) {
        res.status(409).json({ error: 'A disk image with that name already exists' });
        return;
      }

      await fs.rename(sourcePath, destPath);

      // Migrate the notes record (no-op if no row existed).
      await deps.database.renameDiskNote(filename, newFilename);

      // Keep snapshots attached to the renamed image.
      await renameSnapshotsForDisk(deps, filename, newFilename);

      // Keep the per-image write policy attached to the renamed image.
      await deps.database.renameDiskPolicy(filename, newFilename);

      res.json({ success: true, filename: newFilename });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });
}
