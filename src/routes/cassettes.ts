import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createReadStream } from 'fs';
import { Dependencies } from '../types';
import { safeResolvePath, safeErrorMessage } from '../utils/safe-path';
import { listCassettesWithDetails } from '../services/file-listing';
import { getAudioPlayer } from '../services/audio';

export function registerCassetteRoutes(router: Router, deps: Dependencies): void {
  // Configure multer for cassette uploads
  const cassetteStorage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, deps.config.cassettesDir);
    },
    filename: (_req, file, cb) => {
      // Use original filename
      cb(null, file.originalname);
    },
  });

  const cassetteUpload = multer({
    storage: cassetteStorage,
    fileFilter: (_req, file, cb) => {
      // Only accept .wav files
      const ext = path.extname(file.originalname).toLowerCase();
      if (ext === '.wav') {
        cb(null, true);
      } else {
        cb(new Error('Only .wav files are allowed'));
      }
    },
    limits: {
      fileSize: 100 * 1024 * 1024, // 100MB max file size for audio
    },
  });

  /**
   * @openapi
   * /api/cassettes/details:
   *   get:
   *     tags: [Cassettes]
   *     summary: List cassettes with details
   *     description: Returns all cassette WAV files with size, description, and notes.
   *     responses:
   *       200:
   *         description: Detailed cassette list
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 cassettes:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/CassetteInfo'
   *       500:
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  router.get('/api/cassettes/details', async (_req: Request, res: Response): Promise<void> => {
    try {
      const cassettes = await listCassettesWithDetails(deps);
      res.json({ cassettes });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  /**
   * @openapi
   * /api/cassettes/upload:
   *   post:
   *     tags: [Cassettes]
   *     summary: Upload cassette
   *     description: Upload a cassette WAV file. Max 100MB.
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             required: [cassette]
   *             properties:
   *               cassette:
   *                 type: string
   *                 format: binary
   *                 description: WAV audio file
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
  router.post(
    '/api/cassettes/upload',
    cassetteUpload.single('cassette'),
    async (req: Request, res: Response): Promise<void> => {
      try {
        if (!req.file) {
          res.status(400).json({ error: 'No file uploaded' });
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
   * /api/cassettes/{filename}:
   *   delete:
   *     tags: [Cassettes]
   *     summary: Delete cassette
   *     description: Delete a cassette WAV file.
   *     parameters:
   *       - in: path
   *         name: filename
   *         required: true
   *         schema:
   *           type: string
   *         description: Cassette filename
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
   *       500:
   *         description: Server error
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  router.delete('/api/cassettes/:filename', async (req: Request, res: Response): Promise<void> => {
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

      const filePath = safeResolvePath(deps.config.cassettesDir, filename);
      if (!filePath) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      // Delete the file
      await fs.unlink(filePath);

      // Also delete notes from database
      await deps.database.deleteCassetteNote(filename);

      res.json({ success: true, filename });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  /**
   * @openapi
   * /api/cassettes/{filename}/notes:
   *   put:
   *     tags: [Cassettes]
   *     summary: Update cassette notes
   *     description: Set or update the description and notes for a cassette file.
   *     parameters:
   *       - in: path
   *         name: filename
   *         required: true
   *         schema:
   *           type: string
   *         description: Cassette filename
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
  router.put('/api/cassettes/:filename/notes', async (req: Request, res: Response): Promise<void> => {
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
      const filePath = safeResolvePath(deps.config.cassettesDir, filename);
      if (!filePath) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      // Update notes in database
      await deps.database.upsertCassetteNote(
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
   * /api/cassettes/{filename}/stream:
   *   get:
   *     tags: [Cassettes]
   *     summary: Stream cassette audio
   *     description: Stream the cassette WAV file for client-side playback.
   *     parameters:
   *       - in: path
   *         name: filename
   *         required: true
   *         schema:
   *           type: string
   *         description: Cassette filename
   *     responses:
   *       200:
   *         description: WAV audio stream
   *         content:
   *           audio/wav:
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
  router.get('/api/cassettes/:filename/stream', (req: Request, res: Response) => {
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

      const filePath = safeResolvePath(deps.config.cassettesDir, filename);
      if (!filePath) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      // Stream the file
      res.setHeader('Content-Type', 'audio/wav');
      const filenameAscii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${filenameAscii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
      );

      const stream = createReadStream(filePath);
      stream.pipe(res);

      stream.on('error', (err) => {
        console.error('Stream error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Error streaming file' });
        }
      });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  /**
   * @openapi
   * /api/cassettes/{filename}/play:
   *   post:
   *     tags: [Cassettes]
   *     summary: Play cassette server-side
   *     description: Play the cassette WAV file through the server's audio output. Stops any currently playing audio first.
   *     parameters:
   *       - in: path
   *         name: filename
   *         required: true
   *         schema:
   *           type: string
   *         description: Cassette filename
   *     responses:
   *       200:
   *         description: Playback started
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 message:
   *                   type: string
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
  router.post('/api/cassettes/:filename/play', (req: Request, res: Response) => {
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

      const filePath = safeResolvePath(deps.config.cassettesDir, filename);
      if (!filePath) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      // Stop any currently playing audio
      if (deps.currentAudioProcess && deps.currentAudioProcess.kill) {
        deps.currentAudioProcess.kill();
        deps.currentAudioProcess = null;
      }

      // Get audio player (lazy-loaded on first use)
      const audioPlayer = getAudioPlayer(deps);

      // Play the audio file
      deps.currentAudioProcess = audioPlayer.play(filePath, (err: any) => {
        if (err && !err.killed) {
          console.error('Audio playback error:', err);
        }
        deps.currentAudioProcess = null;
      });

      res.json({ success: true, message: 'Playback started', filename });
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });

  /**
   * @openapi
   * /api/cassettes/stop:
   *   post:
   *     tags: [Cassettes]
   *     summary: Stop server-side playback
   *     description: Stop any currently playing cassette audio on the server.
   *     responses:
   *       200:
   *         description: Playback stopped
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
  router.post('/api/cassettes/stop', (_req: Request, res: Response) => {
    try {
      if (deps.currentAudioProcess && deps.currentAudioProcess.kill) {
        deps.currentAudioProcess.kill();
        deps.currentAudioProcess = null;
        res.json({ success: true, message: 'Playback stopped' });
      } else {
        res.json({ success: true, message: 'No audio playing' });
      }
    } catch (error) {
      res.status(500).json({ error: safeErrorMessage(error) });
    }
  });
}
