import { Router, Request, Response } from 'express';
import { Dependencies } from '../types';
import { safeErrorMessage } from '../utils/safe-path';
import { ServiceError } from '../services/service-error';
import {
  listMachinePresets,
  listInstances,
  getInstance,
  createTransientInstance,
  defineInstance,
  startInstance,
  stopInstance,
  destroyInstance,
  writeInstanceConsole,
  readInstanceConsole,
} from '../services/instance-service';

function sendError(res: Response, error: unknown): void {
  if (error instanceof ServiceError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  res.status(500).json({ error: safeErrorMessage(error) });
}

export function registerInstanceRoutes(router: Router, deps: Dependencies): void {
  /**
   * @openapi
   * /api/instances/presets:
   *   get:
   *     tags: [Instances]
   *     summary: List built-in machine presets
   *     description: Ready-to-boot S-100 machine presets usable with POST /api/instances/transient.
   *     responses:
   *       200:
   *         description: Array of presets
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 presets:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       id: { type: string }
   *                       name: { type: string }
   *                       description: { type: string }
   */
  router.get('/api/instances/presets', (_req: Request, res: Response): void => {
    try {
      res.json({ presets: listMachinePresets() });
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * @openapi
   * /api/instances:
   *   get:
   *     tags: [Instances]
   *     summary: List virtual Machine Instances
   *     responses:
   *       200:
   *         description: Array of instances
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 instances:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/MachineInstance'
   *   post:
   *     tags: [Instances]
   *     summary: Define a persistent Machine Instance (not started)
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/InstanceCreateRequest'
   *     responses:
   *       200:
   *         description: The defined instance
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 instance:
   *                   $ref: '#/components/schemas/MachineInstance'
   */
  router.get('/api/instances', (_req: Request, res: Response): void => {
    try {
      res.json({ instances: listInstances(deps) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/api/instances', async (req: Request, res: Response): Promise<void> => {
    try {
      const { profileRef, preset, profile } = req.body ?? {};
      res.json({ instance: await defineInstance(deps, { profileRef, preset, profile }, 'api') });
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * @openapi
   * /api/instances/transient:
   *   post:
   *     tags: [Instances]
   *     summary: Create and start a transient Machine Instance
   *     description: Memory-only; boots immediately and leaves no residue on destroy. Mount a boot disk first.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/InstanceCreateRequest'
   *     responses:
   *       200:
   *         description: The running instance
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 instance:
   *                   $ref: '#/components/schemas/MachineInstance'
   */
  router.post('/api/instances/transient', async (req: Request, res: Response): Promise<void> => {
    try {
      const { profileRef, preset, profile } = req.body ?? {};
      res.json({ instance: await createTransientInstance(deps, { profileRef, preset, profile }, 'api') });
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * @openapi
   * /api/instances/{id}:
   *   get:
   *     tags: [Instances]
   *     summary: Get a Machine Instance by id
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: The instance
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 instance:
   *                   $ref: '#/components/schemas/MachineInstance'
   *       404: { description: Not found }
   *   delete:
   *     tags: [Instances]
   *     summary: Destroy a Machine Instance
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Destroyed }
   */
  router.get('/api/instances/:id', (req: Request, res: Response): void => {
    try {
      res.json({ instance: getInstance(deps, req.params.id) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.delete('/api/instances/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      await destroyInstance(deps, req.params.id);
      res.json({ id: req.params.id, destroyed: true });
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * @openapi
   * /api/instances/{id}/start:
   *   post:
   *     tags: [Instances]
   *     summary: Start (or resume) a Machine Instance
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: The running instance
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 instance:
   *                   $ref: '#/components/schemas/MachineInstance'
   */
  router.post('/api/instances/:id/start', async (req: Request, res: Response): Promise<void> => {
    try {
      res.json({ instance: await startInstance(deps, req.params.id) });
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * @openapi
   * /api/instances/{id}/stop:
   *   post:
   *     tags: [Instances]
   *     summary: Stop a running Machine Instance
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: The stopped instance
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 instance:
   *                   $ref: '#/components/schemas/MachineInstance'
   */
  router.post('/api/instances/:id/stop', async (req: Request, res: Response): Promise<void> => {
    try {
      res.json({ instance: await stopInstance(deps, req.params.id) });
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * @openapi
   * /api/instances/{id}/console:
   *   get:
   *     tags: [Instances]
   *     summary: Read accumulated console output
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: cursor
   *         required: false
   *         schema: { type: integer, minimum: 0 }
   *         description: Byte cursor from a prior read (default 0 = whole buffer)
   *     responses:
   *       200:
   *         description: Console output slice
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { type: string }
   *                 cursor: { type: integer }
   *   post:
   *     tags: [Instances]
   *     summary: Send keystrokes to the console
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [input]
   *             properties:
   *               input:
   *                 type: string
   *                 description: Characters to send (use \r for Enter)
   *     responses:
   *       200: { description: Accepted }
   */
  router.get('/api/instances/:id/console', (req: Request, res: Response): void => {
    try {
      const cursor = req.query.cursor != null ? Number(req.query.cursor) : 0;
      res.json(readInstanceConsole(deps, req.params.id, Number.isFinite(cursor) ? cursor : 0));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/api/instances/:id/console', (req: Request, res: Response): void => {
    try {
      const input = req.body?.input;
      if (typeof input !== 'string') {
        throw new ServiceError('`input` (string) is required', 400);
      }
      writeInstanceConsole(deps, req.params.id, input);
      res.json({ id: req.params.id, wrote: input.length });
    } catch (error) {
      sendError(res, error);
    }
  });
}
