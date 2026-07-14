import { Router, Request, Response } from 'express';
import { Dependencies } from '../types';
import { safeErrorMessage } from '../utils/safe-path';
import { ServiceError } from '../services/service-error';
import {
  listMachinePresets,
  listInstanceStatus,
  getInstanceStatus,
  createTransientInstance,
  defineInstance,
  startInstance,
  stopInstance,
  setInstanceSpeed,
  destroyInstance,
  writeInstanceConsole,
  readInstanceConsole,
  listInstanceDisplays,
  listInstanceKeyboards,
  sendInstanceKeys,
  readInstanceFrontPanel,
  instanceFrontPanelAction,
} from '../services/instance-service';
import {
  snapshotInstance,
  listInstanceSnapshots,
  restoreInstanceSnapshot,
  deleteInstanceSnapshot,
} from '../services/instance-snapshot-service';

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
  router.get('/api/instances', async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json({ instances: await listInstanceStatus(deps) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/api/instances', async (req: Request, res: Response): Promise<void> => {
    try {
      const { profileRef, preset, profile, speed } = req.body ?? {};
      res.json({ instance: await defineInstance(deps, { profileRef, preset, profile, speed }, 'api') });
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
      const { profileRef, preset, profile, speed } = req.body ?? {};
      res.json({ instance: await createTransientInstance(deps, { profileRef, preset, profile, speed }, 'api') });
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
  router.get('/api/instances/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      res.json({ instance: await getInstanceStatus(deps, req.params.id) });
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
   * /api/instances/{id}/speed:
   *   post:
   *     tags: [Instances]
   *     summary: Change a running instance's speed live (no restart)
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
   *             required: [speed]
   *             properties:
   *               speed:
   *                 oneOf: [{ type: number }, { type: string, enum: ['max'] }]
   *                 description: Hz (e.g. 2000000, 4000000) or 'max'.
   *     responses:
   *       200:
   *         description: The instance at its new speed
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 instance:
   *                   $ref: '#/components/schemas/MachineInstance'
   *       409: { description: Instance is not running }
   */
  router.post('/api/instances/:id/speed', async (req: Request, res: Response): Promise<void> => {
    try {
      res.json({ instance: await setInstanceSpeed(deps, req.params.id, req.body?.speed) });
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * @openapi
   * /api/instances/{id}/snapshots:
   *   get:
   *     tags: [Instances]
   *     summary: List an instance's disk/media snapshots
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Snapshots, newest first
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 snapshots:
   *                   type: array
   *                   items: { $ref: '#/components/schemas/InstanceSnapshot' }
   *   post:
   *     tags: [Instances]
   *     summary: Snapshot an instance's disk/media state (FR-18)
   *     description: Captures the machine definition + each bound drive's disk state (execution state is out of scope).
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               label: { type: string }
   *     responses:
   *       200:
   *         description: The snapshot
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 snapshot: { $ref: '#/components/schemas/InstanceSnapshot' }
   */
  router.get('/api/instances/:id/snapshots', async (req: Request, res: Response): Promise<void> => {
    try {
      res.json({ snapshots: await listInstanceSnapshots(deps, req.params.id) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/api/instances/:id/snapshots', async (req: Request, res: Response): Promise<void> => {
    try {
      res.json({ snapshot: await snapshotInstance(deps, req.params.id, req.body?.label) });
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * @openapi
   * /api/instance-snapshots/{snapshotId}/restore:
   *   post:
   *     tags: [Instances]
   *     summary: Restore a disk/media snapshot onto its instance
   *     description: Stops the instance, writes the captured disks back, and restarts it (reproduces the disk state; the machine reboots).
   *     parameters:
   *       - in: path
   *         name: snapshotId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Restored }
   *       404: { description: Snapshot or instance not found }
   *   delete:
   *     tags: [Instances]
   *     summary: Delete a disk/media snapshot
   *     parameters:
   *       - in: path
   *         name: snapshotId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Deleted }
   */
  router.post('/api/instance-snapshots/:snapshotId/restore', async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await restoreInstanceSnapshot(deps, req.params.snapshotId, req.body?.targetInstanceId));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.delete('/api/instance-snapshots/:snapshotId', async (req: Request, res: Response): Promise<void> => {
    try {
      await deleteInstanceSnapshot(deps, req.params.snapshotId);
      res.json({ id: req.params.snapshotId, deleted: true });
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

  /**
   * @openapi
   * /api/instances/{id}/display:
   *   get:
   *     tags: [Instances]
   *     summary: Read a running instance's video displays (Story 5.9)
   *     description: The video cards the machine exposes — each with a render descriptor (charGrid | bitmap) and a fresh frame (base64 of the video RAM the card maps). Poll for live output.
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Displays
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 displays:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       cardId: { type: string }
   *                       descriptor: { type: object, additionalProperties: true }
   *                       state: { type: object, additionalProperties: true }
   *                       frame: { type: string, description: 'base64 of the frame bytes' }
   */
  router.get('/api/instances/:id/display', (req: Request, res: Response): void => {
    try {
      res.json({ displays: listInstanceDisplays(deps, req.params.id) });
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * @openapi
   * /api/instances/{id}/frontpanel:
   *   get:
   *     tags: [Instances]
   *     summary: Read a running instance's front-panel state (cockpit Phase 3)
   *     description: CPU registers/flags, halted/running, and the address+data bus — for the Altair-style front panel.
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Front-panel state }
   *       409: { description: Instance not running }
   *   post:
   *     tags: [Instances]
   *     summary: Drive the front panel (Altair controls)
   *     description: run / stop / step / reset / examine / examNext / deposit / depNext. `value` is the switch register (address for examine, data for deposit). Returns the new state.
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
   *             required: [action]
   *             properties:
   *               action: { type: string, enum: [run, stop, step, reset, examine, examNext, deposit, depNext] }
   *               value: { type: integer, description: 'Switch register (0-0xFFFF address / 0-0xFF data)' }
   *     responses:
   *       200: { description: New front-panel state }
   *       400: { description: Unknown action }
   *       409: { description: Instance not running }
   */
  /**
   * @openapi
   * /api/instances/{id}/keyboard:
   *   get:
   *     tags: [Instances]
   *     summary: List a running instance's keyboard cards (5.9)
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Keyboard cards with pending key counts }
   *   post:
   *     tags: [Instances]
   *     summary: Inject keys into a keyboard card (5.9)
   *     description: Feeds bytes to the guest's keyboard data port. Supply `byte`, `bytes`, or `text`; `cardId` targets one of several keyboard cards.
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
   *             properties:
   *               byte: { type: integer, description: 'A single key byte (0-255)' }
   *               bytes: { type: array, items: { type: integer }, description: 'Several key bytes' }
   *               text: { type: string, description: 'A string, sent one char at a time' }
   *               cardId: { type: string, description: 'Target keyboard card (when the machine has more than one)' }
   *     responses:
   *       200: { description: Keys queued }
   *       400: { description: No key data, or ambiguous card }
   *       404: { description: No such keyboard card }
   *       409: { description: Instance not running, or has no keyboard card }
   */
  router.get('/api/instances/:id/keyboard', (req: Request, res: Response): void => {
    try {
      res.json({ keyboards: listInstanceKeyboards(deps, req.params.id) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/api/instances/:id/keyboard', (req: Request, res: Response): void => {
    try {
      const { byte, bytes, text, cardId } = req.body ?? {};
      res.json(sendInstanceKeys(deps, req.params.id, { byte, bytes, text, cardId }));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/api/instances/:id/frontpanel', (req: Request, res: Response): void => {
    try {
      res.json(readInstanceFrontPanel(deps, req.params.id));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/api/instances/:id/frontpanel', (req: Request, res: Response): void => {
    try {
      const action = req.body?.action;
      const value = req.body?.value;
      if (typeof action !== 'string') throw new ServiceError('`action` is required', 400);
      res.json(instanceFrontPanelAction(deps, req.params.id, action as never, typeof value === 'number' ? value : 0));
    } catch (error) {
      sendError(res, error);
    }
  });
}
