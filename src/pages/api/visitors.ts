import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getClientIp } from '../../lib/request';
import { cachedJson } from '../../lib/cached-json';
import { parseHostnameList, verifyTurnstileToken } from '../../lib/turnstile';
import { hasValidVisitorCookie, issueVisitorCookie } from '../../lib/visitor-auth';
import {
  VISIT_ANALYTICS_DAYS,
  VISIT_OVERVIEW_DAYS,
  VISIT_RETENTION_DAYS,
  fillDailyGaps,
  isDuplicateVisit,
  parseReferrerHost,
  sanitizeVisitPath,
  shouldAttemptVisitCleanup,
  visitRetentionModifier,
  visitRetentionQuery,
} from '../../lib/visitor-core';

async function hashVisitor(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** What the beacon sends. Everything except `path` is optional. */
interface VisitBody {
  path?: unknown;
  referrer?: unknown;
  'cf-turnstile-response'?: unknown;
}

// UTC day of the last retention attempt, 0 = never. Module state is per isolate,
// which is exactly the scope the cleanup needs: at most one DELETE per isolate
// per day. The rows themselves are shared, so a second isolate is harmless.
let lastCleanupAttemptAt = 0;

/**
 * #8: best-effort retention. Never awaited by the request path, never allowed to
 * affect the response — a failed DELETE is a log line, nothing more.
 */
function scheduleRetentionCleanup(db: D1Database, executionContext: ExecutionContext | undefined) {
  const now = Date.now();
  if (!shouldAttemptVisitCleanup({ random: Math.random(), now, lastAttemptAt: lastCleanupAttemptAt })) return;
  lastCleanupAttemptAt = now;

  const task = db
    .prepare(visitRetentionQuery())
    .bind(visitRetentionModifier(VISIT_RETENTION_DAYS))
    .run()
    .then(() => undefined)
    .catch((error: unknown) => {
      console.error(`[visitors] retention cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    });

  if (executionContext?.waitUntil) executionContext.waitUntil(task);
  else void task;
}

function noStoreResponse(payload: Record<string, unknown>, status = 200, extraHeaders: Record<string, string> = {}) {
  return Response.json(payload, {
    status,
    headers: { 'cache-control': 'no-store', ...extraHeaders },
  });
}

function visitResponse(payload: Record<string, unknown>, setCookie: string | null) {
  const headers: Record<string, string> = { 'cache-control': 'no-store' };
  if (setCookie) headers['Set-Cookie'] = setCookie;
  return Response.json(payload, { headers });
}

export const POST: APIRoute = async ({ request, url, locals }) => {
  if (!env.DB) return noStoreResponse({ ok: false, configured: false });

  // #9: this endpoint is public by design, so a per-IP Worker Rate Limiting
  // binding is the cheap first line against spam. It runs before the body is
  // parsed and before any D1 query: over the limit → 429 and no write.
  const limiter = env.VISITOR_RATE_LIMIT;
  if (limiter) {
    // Fail open if the binding itself throws: analytics must never become a
    // site-wide error page.
    const { success } = await limiter
      .limit({ key: `visitor:${getClientIp(request)}` })
      .catch(() => ({ success: true }));
    if (!success) {
      return noStoreResponse({ ok: false, error: 'Too many requests.' }, 429, { 'retry-after': '60' });
    }
  }

  const body: VisitBody = await request.json().catch(() => ({}));
  const hasCookie = await hasValidVisitorCookie(request);

  // #1: a valid visit cookie means "returning browser", not "already counted".
  // The cookie still suppresses Turnstile, but it no longer suppresses the D1
  // write — that old behaviour is what made the "views" figure really mean
  // "unique browsers per 30 days". A cookie-bearing beacon is recorded
  // immediately, below.
  //
  // A browser without a cookie goes through the existing token flow when
  // TURNSTILE_SECRET is configured. Bot protection is opt-in through
  // configuration and fails open; see the "Turnstile policy" in AGENTS.md.
  if (!hasCookie && env.TURNSTILE_SECRET) {
    const outcome = await verifyTurnstileToken({
      token: body['cf-turnstile-response'],
      remoteip: getClientIp(request),
      expectedAction: 'visit',
      secret: env.TURNSTILE_SECRET,
      allowedHostnames: parseHostnameList(env.TURNSTILE_HOSTNAMES),
    });

    if (!outcome.ok) {
      // `missing-token` is the only reason a client is expected to act on, and
      // the only one that means "come back with a token". Every other reason is
      // a dead end, so the client must not retry on it.
      //
      // Logged because the previous integration failed silently for exactly this
      // reason: rejections produced no signal anywhere, so nobody could tell a
      // bad token from a misconfigured hostname list. Worker logs and traces are
      // enabled in wrangler.jsonc, so `reason` is visible there.
      console.warn(`[turnstile] visitor verification rejected: ${outcome.reason}`);
      return noStoreResponse({ ok: false, error: 'Turnstile verification failed.', reason: outcome.reason }, 403);
    }
  } else if (!hasCookie) {
    console.warn('[turnstile] TURNSTILE_SECRET is not set; POST /api/visitors is unprotected');
  }

  // #9: only known visitor-facing routes are stored. Junk is accepted so the
  // beacon stays silent, but nothing is written — and no cookie is issued.
  const path = sanitizeVisitPath(body.path);
  if (!path) return noStoreResponse({ ok: true, recorded: false });

  // #2: the referrer arrives in the beacon body (`document.referrer`) because a
  // same-origin fetch always sends the site's own URL in the `Referer` header.
  // Only the first beacon of a tab sends it, so later SPA navigations store null.
  const clientHostname = url.hostname.toLowerCase();
  const ownHostnames = clientHostname ? [clientHostname, clientHostname.replace(/^www\./, '')] : [];
  const referrerHost = parseReferrerHost(body.referrer, ownHostnames);

  // Production must have a dedicated salt before anything is written. Without
  // it the visitor hash would fall back to a predictable value (or another
  // feature's secret), which both weakens the privacy claim and lets a public
  // endpoint write unbounded rows. Returning success keeps the beacon harmless
  // for the browser; `recorded: false` says nothing was stored.
  if (import.meta.env.PROD && !env.VISITOR_SALT) {
    console.error('[visitors] VISITOR_SALT is not configured; skipping visitor write in production');
    return noStoreResponse({ ok: true, configured: true, recorded: false });
  }

  const ip = getClientIp(request);
  // Prefer the dedicated salt, then any other real secret, and only fall back to
  // the public literal locally. Visitor hashes are the only thing standing
  // between a stored row and an enumerable IPv4 address, so hashing with a salt
  // that is published in this repository would contradict the privacy policy's
  // "the IP is never stored".
  if (!env.VISITOR_SALT) {
    console.warn('[visitors] VISITOR_SALT is not set; falling back to another secret for visitor hashing');
  }
  const salt = env.VISITOR_SALT || env.VISITOR_COOKIE_SECRET || env.TURNSTILE_SECRET || 'development-salt';
  const visitorHash = await hashVisitor(`${salt}:${ip}`);

  const country = request.cf?.country || null;

  // A no-cookie visitor who passed the checks above (or skipped Turnstile
  // because it is not configured) gets the cookie even when this particular view
  // is not recorded, so a returning browser is not challenged again.
  const setCookie = hasCookie ? null : await issueVisitorCookie().catch(() => null);

  // #9: the same visitor_hash + path written again within 30 seconds is one
  // view. A tab already sends each path at most once; this also covers two tabs.
  if (await isDuplicateVisit(env.DB, visitorHash, path)) {
    return visitResponse({ ok: true, visited: true, recorded: false }, setCookie);
  }

  await env.DB.prepare('INSERT INTO visits(path, visitor_hash, country, referrer_host) VALUES(?,?,?,?)')
    .bind(path, visitorHash, country, referrerHost)
    .run();

  scheduleRetentionCleanup(env.DB, (locals as unknown as { cfContext?: ExecutionContext } | undefined)?.cfContext);

  return visitResponse({ ok: true, visited: true, recorded: true }, setCookie);
};

interface VisitsOverviewRow {
  total?: number | null;
  uniqueVisitors?: number | null;
  last24h?: number | null;
}

interface VisitsDirectRow {
  direct?: number | null;
}

interface VisitDayRow {
  day?: string | null;
  views?: number | null;
  uniqueVisitors?: number | null;
}

interface VisitPathRow {
  path?: string | null;
  views?: number | null;
}

interface VisitCountryRow {
  country?: string | null;
  views?: number | null;
}

interface VisitReferrerRow {
  referrer_host?: string | null;
  views?: number | null;
}

/** The dashboard polls this once a minute, so the shared cache matches that cadence. */
const VISITOR_CACHE_TTL_SECONDS = 60;

interface VisitorAggregate {
  configured: true;
  windowDays: number;
  overviewDays: number;
  total: number;
  uniqueVisitors: number;
  last24h: number;
  direct: number;
  daily: Array<{ day: string; views: number; uniqueVisitors: number }>;
  topPaths: Array<{ path: string; views: number }>;
  topCountries: Array<{ country: string; views: number }>;
  topReferrers: Array<{ host: string; views: number }>;
  /** Cookie-derived; merged per request by `cachedJson`'s `decorate`, never cached. */
  visited?: boolean;
}

/**
 * The request-independent aggregate. It is the value cached for
 * `VISITOR_CACHE_TTL_SECONDS`; `visited` is deliberately absent and is added
 * outside the cache on every request.
 */
async function buildVisitorAggregate(db: D1Database): Promise<VisitorAggregate> {
  // #8: the aggregation queries are bounded. Trend and top lists cover the last
  // 30 days; the two overview cards cover 180 days. Before this they had no
  // WHERE clause at all, so every request scanned the whole (ever-growing)
  // table.
  const analyticsWindow = `-${VISIT_ANALYTICS_DAYS} days`;
  const overviewWindow = `-${VISIT_OVERVIEW_DAYS} days`;

  const [overview, direct, daily, topPaths, topCountries, topReferrers] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS total, COUNT(DISTINCT visitor_hash) AS uniqueVisitors,
      SUM(CASE WHEN created_at >= datetime('now','-24 hours') THEN 1 ELSE 0 END) AS last24h
      FROM visits WHERE created_at >= datetime('now', ?)`,
      )
      .bind(overviewWindow)
      .first<VisitsOverviewRow>(),
    db
      .prepare(`SELECT COUNT(*) AS direct FROM visits WHERE created_at >= datetime('now', ?) AND referrer_host IS NULL`)
      .bind(analyticsWindow)
      .first<VisitsDirectRow>(),
    db
      .prepare(
        `SELECT substr(created_at,1,10) AS day, COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS uniqueVisitors
      FROM visits WHERE created_at >= datetime('now', ?) GROUP BY substr(created_at,1,10) ORDER BY day ASC`,
      )
      .bind(analyticsWindow)
      .all<VisitDayRow>(),
    db
      .prepare(
        `SELECT path, COUNT(*) AS views FROM visits WHERE created_at >= datetime('now', ?) GROUP BY path ORDER BY views DESC LIMIT 6`,
      )
      .bind(analyticsWindow)
      .all<VisitPathRow>(),
    db
      .prepare(
        `SELECT country, COUNT(*) AS views FROM visits WHERE created_at >= datetime('now', ?) AND country IS NOT NULL GROUP BY country ORDER BY views DESC LIMIT 6`,
      )
      .bind(analyticsWindow)
      .all<VisitCountryRow>(),
    db
      .prepare(
        `SELECT referrer_host, COUNT(*) AS views FROM visits WHERE created_at >= datetime('now', ?) AND referrer_host IS NOT NULL GROUP BY referrer_host ORDER BY views DESC LIMIT 6`,
      )
      .bind(analyticsWindow)
      .all<VisitReferrerRow>(),
  ]);

  return {
    configured: true,
    windowDays: VISIT_ANALYTICS_DAYS,
    overviewDays: VISIT_OVERVIEW_DAYS,
    total: Number(overview?.total ?? 0),
    uniqueVisitors: Number(overview?.uniqueVisitors ?? 0),
    last24h: Number(overview?.last24h ?? 0),
    direct: Number(direct?.direct ?? 0),
    // One entry per day, zero-filled: the query only returns days with visits.
    daily: fillDailyGaps(
      (daily.results || []).map((row) => ({
        day: String(row.day ?? ''),
        views: Number(row.views ?? 0),
        uniqueVisitors: Number(row.uniqueVisitors ?? 0),
      })),
      Date.now(),
    ),
    topPaths: (topPaths.results || []).map((row) => ({
      path: String(row.path ?? '/'),
      views: Number(row.views ?? 0),
    })),
    topCountries: (topCountries.results || []).map((row) => ({
      country: String(row.country ?? ''),
      views: Number(row.views ?? 0),
    })),
    topReferrers: (topReferrers.results || []).map((row) => ({
      host: String(row.referrer_host ?? ''),
      views: Number(row.views ?? 0),
    })),
  };
}

export const GET: APIRoute = async ({ request, locals }) => {
  const visited = await hasValidVisitorCookie(request);
  const db = env.DB;
  if (!db) return noStoreResponse({ configured: false, visited });

  const executionContext = (locals as unknown as { cfContext?: ExecutionContext } | undefined)?.cfContext;

  return cachedJson(request, VISITOR_CACHE_TTL_SECONDS, () => buildVisitorAggregate(db), {
    // `visited` comes from the request cookie, so it is merged after the shared
    // cache read on every request — and never stored (cache key has no cookies).
    decorate: (value) => ({ ...value, visited }),
    ...(executionContext ? { waitUntil: (promise: Promise<unknown>) => executionContext.waitUntil(promise) } : {}),
  });
};
