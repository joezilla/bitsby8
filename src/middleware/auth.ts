import { Request, Response, NextFunction } from 'express';

/**
 * Optional API key authentication middleware.
 * When apiKey is set, requires Authorization: Bearer <key> on all requests.
 * When apiKey is null/undefined/empty, passes all requests through.
 */
export function createAuthMiddleware(apiKey: string | undefined | null) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // No API key configured — allow all requests
    if (!apiKey) {
      next();
      return;
    }

    // Skip auth for Swagger docs (so they're always accessible)
    if (req.path.startsWith('/api/docs')) {
      next();
      return;
    }

    // Check Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required. Provide Authorization: Bearer <api-key>' });
      return;
    }

    const token = authHeader.slice(7);
    if (token !== apiKey) {
      res.status(403).json({ error: 'Invalid API key' });
      return;
    }

    next();
  };
}
