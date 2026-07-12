import { Router, Request, Response } from 'express';
import { Dependencies } from '../types';
import { safeErrorMessage } from '../utils/safe-path';
import { ServiceError } from '../services/service-error';
import { browseCatalog, getCardDefinition, CatalogFilter } from '../services/catalog';
import { getCardDetail } from '../services/card-detail';
import { checkCardConfig } from '../services/card-config';
import { listCpus } from '../services/bundle-registry';
import { authorCard, deleteAuthoredCard } from '../services/card-authoring';
import { listPeripheralEndpoints } from '../services/peripheral-registry';

/** Map a thrown error to an HTTP response: ServiceError carries a status;
 * anything else is a sanitized 500. */
function sendError(res: Response, error: unknown): void {
  if (error instanceof ServiceError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  res.status(500).json({ error: safeErrorMessage(error) });
}

export function registerCatalogRoutes(router: Router, deps: Dependencies): void {
  /**
   * @openapi
   * /api/catalog/cards:
   *   get:
   *     tags: [Catalog]
   *     summary: Browse Card Definitions
   *     description: >-
   *       Returns Card Definitions in the Catalog (seed cards in Tier-1), each with Identity,
   *       type, maker, derived capabilities, and manifest — optionally filtered. The `facets`
   *       object lists the type/maker/capability values present across the full (unfiltered)
   *       set so a UI can render its filters from one call.
   *     parameters:
   *       - in: query
   *         name: kind
   *         schema: { type: string }
   *         description: Filter by primitive kind (card | chip).
   *       - in: query
   *         name: type
   *         schema: { type: string }
   *         description: Filter by card type (serial | floppy | memory | panel | other).
   *       - in: query
   *         name: maker
   *         schema: { type: string }
   *         description: Filter by maker (e.g. MITS, IMSAI).
   *       - in: query
   *         name: capability
   *         schema: { type: string }
   *         description: Filter to cards carrying this derived capability tag.
   *       - in: query
   *         name: q
   *         schema: { type: string }
   *         description: Free-text search over id/name/summary/maker/type.
   *     responses:
   *       200:
   *         description: Filtered Card Definitions plus facet options
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 cards:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/CardDefinition'
   *                 facets:
   *                   type: object
   *                   properties:
   *                     kinds: { type: array, items: { type: string } }
   *                     types: { type: array, items: { type: string } }
   *                     makers: { type: array, items: { type: string } }
   *                     capabilities: { type: array, items: { type: string } }
   */
  /**
   * @openapi
   * /api/catalog/cpus:
   *   get:
   *     tags: [Catalog]
   *     summary: List the CPUs a Machine Profile can use (Story 5.3)
   *     description: The processors the engine can run, derived from the seed CPU cards, for the Profile builder's CPU picker.
   *     responses:
   *       200:
   *         description: Available CPUs
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 cpus:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       kind: { type: string, example: i8080 }
   *                       name: { type: string, example: Intel 8080 }
   *                       maker: { type: string }
   *                       ref: { type: string, description: 'Seed CPU card Identity, if any' }
   */
  router.get('/api/catalog/cpus', async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json({ cpus: await listCpus() });
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * @openapi
   * /api/peripherals:
   *   get:
   *     tags: [Catalog]
   *     summary: List peripheral endpoint types a card can bind to (Story 5.6)
   *     description: The vocabulary of endpoints a card's far side connects to (terminal, disk, clock, gpio, display, socket), with what's wired today.
   *     responses:
   *       200:
   *         description: Endpoint types
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 endpoints:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       type: { type: string }
   *                       label: { type: string }
   *                       description: { type: string }
   *                       available: { type: boolean }
   *                       arrivesWith: { type: string }
   */
  router.get('/api/peripherals', async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json({ endpoints: listPeripheralEndpoints(deps) });
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * @openapi
   * /api/catalog/cards:
   *   post:
   *     tags: [Catalog]
   *     summary: Author a declarative card (no code) (Story 5.4)
   *     description: Create a Card Definition from a declarative behavior — a memory board (RAM/EPROM) or a CPU board — registered as source 'authored'. The host synthesizes its runtime bundle, so it seats and runs like a seed card.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [name, behavior]
   *             properties:
   *               name: { type: string }
   *               version: { type: string, description: 'semver; defaults 1.0.0' }
   *               maker: { type: string }
   *               summary: { type: string }
   *               behavior:
   *                 type: object
   *                 description: "{ resolvesTo: 'memory', memKind: 'ram'|'rom' } or { resolvesTo: 'cpu', cpuKind: 'i8080'|'z80' }"
   *               defaults:
   *                 type: object
   *                 properties:
   *                   base: { type: integer }
   *                   size: { type: integer }
   *                   resetVector: { type: integer }
   *     responses:
   *       200: { description: The authored Card Definition }
   *       400: { description: Invalid name/behavior/defaults }
   *       409: { description: Shadows a built-in seed card }
   */
  router.post('/api/catalog/cards', async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await authorCard(deps, req.body ?? {}));
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * @openapi
   * /api/catalog/cards/{id}:
   *   delete:
   *     tags: [Catalog]
   *     summary: Delete an authored card (Story 5.4)
   *     description: Removes an authored Card Definition. Refuses to delete built-in seed cards.
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Deleted }
   *       404: { description: No such card }
   *       409: { description: Not an authored card }
   */
  router.delete('/api/catalog/cards/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      await deleteAuthoredCard(deps, req.params.id);
      res.json({ deleted: true });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/api/catalog/cards', async (req: Request, res: Response): Promise<void> => {
    try {
      const filter: CatalogFilter = {
        kind: typeof req.query.kind === 'string' ? req.query.kind : undefined,
        type: typeof req.query.type === 'string' ? req.query.type : undefined,
        maker: typeof req.query.maker === 'string' ? req.query.maker : undefined,
        capability: typeof req.query.capability === 'string' ? req.query.capability : undefined,
        q: typeof req.query.q === 'string' ? req.query.q : undefined,
      };
      res.json(await browseCatalog(deps, filter));
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * @openapi
   * /api/catalog/cards/{id}:
   *   get:
   *     tags: [Catalog]
   *     summary: Get a Card Definition by Identity
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Card Identity (name@version, e.g. mits-88-2sio@1.0.0)
   *     responses:
   *       200:
   *         description: The Card Definition
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 card:
   *                   $ref: '#/components/schemas/CardDefinition'
   *       404:
   *         description: Not found
   */
  router.get('/api/catalog/cards/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      res.json({ card: await getCardDefinition(deps, req.params.id) });
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * @openapi
   * /api/catalog/cards/{id}/detail:
   *   get:
   *     tags: [Catalog]
   *     summary: Get a card's datasheet (detail)
   *     description: >-
   *       The Card Definition plus its default bus footprint (ports/IRQ), a generated
   *       Skills file (human- and agent-readable), the version list, and the used-by
   *       reverse index (populated once Machine Profiles exist).
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *         description: Card Identity (name@version)
   *     responses:
   *       200:
   *         description: The card datasheet
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/CardDetail'
   *       404:
   *         description: Not found
   */
  router.get('/api/catalog/cards/:id/detail', async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await getCardDetail(deps, req.params.id));
    } catch (error) {
      sendError(res, error);
    }
  });

  /**
   * @openapi
   * /api/catalog/cards/{id}/validate-config:
   *   post:
   *     tags: [Catalog]
   *     summary: Validate a Card Instance config against the card's schema
   *     description: Define-time validation (FR-7) — returns the defaults-filled `resolved` config plus any `errors` (each naming the parameter and the specific violation). Does not throw on invalid values.
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *         description: Card Identity (name@version)
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               config: { type: object, additionalProperties: true }
   *     responses:
   *       200:
   *         description: Validation result
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 resolved: { type: object, additionalProperties: true }
   *                 errors:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       param: { type: string }
   *                       message: { type: string }
   *       404: { description: Card not in the Catalog }
   */
  router.post('/api/catalog/cards/:id/validate-config', async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await checkCardConfig(deps, req.params.id, req.body?.config ?? {}));
    } catch (error) {
      sendError(res, error);
    }
  });
}
