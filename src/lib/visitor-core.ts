/**
 * Pure visitor-statistics rules for `POST`/`GET /api/visitors`.
 *
 * Deliberately free of `cloudflare:workers` imports, so `node --test` can import
 * it directly (see tests/visitor-core.test.ts). The route keeps the I/O; every
 * decision that can be expressed without a Worker environment lives here.
 *
 * Read this together with `public/scripts/visit-beacon.js` and the "Turnstile
 * policy" section of AGENTS.md before changing the beacon contract.
 *
 * Semantics this module encodes (audit 2026-11 items #1, #2, #8, #9):
 *
 * - A visit is a *view*, not a unique browser: with a valid visit cookie the
 *   server records every beacon, and the cookie only distinguishes new from
 *   returning visitors (and suppresses Turnstile). Two writes for the same
 *   `visitor_hash` + `path` inside 30 seconds are still one view.
 * - The referrer comes from `document.referrer` in the beacon body — never from
 *   the `Referer` request header, which for a same-origin `fetch()` is the site's
 *   own URL and was therefore always filtered out.
 * - Only known, visitor-facing routes are recorded, and only inside the 200-char
 *   path bound. Junk is accepted with `recorded: false` so the beacon stays
 *   silent.
 * - Dashboard aggregates cover 30 days; the overview totals cover 180 days.
 *   Rows older than 180 days are deleted opportunistically after a write.
 */

/** Rows older than this are removed by the opportunistic cleanup after a POST. */
export const VISIT_RETENTION_DAYS = 180;

/** Trend and top-list queries are limited to this many days. */
export const VISIT_ANALYTICS_DAYS = 30;

/** Overview cards (total views / unique visitors) cover this many days. */
export const VISIT_OVERVIEW_DAYS = 180;

/** Same `visitor_hash` + `path` inside this window counts as one view. */
export const VISIT_DUPLICATE_WINDOW_SECONDS = 30;

/** Longest accepted path, measured after the query and hash are stripped. */
export const VISIT_PATH_MAX_LENGTH = 200;

/** Longest stored referrer hostname. */
export const VISIT_REFERRER_HOST_MAX_LENGTH = 200;

/** Longest referrer string worth parsing; browsers cap `document.referrer`. */
const REFERRER_INPUT_MAX_LENGTH = 2048;

/** Chance of the retention cleanup running, at most once per isolate per UTC day. */
export const VISIT_CLEANUP_CHANCE = 0.01;

/**
 * Route prefixes the beacon may record. The homepage is exact; the other entries
 * match themselves and their sub-paths. `/admin`, `/api` and `/og` are
 * deliberately absent — they are not visitor-facing pages.
 */
export const VISIT_ROUTE_PREFIXES = [
  '/',
  '/posts',
  '/posts/blog/',
  '/posts/novel/',
  '/dictionary',
  '/world',
  '/status',
  '/about',
  '/privacy',
  '/terms',
] as const;

// RFC 3986 `pchar` plus `/`, which is what may legally appear in a URL path. A
// leading `/` is required separately. `%` is allowed so percent-encoded slugs
// survive untouched.
const LEGAL_PATH = /^\/[A-Za-z0-9\-._~%!$&'()*+,;=:@/]*$/;

function stripQueryAndHash(raw: string): string {
  const hashIndex = raw.indexOf('#');
  const withoutHash = hashIndex === -1 ? raw : raw.slice(0, hashIndex);
  const queryIndex = withoutHash.indexOf('?');
  return queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex);
}

function isKnownRoute(path: string): boolean {
  for (const prefix of VISIT_ROUTE_PREFIXES) {
    if (prefix === '/') {
      // The root prefix would match every path, so it is exact-only.
      if (path === '/') return true;
      continue;
    }
    if (path === prefix) return true;
    // `/posts/blog/` already ends in a slash and matches its children; the
    // other prefixes match only a complete segment boundary (`/status/foo`,
    // not `/statusx`).
    if (prefix.endsWith('/') ? path.startsWith(prefix) : path.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

/**
 * Validate and normalise the beacon's `path` field.
 *
 * Accepts only a known visitor-facing route with only legal URL path characters.
 * The query string and fragment are stripped first (a beacon legitimately fires
 * from `/posts?tab=novel`), then the length bound is applied. Dot segments are
 * rejected so `/posts/../admin` cannot masquerade as a known route through the
 * prefix check.
 *
 * @returns the normalised path, or `null` when the value must not be recorded.
 */
export function sanitizeVisitPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;

  const path = stripQueryAndHash(raw);
  if (path.length === 0 || path.length > VISIT_PATH_MAX_LENGTH) return null;
  if (!LEGAL_PATH.test(path)) return null;
  if (path.split('/').some((segment) => segment === '.' || segment === '..')) return null;
  if (!isKnownRoute(path)) return null;

  return path;
}

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '');
}

function apexHostname(value: string): string {
  return normalizeHostname(value).replace(/^www\./, '');
}

/**
 * Parse the referrer string the beacon sends from `document.referrer`.
 *
 * This is intentionally independent of the request's `Referer` header: a
 * same-origin `fetch()` sends the page's own URL there, so using it made
 * `referrer_host` permanently null (audit #2).
 *
 * @param raw           value of the beacon body's `referrer` field
 * @param ownHostnames  hostnames considered internal (the site's www and apex
 *                      forms); links from them are not external referrers
 * @returns the external hostname (≤200 chars), or `null` when it should not be
 *          stored (empty, malformed, non-HTTP(S) or the site's own host)
 */
export function parseReferrerHost(raw: unknown, ownHostnames: readonly string[] = []): string | null {
  if (typeof raw !== 'string') return null;

  const value = raw.trim();
  if (value.length === 0 || value.length > REFERRER_INPUT_MAX_LENGTH) return null;

  let hostname: string;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    hostname = normalizeHostname(url.hostname);
  } catch {
    return null;
  }

  if (hostname.length === 0 || !/^[a-z0-9.-]+$/.test(hostname)) return null;

  // `www.` is not a different site: a link from the site's own www (or apex)
  // host is internal traffic, whichever form the request itself arrived on.
  const own = new Set(ownHostnames.map(apexHostname).filter((entry) => entry.length > 0));
  if (own.has(apexHostname(hostname))) return null;

  return hostname.slice(0, VISIT_REFERRER_HOST_MAX_LENGTH);
}

// --- Duplicate suppression (#9) ---------------------------------------------

/** Minimal D1 surface `isDuplicateVisit` needs, so tests can pass a fake. */
export interface VisitorPreparedStatement {
  bind(...values: unknown[]): { first<T = Record<string, unknown>>(): Promise<T | null> };
}

export interface VisitorDatabase {
  prepare(query: string): VisitorPreparedStatement;
}

/** SQLite `datetime()` modifier for the duplicate window. */
export function duplicateWindowModifier(seconds: number = VISIT_DUPLICATE_WINDOW_SECONDS): string {
  return `-${seconds} seconds`;
}

export function duplicateVisitQuery(): string {
  return `SELECT id FROM visits WHERE visitor_hash = ? AND path = ? AND created_at >= datetime('now', ?) LIMIT 1`;
}

/**
 * True when this exact `visitor_hash` + `path` pair was already written inside
 * the duplicate window. `created_at` is SQLite's `CURRENT_TIMESTAMP` text, which
 * compares lexicographically in the same format `datetime('now', ?)` produces.
 */
export async function isDuplicateVisit(db: VisitorDatabase, visitorHash: string, path: string): Promise<boolean> {
  const row = await db.prepare(duplicateVisitQuery()).bind(visitorHash, path, duplicateWindowModifier()).first();
  return row !== null && row !== undefined;
}

// --- Retention (#8) ----------------------------------------------------------

/** UTC calendar day of a millisecond timestamp, e.g. `2026-11-11`. */
export function utcDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export interface VisitDay {
  day: string;
  views: number;
  uniqueVisitors: number;
}

/**
 * Expand the sparse `GROUP BY day` result into one entry per UTC day for the
 * last `days` days (oldest first, ending on the day of `now`). SQL only returns
 * days that have at least one visit, so without this the dashboard chart drew
 * just the active days and a 30-day window looked like a handful of bars.
 */
export function fillDailyGaps(rows: readonly VisitDay[], now: number, days: number = VISIT_ANALYTICS_DAYS): VisitDay[] {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const filled: VisitDay[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = utcDay(now - offset * 24 * 60 * 60 * 1000);
    filled.push(byDay.get(day) ?? { day, views: 0, uniqueVisitors: 0 });
  }
  return filled;
}

/**
 * Decide whether this request should attempt the retention DELETE.
 *
 * The cleanup is opportunistic and best-effort: at most once per isolate per UTC
 * day, and even then only with a small probability, so a busy isolate does not
 * run the DELETE on every beacon. Both inputs are injectable so the decision can
 * be tested without a clock.
 */
export function shouldAttemptVisitCleanup(options: {
  random: number;
  now: number;
  lastAttemptAt: number;
  chance?: number;
}): boolean {
  const { random, now, lastAttemptAt, chance = VISIT_CLEANUP_CHANCE } = options;
  if (lastAttemptAt > 0 && utcDay(lastAttemptAt) === utcDay(now)) return false;
  return random < chance;
}

/** SQLite `datetime()` modifier that cuts off rows older than the retention window. */
export function visitRetentionModifier(days: number = VISIT_RETENTION_DAYS): string {
  return `-${days} days`;
}

export function visitRetentionQuery(): string {
  return `DELETE FROM visits WHERE created_at < datetime('now', ?)`;
}
