/**
 * In-memory session store for the UI login flow.
 *
 * The dashboard has one operator, so per-user tracking is overkill.
 * We just mint an opaque session ID on successful `POST /api/auth/login`
 * and hand it to the browser as an HttpOnly cookie. Later requests
 * carry the cookie, we look up the ID here, and either allow or 401.
 *
 * Trade-offs vs. persisting sessions to SQLite:
 *   - Sessions die on daemon restart. Operators re-login after each
 *     `sudo systemctl restart fdcsds`. Acceptable UX for this use case;
 *     the alternative would need a DB migration and a bigger surface
 *     for stale-session hygiene.
 *   - Zero disk I/O on the hot auth path.
 *   - A `MAX_SESSIONS` cap keeps the map bounded even if a compromised
 *     password loop-spams `/api/auth/login`. LRU eviction on overflow
 *     picks the session with the closest expiry (i.e. oldest, since
 *     TTLs are equal-length and sliding is the only refresh mechanism).
 */

import { randomBytes } from 'crypto';

export const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days sliding
export const MAX_SESSIONS = 100;

interface SessionEntry {
  expiresAt: number;
}

export class SessionStore {
  private sessions = new Map<string, SessionEntry>();

  constructor(
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly maxSessions: number = MAX_SESSIONS,
  ) {}

  /**
   * Mint a fresh session ID and record its expiry. Evicts the oldest
   * entry when the store is at capacity — an unauthenticated attacker
   * can't reach this endpoint, but a compromised password shouldn't be
   * able to grow the map without bound either.
   */
  createSession(now: number = Date.now()): string {
    if (this.sessions.size >= this.maxSessions) {
      this.evictOldest();
    }
    // 32 bytes → 43-char base64url. Unpredictable and URL-safe.
    const id = randomBytes(32).toString('base64url');
    this.sessions.set(id, { expiresAt: now + this.ttlMs });
    return id;
  }

  /**
   * Returns true iff the session exists and hasn't expired. On a hit
   * the TTL slides forward — long-lived idle sessions get pruned, but
   * an operator hitting the UI at least once every 30 days stays
   * logged in indefinitely.
   */
  validateSession(id: string, now: number = Date.now()): boolean {
    const entry = this.sessions.get(id);
    if (!entry) return false;
    if (entry.expiresAt <= now) {
      this.sessions.delete(id);
      return false;
    }
    entry.expiresAt = now + this.ttlMs;
    return true;
  }

  /** Drop a specific session — used by logout. Idempotent. */
  destroySession(id: string): void {
    this.sessions.delete(id);
  }

  /**
   * Drop every session except one — used after a successful password
   * change to force other browsers to re-authenticate without kicking
   * the operator out of the current window.
   */
  destroyAllExcept(keepId: string): void {
    for (const id of this.sessions.keys()) {
      if (id !== keepId) this.sessions.delete(id);
    }
  }

  /** Drop every session — used when the daemon rotates credentials wholesale. */
  destroyAll(): void {
    this.sessions.clear();
  }

  /** Visible for tests. */
  size(): number {
    return this.sessions.size;
  }

  private evictOldest(): void {
    // Sessions all have equal-length TTLs, so "oldest" == "expiresAt
    // furthest in the past". Linear scan is fine at N ≤ 100.
    let oldestId: string | null = null;
    let oldestExpiry = Infinity;
    for (const [id, entry] of this.sessions) {
      if (entry.expiresAt < oldestExpiry) {
        oldestExpiry = entry.expiresAt;
        oldestId = id;
      }
    }
    if (oldestId !== null) this.sessions.delete(oldestId);
  }
}
