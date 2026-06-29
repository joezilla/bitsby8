import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import { Dependencies } from '../types';
import { safeResolvePath, safeErrorMessage } from '../utils/safe-path';

export function registerScriptRoutes(router: Router, deps: Dependencies): void {
  /**
   * @openapi
   * /api/scripts:
   *   get:
   *     tags: [Scripts]
   *     summary: List scripts
   *     description: Returns all files in the scripts directory with name and size.
   *     responses:
   *       200:
   *         description: List of scripts
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 scripts:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/ScriptInfo'
   *       500:
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  router.get('/api/scripts', async (_req: Request, res: Response): Promise<void> => {
    try {
      await fs.mkdir(deps.config.scriptsDir, { recursive: true });
      const files = await fs.readdir(deps.config.scriptsDir);
      // Return all files with name and size
      const scripts = await Promise.all(
        files.filter(f => !f.startsWith('.')).map(async (name) => {
          try {
            const stat = await fs.stat(path.join(deps.config.scriptsDir, name));
            return { name, size: stat.size };
          } catch {
            return { name, size: 0 };
          }
        })
      );
      scripts.sort((a, b) => a.name.localeCompare(b.name));
      res.json({ scripts });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  /**
   * @openapi
   * /api/scripts/{name}:
   *   get:
   *     tags: [Scripts]
   *     summary: Get script content
   *     description: Returns script metadata and content. Text files (.txt) include content; binary files return metadata only.
   *     parameters:
   *       - in: path
   *         name: name
   *         required: true
   *         schema:
   *           type: string
   *         description: Script filename
   *     responses:
   *       200:
   *         description: Script content
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 name:
   *                   type: string
   *                 content:
   *                   type: string
   *                   description: File content (text files only)
   *                 size:
   *                   type: integer
   *                 binary:
   *                   type: boolean
   *       400:
   *         description: Invalid script name
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       404:
   *         description: Script not found
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
  router.get('/api/scripts/:name', async (req: Request, res: Response): Promise<void> => {
    try {
      const name = req.params.name;

      if (!name) {
        res.status(400).json({ error: 'Invalid script name' });
        return;
      }

      // Validate filename (prevent path traversal)
      if (name.includes('..') || name.includes('/') || name.includes('\\')) {
        res.status(400).json({ error: 'Invalid script name' });
        return;
      }

      const scriptPath = safeResolvePath(deps.config.scriptsDir, name);
      if (!scriptPath) {
        res.status(404).json({ error: 'Script not found' });
        return;
      }

      const stat = await fs.stat(scriptPath);

      // For text files, return content; for binary, return metadata only
      if (name.endsWith('.txt')) {
        const content = await fs.readFile(scriptPath, 'utf-8');
        res.json({ name, content, size: stat.size, binary: false });
      } else {
        res.json({ name, size: stat.size, binary: true });
      }
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  /**
   * @openapi
   * /api/scripts:
   *   post:
   *     tags: [Scripts]
   *     summary: Create new text script
   *     description: Create a new script file. Fails if the file already exists.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [name]
   *             properties:
   *               name:
   *                 type: string
   *                 description: Script filename
   *                 example: hello.txt
   *               content:
   *                 type: string
   *                 description: Initial file content
   *     responses:
   *       200:
   *         description: Script created
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 name:
   *                   type: string
   *       400:
   *         description: Invalid script name
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       409:
   *         description: Script already exists
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
  router.post('/api/scripts', async (req: Request, res: Response): Promise<void> => {
    try {
      const { name, content } = req.body;

      if (!name) {
        res.status(400).json({ error: 'Script name is required' });
        return;
      }

      // Validate filename (prevent path traversal)
      if (name.includes('..') || name.includes('/') || name.includes('\\')) {
        res.status(400).json({ error: 'Invalid script name' });
        return;
      }

      await fs.mkdir(deps.config.scriptsDir, { recursive: true });

      const scriptPath = path.join(deps.config.scriptsDir, name);

      if (existsSync(scriptPath)) {
        res.status(409).json({ error: 'Script already exists' });
        return;
      }

      await fs.writeFile(scriptPath, content || '', 'utf-8');
      res.json({ success: true, name });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  /**
   * @openapi
   * /api/scripts/{name}:
   *   put:
   *     tags: [Scripts]
   *     summary: Update script
   *     description: Overwrite the content of an existing script file.
   *     parameters:
   *       - in: path
   *         name: name
   *         required: true
   *         schema:
   *           type: string
   *         description: Script filename
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               content:
   *                 type: string
   *                 description: New file content
   *     responses:
   *       200:
   *         description: Script updated
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 name:
   *                   type: string
   *       400:
   *         description: Invalid script name
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       404:
   *         description: Script not found
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
  router.put('/api/scripts/:name', async (req: Request, res: Response): Promise<void> => {
    try {
      const name = req.params.name;
      const { content } = req.body;

      if (!name) {
        res.status(400).json({ error: 'Invalid script name' });
        return;
      }

      // Validate filename (prevent path traversal)
      if (name.includes('..') || name.includes('/') || name.includes('\\')) {
        res.status(400).json({ error: 'Invalid script name' });
        return;
      }

      const scriptPath = safeResolvePath(deps.config.scriptsDir, name);
      if (!scriptPath) {
        res.status(404).json({ error: 'Script not found' });
        return;
      }

      await fs.writeFile(scriptPath, content || '', 'utf-8');
      res.json({ success: true, name });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  /**
   * @openapi
   * /api/scripts/{name}:
   *   delete:
   *     tags: [Scripts]
   *     summary: Delete script
   *     description: Delete a script file.
   *     parameters:
   *       - in: path
   *         name: name
   *         required: true
   *         schema:
   *           type: string
   *         description: Script filename
   *     responses:
   *       200:
   *         description: Script deleted
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 name:
   *                   type: string
   *       400:
   *         description: Invalid script name
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       404:
   *         description: Script not found
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
  router.delete('/api/scripts/:name', async (req: Request, res: Response): Promise<void> => {
    try {
      const name = req.params.name;

      if (!name) {
        res.status(400).json({ error: 'Invalid script name' });
        return;
      }

      // Validate filename (prevent path traversal)
      if (name.includes('..') || name.includes('/') || name.includes('\\')) {
        res.status(400).json({ error: 'Invalid script name' });
        return;
      }

      const scriptPath = safeResolvePath(deps.config.scriptsDir, name);
      if (!scriptPath) {
        res.status(404).json({ error: 'Script not found' });
        return;
      }

      await fs.unlink(scriptPath);
      res.json({ success: true, name });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  // Script file upload (any file type, stored in scripts dir)
  const scriptUploadStorage = multer.diskStorage({
    destination: async (_req, _file, cb) => {
      await fs.mkdir(deps.config.scriptsDir, { recursive: true });
      cb(null, deps.config.scriptsDir);
    },
    filename: (_req, file, cb) => {
      cb(null, file.originalname);
    },
  });

  const scriptUpload = multer({
    storage: scriptUploadStorage,
    fileFilter: (_req, file, cb) => {
      // Validate filename (prevent path traversal)
      if (file.originalname.includes('..') || file.originalname.includes('/') || file.originalname.includes('\\')) {
        cb(new Error('Invalid filename'));
        return;
      }
      cb(null, true);
    },
    limits: {
      fileSize: 1 * 1024 * 1024, // 1MB max
    },
  });

  /**
   * @openapi
   * /api/scripts/upload:
   *   post:
   *     tags: [Scripts]
   *     summary: Upload script file
   *     description: Upload any file to the scripts directory. Max 1MB.
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
   *                 description: Script file to upload
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
   *                 name:
   *                   type: string
   *                 size:
   *                   type: integer
   *       400:
   *         description: No file uploaded
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
    '/api/scripts/upload',
    scriptUpload.single('file'),
    async (req: Request, res: Response): Promise<void> => {
      try {
        if (!req.file) {
          res.status(400).json({ error: 'No file uploaded' });
          return;
        }

        res.json({
          success: true,
          name: req.file.filename,
          size: req.file.size,
        });
      } catch (error) {
        res.status(500).json({ error: safeErrorMessage(error) });
      }
    }
  );
}
