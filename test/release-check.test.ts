/**
 * Release-check service tests.
 *
 * Covers the semver comparator (including prerelease rules) and the
 * fetch-driven cache — GitHub API responses are mocked, no live calls.
 */

import {
  compareSemver,
  getLatestRelease,
  runCheck,
  startReleaseChecker,
  _resetReleaseCache,
} from '../src/services/release-check';

describe('compareSemver', () => {
  test('numeric core comparison', () => {
    expect(compareSemver('2.0.1', '2.0.0')).toBe(1);
    expect(compareSemver('2.0.0', '2.0.1')).toBe(-1);
    expect(compareSemver('2.1.0', '2.0.9')).toBe(1);
    expect(compareSemver('3.0.0', '2.99.99')).toBe(1);
    expect(compareSemver('2.0.0', '2.0.0')).toBe(0);
  });

  test('prerelease < release for same core (semver 11.3)', () => {
    expect(compareSemver('2.0.1-rc.1', '2.0.1')).toBe(-1);
    expect(compareSemver('2.0.1', '2.0.1-rc.1')).toBe(1);
  });

  test('prerelease identifiers compare per semver 11.4', () => {
    expect(compareSemver('2.0.1-rc.2', '2.0.1-rc.1')).toBe(1);
    expect(compareSemver('2.0.1-rc.1', '2.0.1-rc.2')).toBe(-1);
    expect(compareSemver('2.0.1-rc.1', '2.0.1-rc.1')).toBe(0);
    // Numeric < alpha identifier
    expect(compareSemver('2.0.1-1', '2.0.1-alpha')).toBe(-1);
    // Longer set of identifiers has higher precedence when prefix matches
    expect(compareSemver('2.0.1-rc.1.1', '2.0.1-rc.1')).toBe(1);
  });

  test('build metadata is ignored (semver 10)', () => {
    expect(compareSemver('2.0.1+build.1', '2.0.1+build.2')).toBe(0);
    expect(compareSemver('2.0.1-rc.1+abc', '2.0.1-rc.1+xyz')).toBe(0);
  });
});

describe('release-check fetch cache', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    _resetReleaseCache();
    fetchMock = jest.fn();
    (global as unknown as { fetch: unknown }).fetch = fetchMock;
  });

  afterEach(() => {
    (global as unknown as { fetch: unknown }).fetch = originalFetch;
  });

  function mockReleaseList(releases: Array<Partial<{
    tag_name: string;
    html_url: string;
    draft: boolean;
    prerelease: boolean;
    published_at: string;
  }>>) {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => releases,
    } as Response);
  }

  test('populates cache from first non-draft release, semver-sorted', async () => {
    mockReleaseList([
      { tag_name: 'v2.0.0', html_url: 'https://example.test/v2.0.0', published_at: '2026-01-01T00:00:00Z' },
      { tag_name: 'v2.0.2', html_url: 'https://example.test/v2.0.2', published_at: '2026-06-01T00:00:00Z' },
      { tag_name: 'v2.0.1', html_url: 'https://example.test/v2.0.1', published_at: '2026-03-01T00:00:00Z' },
    ]);

    await runCheck();

    const cached = getLatestRelease();
    expect(cached).not.toBeNull();
    expect(cached?.version).toBe('2.0.2');
    expect(cached?.tag).toBe('v2.0.2');
    expect(cached?.htmlUrl).toBe('https://example.test/v2.0.2');
    expect(cached?.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('picks newest prerelease when caller is on an rc build', async () => {
    mockReleaseList([
      { tag_name: 'v2.0.1-rc.2', html_url: 'https://example.test/rc2', published_at: '2026-06-01T00:00:00Z' },
      { tag_name: 'v2.0.1-rc.1', html_url: 'https://example.test/rc1', published_at: '2026-05-01T00:00:00Z' },
    ]);
    await runCheck();
    expect(getLatestRelease()?.version).toBe('2.0.1-rc.2');
    expect(compareSemver(getLatestRelease()!.version, '2.0.1-rc.1')).toBe(1);
  });

  test('skips drafts', async () => {
    mockReleaseList([
      { tag_name: 'v3.0.0', html_url: 'https://example.test/draft', draft: true },
      { tag_name: 'v2.0.1', html_url: 'https://example.test/v2.0.1' },
    ]);
    await runCheck();
    expect(getLatestRelease()?.version).toBe('2.0.1');
  });

  test('non-2xx response keeps previous cache intact', async () => {
    // First: successful fetch seeds cache.
    mockReleaseList([{ tag_name: 'v2.0.1', html_url: 'https://example.test/v2.0.1' }]);
    await runCheck();
    expect(getLatestRelease()?.version).toBe('2.0.1');

    // Then: rate-limit 403 must not clobber cache.
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) } as Response);
    await runCheck();
    expect(getLatestRelease()?.version).toBe('2.0.1');
  });

  test('network error is swallowed', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(runCheck()).resolves.toBeUndefined();
    expect(getLatestRelease()).toBeNull();
  });

  test('non-array body is ignored', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ message: 'Not Found' }),
    } as Response);
    await runCheck();
    expect(getLatestRelease()).toBeNull();
  });

  test('startReleaseChecker returns noop when disabled and never calls fetch', () => {
    const stop = startReleaseChecker({ enabled: false, intervalHours: 6 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
    // Second stop is idempotent.
    expect(() => stop()).not.toThrow();
  });

  test('stop cancels the scheduled initial fetch before it fires', () => {
    jest.useFakeTimers();
    try {
      const stop = startReleaseChecker({ enabled: true, intervalHours: 6 });
      stop();
      jest.advanceTimersByTime(60 * 60 * 1000); // one hour of virtual time
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
