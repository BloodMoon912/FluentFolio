import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { cachedJson } from '../../lib/cached-json';
import {
  decorateStatus,
  isStatusCheckDue,
  normaliseStatusHistory,
  statusCheckCutoff,
  statusHistoryStart,
  statusOverallOk,
  summariseStatusDetail,
  type CachedStatusPayload,
  type StatusCheckRow,
  type StatusHistoryEntry,
  type StatusProbeResult,
  type StatusService,
  type StatusPayload,
} from '../../lib/status-core';

// /api/status is the single source of truth for the homepage panel and the full
// status page (#4). Every row below must come from a real probe:
//
// - website: this request itself. Reaching this code is the evidence that the
//   Worker and route are up, and the latency is how long this handler took.
// - database: an independent, separately timed `SELECT 1` against D1.
// - activity / steam: real outbound requests to Lanyard and the Steam Web API.
//
// There used to be hardcoded `api` and `system` rows with `ok: true`; neither
// had a probe behind it, so both rows are gone. The `system` object below stays
// as informational runtime metadata (read from Cloudflare's request metadata,
// not asserted healthy).
//
// The response is cached for 30 seconds per colo (#7) and carries the last 24
// hours of samples from `status_checks` (#4). Sampling happens here — there is
// no Cron Trigger — at most once per five minutes via an atomic guarded INSERT.

/** How long a status response may be reused. */
export const STATUS_CACHE_TTL_SECONDS = 30;

export const GET: APIRoute = async ({ request, locals }) => {
  const executionContext = (locals as unknown as { cfContext?: ExecutionContext } | undefined)?.cfContext;
  const requestCf = (request as unknown as { cf?: unknown }).cf;

  return cachedJson<CachedStatusPayload, StatusPayload>(
    request,
    STATUS_CACHE_TTL_SECONDS,
    () => buildStatusPayload(locals),
    {
      ...(executionContext ? { waitUntil: (promise: Promise<unknown>) => executionContext.waitUntil(promise) } : {}),
      // The cached payload only contains the shared probe result. Both fields it
      // adds here are per-request and are attached after the cache read:
      // - `checkedAt` so the UI never shows a timestamp up to 30 s old;
      // - `system.edge` because request.cf describes *this* visitor's colo,
      //   city, region and ISP. Caching it would leak the first visitor's
      //   location to everyone else served by the same Cloudflare colo.
      decorate: (payload) => decorateStatus(payload, requestCf, new Date().toISOString()),
    },
  );
};

async function buildStatusPayload(locals: unknown): Promise<CachedStatusPayload> {
  const startedAt = performance.now();
  const [database, activity, steam] = await Promise.all([probeDatabase(), probeActivity(), probeSteam()]);

  // The website probe: this request's own handling time. It is measured last so
  // it also covers the two independent outbound probes above.
  const services: StatusService[] = [
    {
      key: 'website',
      ok: true,
      latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
      detailCode: 'worker_ok',
    },
    { key: 'database', ...database },
    { key: 'activity', ...activity },
    { key: 'steam', ...steam },
  ];

  const nowSeconds = Math.floor(Date.now() / 1000);
  const { history, latestCheckedAt } = await readHistory(nowSeconds);
  const overallOk = statusOverallOk(services);

  recordProbe({ services, overallOk, nowSeconds, latestCheckedAt, locals });

  return {
    ok: overallOk,
    services,
    history,
  };
}

async function probeDatabase(): Promise<StatusProbeResult> {
  const startedAt = performance.now();
  const latencyMs = () => Math.max(1, Math.round(performance.now() - startedAt));
  if (!env.DB) return { ok: false, latencyMs: latencyMs(), detailCode: 'd1_not_configured' };
  try {
    const result = await env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
    const ok = Number(result?.ok) === 1;
    return { ok, latencyMs: latencyMs(), detailCode: ok ? 'db_ok' : 'db_error' };
  } catch {
    return { ok: false, latencyMs: latencyMs(), detailCode: 'db_error' };
  }
}

async function probeActivity(): Promise<StatusProbeResult> {
  const startedAt = performance.now();
  const latencyMs = () => Math.max(1, Math.round(performance.now() - startedAt));
  const id = env.DISCORD_USER_ID;
  if (!id) return { ok: false, latencyMs: latencyMs(), detailCode: 'presence_unavailable' };
  try {
    const response = await fetch(`https://api.lanyard.rest/v1/users/${encodeURIComponent(id)}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Lanyard HTTP ${response.status}`);
    const payload = (await response.json()) as { success?: boolean; data?: { discord_status?: string } };
    if (!payload?.success || !payload?.data) throw new Error('Presence unavailable');
    // The probe only asserts that the presence API answered for this user; any
    // valid presence (including `offline`/`idle`/`dnd`) is healthy. The activity
    // panel itself uses /api/activity.
    return {
      ok: true,
      latencyMs: latencyMs(),
      detailCode: 'presence_ok',
    };
  } catch {
    return { ok: false, latencyMs: latencyMs(), detailCode: 'presence_unavailable' };
  }
}

async function probeSteam(): Promise<StatusProbeResult> {
  const startedAt = performance.now();
  const latencyMs = () => Math.max(1, Math.round(performance.now() - startedAt));
  const key = env.STEAM_API_KEY;
  const id = env.STEAM_ID;
  if (!key || !id) return { ok: false, latencyMs: latencyMs(), detailCode: 'steam_api_unavailable' };
  try {
    const response = await fetch(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${encodeURIComponent(key)}&steamids=${encodeURIComponent(id)}`,
      { cache: 'no-store' },
    );
    if (!response.ok) throw new Error(`Steam HTTP ${response.status}`);
    const json = (await response.json()) as { response?: { players?: unknown[] } };
    if (!json.response?.players?.[0]) throw new Error('Profile unavailable');
    return { ok: true, latencyMs: latencyMs(), detailCode: 'steam_api_ok' };
  } catch {
    return { ok: false, latencyMs: latencyMs(), detailCode: 'steam_api_unavailable' };
  }
}

/**
 * Last-24-hours samples. A missing table (migration not applied yet) or D1
 * outage degrades to an empty history: the live checks above still answer.
 * `latestCheckedAt` feeds the throttle check below.
 */
async function readHistory(
  nowSeconds: number,
): Promise<{ history: StatusHistoryEntry[]; latestCheckedAt: number | null }> {
  if (!env.DB) return { history: [], latestCheckedAt: null };
  try {
    const result = await env.DB.prepare(
      'SELECT checked_at, ok, detail FROM status_checks WHERE checked_at >= ? ORDER BY checked_at ASC LIMIT 1000',
    )
      .bind(statusHistoryStart(nowSeconds))
      .all<StatusCheckRow>();
    const rows = result.results ?? [];
    return {
      history: normaliseStatusHistory(rows, nowSeconds),
      latestCheckedAt: rows.length > 0 ? rows[rows.length - 1].checked_at : null,
    };
  } catch {
    return { history: [], latestCheckedAt: null };
  }
}

/**
 * Appends at most one history row per five minutes. The INSERT is a single
 * statement guarded by `NOT EXISTS`, so concurrent isolates cannot both write
 * the same interval. It runs after the response is sent (`waitUntil`) and its
 * failure is logged, never surfaced to the visitor.
 */
function recordProbe(options: {
  services: readonly StatusService[];
  overallOk: boolean;
  nowSeconds: number;
  latestCheckedAt: number | null;
  locals: unknown;
}) {
  const { services, overallOk, nowSeconds, latestCheckedAt, locals } = options;
  const db = env.DB;
  if (!db) return;
  if (!isStatusCheckDue(nowSeconds, latestCheckedAt)) return;

  const detail = summariseStatusDetail(services);
  const task = db
    .prepare(
      `INSERT INTO status_checks (checked_at, ok, detail)
       SELECT ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM status_checks WHERE checked_at > ?)`,
    )
    .bind(nowSeconds, overallOk ? 1 : 0, detail, statusCheckCutoff(nowSeconds))
    .run()
    .catch((error: unknown) => {
      console.error('[status] failed to record status check:', error);
    });

  const executionContext = (locals as { cfContext?: ExecutionContext } | undefined)?.cfContext;
  if (executionContext?.waitUntil) executionContext.waitUntil(task);
  else void task;
}
