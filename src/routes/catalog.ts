import { Router, Request, Response } from 'express';
import { Dependencies } from '../types';
import { safeErrorMessage } from '../utils/safe-path';
import { ServiceError } from '../services/service-error';
import { listCardDefinitions, getCardDefinition } from '../services/catalog';

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
   *     summary: List Card Definitions
   *     description: Returns every Card Definition in the Catalog (seed cards in Tier-1), with Identity, type, and manifest.
   *     responses:
   *       200:
   *         description: Array of Card Definitions
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 cards:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/CardDefinition'
   */
  router.get('/api/catalog/cards', async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json({ cards: await listCardDefinitions(deps) });
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
}
