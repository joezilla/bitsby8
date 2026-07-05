/**
 * Release Check Service
 *
 * Periodically polls GitHub for the newest fdcplus-web release so the
 * status endpoint can tell the UI when a newer version is available.
 * Prereleases are included — a user running an rc build should be
 * notified about a newer rc.
 *
 * The check is opt-out via `config.system.updateCheck.enabled = false`.
 * Failures (network, rate limit, 5xx) are silent: last cache is kept
 * and the /api/status response falls back to `updateAvailable: false`
 * with null fields.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../package.json') as { version: string };

const GITHUB_OWNER = 'joezilla';
const GITHUB_REPO = 'fdcplus-web';
const RELEASES_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=5`;
const INITIAL_DELAY_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;
const USER_AGENT = `fdcplus-web/${pkg.version}`;

export interface LatestRelease {
  tag: string;         // "v2.0.2"
  version: string;     // "2.0.2" (leading v stripped, ready for compareSemver)
  htmlUrl: string;
  publishedAt: string; // ISO
  checkedAt: string;   // ISO — when this cache entry was populated
}

export interface ReleaseCheckOptions {
  enabled: boolean;
  intervalHours: number;
}

let cache: LatestRelease | null = null;

export function getLatestRelease(): LatestRelease | null {
  return cache;
}

/** Reset the cache. Only used by tests. */
export function _resetReleaseCache(): void {
  cache = null;
}

/**
 * Kick off the poll loop. Returns a stop function that clears the
 * pending timers. Safe to call `stop()` more than once.
 */
export function startReleaseChecker(options: ReleaseCheckOptions): () => void {
  if (!options.enabled) {
    return () => {
      /* noop — checker was never started */
    };
  }

  const intervalMs = Math.max(1, options.intervalHours) * 60 * 60 * 1000;

  const initial = setTimeout(() => {
    void runCheck();
  }, INITIAL_DELAY_MS);

  const repeat = setInterval(() => {
    void runCheck();
  }, intervalMs);

  return () => {
    clearTimeout(initial);
    clearInterval(repeat);
  };
}

/**
 * Perform one fetch. Exported for tests; production wiring calls it
 * from the interval loop above.
 */
export async function runCheck(): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(RELEASES_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': USER_AGENT,
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      // 403 for rate-limit, 404 for wrong repo, 5xx transient. Keep
      // the existing cache and move on — noisy logs help nobody.
      return;
    }
    const body = (await res.json()) as unknown;
    if (!Array.isArray(body)) return;

    const picked = pickNewest(body);
    if (!picked) return;

    cache = {
      tag: picked.tag_name,
      version: stripLeadingV(picked.tag_name),
      htmlUrl: picked.html_url,
      publishedAt: picked.published_at ?? picked.created_at ?? new Date().toISOString(),
      checkedAt: new Date().toISOString(),
    };
  } catch {
    // Network error / abort / JSON parse. Silent.
  } finally {
    clearTimeout(timeout);
  }
}

interface GithubRelease {
  tag_name: string;
  html_url: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string | null;
  created_at?: string | null;
}

function pickNewest(list: unknown[]): GithubRelease | null {
  const usable: GithubRelease[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.tag_name !== 'string') continue;
    if (typeof r.html_url !== 'string') continue;
    if (r.draft === true) continue; // never surface drafts
    usable.push({
      tag_name: r.tag_name,
      html_url: r.html_url,
      draft: r.draft === true,
      prerelease: r.prerelease === true,
      published_at: (r.published_at as string | null | undefined) ?? null,
      created_at: (r.created_at as string | null | undefined) ?? null,
    });
  }
  if (usable.length === 0) return null;

  // Sort by semver descending — GitHub returns list newest-first by
  // creation time, but tags can be created out of order (e.g. hotfix
  // on an older branch). Semver order is what the UI actually cares
  // about.
  usable.sort((a, b) => compareSemver(stripLeadingV(b.tag_name), stripLeadingV(a.tag_name)));
  return usable[0];
}

function stripLeadingV(tag: string): string {
  return tag.startsWith('v') || tag.startsWith('V') ? tag.slice(1) : tag;
}

/**
 * Semver 2.0.0 precedence comparator.
 *
 *   compareSemver('2.0.1', '2.0.0')      →  1
 *   compareSemver('2.0.1-rc.1', '2.0.1') → -1  (prerelease < release)
 *   compareSemver('2.0.1-rc.2', '2.0.1-rc.1') → 1
 *
 * Non-semver inputs (missing patch, garbage suffixes) fall through to
 * a lenient parse that treats missing components as 0.
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1;
  }
  // Same MAJOR.MINOR.PATCH — apply prerelease precedence.
  // "A version with a pre-release has lower precedence than a normal version." (§11.3)
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0;
  if (pa.pre.length === 0) return 1;  // a is stable, b is prerelease
  if (pb.pre.length === 0) return -1; // b is stable, a is prerelease
  return comparePrerelease(pa.pre, pb.pre);
}

interface ParsedVersion {
  core: [number, number, number];
  pre: string[];
}

function parseSemver(v: string): ParsedVersion {
  // Strip build metadata (§10) — it doesn't participate in precedence.
  const plus = v.indexOf('+');
  const withoutBuild = plus === -1 ? v : v.slice(0, plus);
  const dash = withoutBuild.indexOf('-');
  const coreStr = dash === -1 ? withoutBuild : withoutBuild.slice(0, dash);
  const preStr = dash === -1 ? '' : withoutBuild.slice(dash + 1);

  const parts = coreStr.split('.');
  const core: [number, number, number] = [
    toIntOrZero(parts[0]),
    toIntOrZero(parts[1]),
    toIntOrZero(parts[2]),
  ];
  const pre = preStr === '' ? [] : preStr.split('.');
  return { core, pre };
}

function toIntOrZero(s: string | undefined): number {
  if (!s) return 0;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Semver §11.4 identifier-by-identifier precedence rules. */
function comparePrerelease(a: string[], b: string[]): -1 | 0 | 1 {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i];
    const bi = b[i];
    const aNum = /^[0-9]+$/.test(ai);
    const bNum = /^[0-9]+$/.test(bi);
    if (aNum && bNum) {
      const na = parseInt(ai, 10);
      const nb = parseInt(bi, 10);
      if (na !== nb) return na < nb ? -1 : 1;
    } else if (aNum !== bNum) {
      // Numeric identifiers always have lower precedence than alpha.
      return aNum ? -1 : 1;
    } else if (ai !== bi) {
      return ai < bi ? -1 : 1;
    }
  }
  // Prefix match — the longer set has higher precedence.
  if (a.length === b.length) return 0;
  return a.length < b.length ? -1 : 1;
}
