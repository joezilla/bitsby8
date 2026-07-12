import { Router, Request, Response } from 'express';
import { Dependencies } from '../types';
import { safeErrorMessage } from '../utils/safe-path';
import { ServiceError } from '../services/service-error';
import {
  createProfile,
  createProfileFromPreset,
  getProfile,
  listProfiles,
  listProfileVersions,
  updateProfile,
  cloneProfile,
  deleteProfile,
  ProfileContent,
} from '../services/profile-service';
import { validateProfile, autoAssign } from '../services/collision-validator';
import { exportProfile, bundleFilename, importBundle } from '../services/bundle-service';
import { burnEprom, eraseEprom } from '../services/eprom-service';
import { Addressing, ImageFormat } from '../services/rom-image';
import { listProfileDisks, setProfileDisk, clearProfileDisk } from '../services/profile-disk-service';

/** Normalize a request body into a ProfileContent for collision checks
 * (only memory + cards affect collisions; the rest is defaulted). */
function contentFromBody(body: Record<string, unknown>): ProfileContent {
  return {
    cpuKind: (body.cpuKind as ProfileContent['cpuKind']) ?? 'i8080',
    clock: (body.clock as ProfileContent['clock']) ?? 'max',
    resetVector: (body.resetVector as number) ?? 0,
    memory: (body.memory as ProfileContent['memory']) ?? [],
    cards: (body.cards as ProfileContent['cards']) ?? [],
    consoleCardId: body.consoleCardId as string | undefined,
  };
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof ServiceError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  res.status(500).json({ error: safeErrorMessage(error) });
}

export function registerProfileRoutes(router: Router, deps: Dependencies): void {
  /**
   * @openapi
   * /api/profiles:
   *   get:
   *     tags: [Profiles]
   *     summary: List Machine Profiles (latest version of each)
   *     responses:
   *       200:
   *         description: Array of profiles
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 profiles:
   *                   type: array
   *                   items: { $ref: '#/components/schemas/MachineProfile' }
   *   post:
   *     tags: [Profiles]
   *     summary: Create a Machine Profile
   *     description: Create from a preset (`preset` + `name`) or from an explicit content body.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [name]
   *             properties:
   *               name: { type: string }
   *               preset: { type: string, description: 'Seed from a built-in preset (carries ROM + cards).' }
   *               notes: { type: string }
   *               cpuKind: { type: string, enum: [i8080, z80] }
   *               clock: {}
   *               resetVector: { type: integer }
   *               memory: { type: array, items: { type: object } }
   *               cards: { type: array, items: { type: object } }
   *               consoleCardId: { type: string }
   *     responses:
   *       200:
   *         description: The created profile
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 profile: { $ref: '#/components/schemas/MachineProfile' }
   */
  router.get('/api/profiles', async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json({ profiles: await listProfiles(deps) });
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * @openapi
   * /api/profiles/validate:
   *   post:
   *     tags: [Profiles]
   *     summary: Validate a (possibly unsaved) Profile for bus collisions
   *     description: Define-time collision check (FR-8) — returns every collision (port/IRQ/memory) naming both offenders and the specific resource, plus each card's claimed footprint. `ok:true` means the Profile is runnable.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               memory: { type: array, items: { type: object } }
   *               cards: { type: array, items: { type: object } }
   *     responses:
   *       200:
   *         description: Validation result
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/ProfileValidation' }
   */
  router.post('/api/profiles/validate', async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await validateProfile(deps, contentFromBody(req.body ?? {})));
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * @openapi
   * /api/profiles/auto-assign:
   *   post:
   *     tags: [Profiles]
   *     summary: Auto-assign collision-free base ports
   *     description: Sweeps each colliding card's base port for a collision-free value (FR-8). Returns the updated content plus any cards that couldn't be resolved.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               memory: { type: array, items: { type: object } }
   *               cards: { type: array, items: { type: object } }
   *     responses:
   *       200:
   *         description: Reassignment result
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 content: { type: object }
   *                 unresolved: { type: array, items: { type: string } }
   *                 changes: { type: array, items: { type: object } }
   */
  router.post('/api/profiles/auto-assign', async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await autoAssign(deps, contentFromBody(req.body ?? {})));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/api/profiles', async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body ?? {};
      if (typeof body.name !== 'string') throw new ServiceError('`name` is required', 400);
      const profile = body.preset
        ? await createProfileFromPreset(deps, body.preset, body.name, body.notes)
        : await createProfile(deps, body);
      res.json({ profile });
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * @openapi
   * /api/profiles/import:
   *   post:
   *     tags: [Profiles]
   *     summary: Import a Bitsby8 bundle into the Catalog (FR-24)
   *     description: Registers the bundle's Machine Profile resolvable by Identity; requires its referenced cards to be present; reports (never overwrites) an already-present Identity.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [bundle]
   *             properties:
   *               bundle: { type: object, description: 'A Bitsby8 bundle (from export).' }
   *               name: { type: string, description: 'Optional import name (defaults to the bundle name).' }
   *     responses:
   *       200:
   *         description: Imported — the new profile + card/warning report
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 profile: { $ref: '#/components/schemas/MachineProfile' }
   *                 cards: { type: array, items: { type: object } }
   *                 warnings: { type: array, items: { type: string } }
   *       409: { description: Identity already present (no overwrite) }
   *       422: { description: Referenced card(s) missing }
   */
  router.post('/api/profiles/import', async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body ?? {};
      res.json(await importBundle(deps, body.bundle, { name: body.name }));
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * @openapi
   * /api/profiles/{id}:
   *   get:
   *     tags: [Profiles]
   *     summary: Get a Machine Profile by Identity (name@version)
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: The profile
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 profile: { $ref: '#/components/schemas/MachineProfile' }
   *       404: { description: Not found }
   *   put:
   *     tags: [Profiles]
   *     summary: Save a change (writes a new version)
   *     description: Applies a content patch and persists a NEW version with a new sha256; prior versions remain resolvable.
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { type: object }
   *     responses:
   *       200:
   *         description: The new version
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 profile: { $ref: '#/components/schemas/MachineProfile' }
   *   delete:
   *     tags: [Profiles]
   *     summary: Delete a Profile
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: scope
   *         schema: { type: string, enum: [version, all] }
   *         description: Delete just this version or every version of the name (default all).
   *     responses:
   *       200: { description: Deleted }
   */
  router.get('/api/profiles/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      res.json({ profile: await getProfile(deps, req.params.id) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.put('/api/profiles/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      res.json({ profile: await updateProfile(deps, req.params.id, req.body ?? {}) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.delete('/api/profiles/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      const scope = req.query.scope === 'version' ? 'version' : 'all';
      await deleteProfile(deps, req.params.id, scope);
      res.json({ id: req.params.id, deleted: true, scope });
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * @openapi
   * /api/profiles/{id}/disks:
   *   get:
   *     tags: [Profiles]
   *     summary: List a Profile's startup disk mounts
   *     description: Which disk image each drive gets when a machine launches from this profile. Keyed by profile name (shared across versions).
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: The profile's disk bindings }
   * /api/profiles/{id}/disks/{drive}:
   *   put:
   *     tags: [Profiles]
   *     summary: Bind a disk image to a Profile drive (mounts at startup)
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: drive
   *         required: true
   *         schema: { type: integer }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [filename]
   *             properties:
   *               filename: { type: string }
   *               readonly: { type: boolean }
   *     responses:
   *       200: { description: Updated bindings }
   *       404: { description: Disk image not found }
   *   delete:
   *     tags: [Profiles]
   *     summary: Clear a Profile drive's startup disk
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: drive
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       200: { description: Updated bindings }
   */
  router.get('/api/profiles/:id/disks', async (req: Request, res: Response): Promise<void> => {
    try {
      res.json({ disks: await listProfileDisks(deps, req.params.id) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.put('/api/profiles/:id/disks/:drive', async (req: Request, res: Response): Promise<void> => {
    try {
      const { filename, readonly } = req.body ?? {};
      if (typeof filename !== 'string') throw new ServiceError('`filename` is required', 400);
      await setProfileDisk(deps, req.params.id, Number(req.params.drive), filename, readonly === true);
      res.json({ disks: await listProfileDisks(deps, req.params.id) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.delete('/api/profiles/:id/disks/:drive', async (req: Request, res: Response): Promise<void> => {
    try {
      await clearProfileDisk(deps, req.params.id, Number(req.params.drive));
      res.json({ disks: await listProfileDisks(deps, req.params.id) });
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * @openapi
   * /api/profiles/{id}/clone:
   *   post:
   *     tags: [Profiles]
   *     summary: Clone a Profile into an independent new one
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
   *             required: [name]
   *             properties:
   *               name: { type: string }
   *               notes: { type: string }
   *     responses:
   *       200:
   *         description: The cloned profile
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 profile: { $ref: '#/components/schemas/MachineProfile' }
   */
  router.post('/api/profiles/:id/clone', async (req: Request, res: Response): Promise<void> => {
    try {
      const { name, notes } = req.body ?? {};
      if (typeof name !== 'string') throw new ServiceError('`name` is required', 400);
      res.json({ profile: await cloneProfile(deps, req.params.id, name, notes) });
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * @openapi
   * /api/profiles/{name}/versions:
   *   get:
   *     tags: [Profiles]
   *     summary: List all versions of a Profile name
   *     parameters:
   *       - in: path
   *         name: name
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Versions, newest first
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 versions:
   *                   type: array
   *                   items: { $ref: '#/components/schemas/MachineProfile' }
   *       404: { description: Not found }
   */
  router.get('/api/profiles/:name/versions', async (req: Request, res: Response): Promise<void> => {
    try {
      res.json({ versions: await listProfileVersions(deps, req.params.name) });
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * @openapi
   * /api/profiles/{id}/validation:
   *   get:
   *     tags: [Profiles]
   *     summary: Validate a stored Profile for bus collisions
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Validation result
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/ProfileValidation' }
   *       404: { description: Not found }
   */
  router.get('/api/profiles/:id/validation', async (req: Request, res: Response): Promise<void> => {
    try {
      const profile = await getProfile(deps, req.params.id);
      res.json(await validateProfile(deps, profile));
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * @openapi
   * /api/profiles/{id}/export:
   *   get:
   *     tags: [Profiles]
   *     summary: Export a Profile to a self-describing bundle (FR-23)
   *     description: A downloadable Bitsby8 bundle containing the Profile (ROM/media inline), its content Identity, and its referenced cards pinned by Identity. Carries no host-specific device paths.
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: The bundle (application/json, download)
   *       404: { description: Not found }
   */
  router.get('/api/profiles/:id/export', async (req: Request, res: Response): Promise<void> => {
    try {
      const bundle = await exportProfile(deps, req.params.id);
      res.setHeader('Content-Disposition', `attachment; filename="${bundleFilename(bundle)}"`);
      res.json(bundle);
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * @openapi
   * /api/profiles/{id}/cards/{cardId}/burn:
   *   post:
   *     tags: [Profiles]
   *     summary: Burn a .bin/Intel HEX image into an EPROM card (FR-6)
   *     description: Loads a base64 image into the EPROM card instance's ROM region, honoring the file's addresses or relocating from the region base. Persists a new Profile version with the burned bytes content-addressed.
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: cardId
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [image]
   *             properties:
   *               image: { type: string, description: 'base64-encoded file bytes (.bin or Intel HEX).' }
   *               addressing: { type: string, enum: [file, base], description: "Honor file addresses ('file') or relocate to the region base ('base'). Default 'base'." }
   *               format: { type: string, enum: [bin, ihex], description: 'Override format detection.' }
   *               filename: { type: string, description: 'Original filename (aids format detection).' }
   *     responses:
   *       200:
   *         description: Burned — the new profile version + a burn summary
   *       404: { description: No such card instance }
   *       409: { description: Card is not an EPROM/memory card }
   *       422: { description: Image malformed or overflows the EPROM }
   */
  router.post('/api/profiles/:id/cards/:cardId/burn', async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body ?? {};
      if (typeof body.image !== 'string' || body.image === '') {
        throw new ServiceError('image (base64) is required', 400);
      }
      const out = await burnEprom(deps, req.params.id, req.params.cardId, {
        bytes: new Uint8Array(Buffer.from(body.image, 'base64')),
        addressing: (body.addressing as Addressing) ?? 'base',
        format: body.format as ImageFormat | undefined,
        filename: body.filename as string | undefined,
      });
      res.json(out);
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * @openapi
   * /api/profiles/{id}/cards/{cardId}/rom:
   *   delete:
   *     tags: [Profiles]
   *     summary: Erase a burned EPROM card (FR-6)
   *     description: Drops the burned ROM override so the EPROM card reverts to empty. Persists a new Profile version when something was erased.
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: cardId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Erased (or a no-op if nothing was burned) }
   *       404: { description: No such card instance }
   *       409: { description: Card is not an EPROM/memory card }
   */
  router.delete('/api/profiles/:id/cards/:cardId/rom', async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await eraseEprom(deps, req.params.id, req.params.cardId));
    } catch (error) {
      sendError(res, error);
    }
  });
}
