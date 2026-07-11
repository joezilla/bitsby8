import { Router, Request, Response } from 'express';
import { Dependencies } from '../types';
import { safeErrorMessage } from '../utils/safe-path';
import { ServiceError } from '../services/service-error';
import { browseCatalog, getCardDefinition, CatalogFilter } from '../services/catalog';
import { getCardDetail } from '../services/card-detail';

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
}
