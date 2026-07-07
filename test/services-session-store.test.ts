/**
 * Tests for the in-memory session store used by the UI login flow.
 */

import { SessionStore } from '../src/services/session-store';

describe('SessionStore', () => {
  test('createSession returns a fresh opaque ID each call', () => {
    const store = new SessionStore();
    const a = store.createSession();
    const b = store.createSession();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{40,}$/); // base64url of 32 bytes
  });

  test('validateSession true for a fresh session, false for an unknown one', () => {
    const store = new SessionStore();
    const id = store.createSession();
    expect(store.validateSession(id)).toBe(true);
    expect(store.validateSession('bogus-id')).toBe(false);
  });

  test('validateSession slides the TTL forward on hit — long-lived idle sessions expire, active ones stay', () => {
    const ttlMs = 1000;
    const store = new SessionStore(ttlMs);
    const t0 = 10_000;
    const id = store.createSession(t0);

    // 900ms later: still valid, TTL extends to 1900ms.
    expect(store.validateSession(id, t0 + 900)).toBe(true);
    // Another 900ms: still valid because the previous hit slid the
    // expiry forward. Without the slide, this would 401.
    expect(store.validateSession(id, t0 + 1800)).toBe(true);
    // Now leave it alone for > ttlMs: expires.
    expect(store.validateSession(id, t0 + 3000)).toBe(false);
  });

  test('destroySession makes a previously-valid session unusable', () => {
    const store = new SessionStore();
    const id = store.createSession();
    expect(store.validateSession(id)).toBe(true);
    store.destroySession(id);
    expect(store.validateSession(id)).toBe(false);
  });

  test('destroyAllExcept keeps the caller logged in and boots everyone else', () => {
    const store = new SessionStore();
    const keeper = store.createSession();
    const other1 = store.createSession();
    const other2 = store.createSession();
    store.destroyAllExcept(keeper);
    expect(store.validateSession(keeper)).toBe(true);
    expect(store.validateSession(other1)).toBe(false);
    expect(store.validateSession(other2)).toBe(false);
  });

  test('LRU evicts the oldest session when capacity is exceeded', () => {
    const store = new SessionStore(10_000, 2);
    const a = store.createSession(1000);
    const b = store.createSession(2000);
    // Adding a third with cap=2 evicts the oldest (a).
    const c = store.createSession(3000);
    expect(store.validateSession(a, 3000)).toBe(false);
    expect(store.validateSession(b, 3000)).toBe(true);
    expect(store.validateSession(c, 3000)).toBe(true);
    expect(store.size()).toBe(2);
  });

  test('destroyAll clears every session', () => {
    const store = new SessionStore();
    store.createSession();
    store.createSession();
    store.destroyAll();
    expect(store.size()).toBe(0);
  });
});
