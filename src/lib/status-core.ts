// Pure logic for the /api/status probe and its 24-hour history (#4).
//
// Kept free of `cloudflare:workers`, D1 and `fetch` so `node --test` can import
// it directly; src/pages/api/status.ts is the only place that talks to the
// network, D1 or the Worker bindings.
//
// There is no Cron Trigger. The Worker samples itself opportunistically: every
// real /api/status request may append a history row, but only if the newest row
// is at least STATUS_CHECK_INTERVAL_SECONDS old. `statusCheckCutoff()` is the
// same threshold used by the atomic `INSERT … WHERE NOT EXISTS` statement, so
// two concurrent isolates cannot both record the same interval.

/** Minimum spacing between recorded history rows: five minutes. */
export const STATUS_CHECK_INTERVAL_SECONDS = 300;

/** How much history `/api/status` returns and the status page renders. */
export const STATUS_HISTORY_HOURS = 24;

/** Upper bound on returned rows: one per five minutes over 24 hours. */
export const STATUS_HISTORY_LIMIT = (STATUS_HISTORY_HOURS * 60 * 60) / STATUS_CHECK_INTERVAL_SECONDS;

export interface StatusProbeLike {
  key: string;
  ok: boolean;
}

/**
 * Cloudflare request metadata (`request.cf`) shown on the status page.
 *
 * **This is per-requester data and must never be cached.** The same Cloudflare
 * colo serves many visitors; caching the first visitor's city/region/ISP would
 * show it to everyone else in that colo for the TTL. `/api/status` builds this
 * block in `decorate`, after the shared probe payload is read from the cache.
 */
export interface StatusEdgeMetadata {
  colo: string | null;
  country: string | null;
  city: string | null;
  region: string | null;
  asOrganization: string | null;
  httpProtocol: string | null;
  tlsVersion: string | null;
}

export interface StatusSystemMetadata {
  runtime: string;
  edge: StatusEdgeMetadata;
  now: string;
}

/** Constant runtime name shown in the system block. */
export const STATUS_RUNTIME_NAME = 'Cloudflare Workers';

/** Every field null; only used as a safe empty shape in tests/fallbacks. */
export function emptyStatusEdge(): StatusEdgeMetadata {
  return {
    colo: null,
    country: null,
    city: null,
    region: null,
    asOrganization: null,
    httpProtocol: null,
    tlsVersion: null,
  };
}

function stringField(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' ? value : null;
}

/**
 * Build the system block for the *current* request. Call this in `decorate`, not
 * in the cached producer: the value is derived from `request.cf` and differs per
 * visitor (Cloudflare may report the visitor's city, region and ISP).
 */
export function readStatusSystem(cf: unknown, now: string): StatusSystemMetadata {
  const source = cf && typeof cf === 'object' ? (cf as Record<string, unknown>) : {};
  return {
    runtime: STATUS_RUNTIME_NAME,
    edge: {
      colo: stringField(source, 'colo'),
      country: stringField(source, 'country'),
      city: stringField(source, 'city'),
      region: stringField(source, 'region'),
      asOrganization: stringField(source, 'asOrganization'),
      httpProtocol: stringField(source, 'httpProtocol'),
      tlsVersion: stringField(source, 'tlsVersion'),
    },
    now,
  };
}

export interface StatusProbeResult {
  ok: boolean;
  latencyMs: number;
  detailCode: string;
}

export interface StatusService extends StatusProbeResult {
  key: 'website' | 'database' | 'activity' | 'steam';
}

export interface StatusPayload {
  ok: boolean;
  checkedAt: string;
  services: StatusService[];
  system: StatusSystemMetadata;
  history: StatusHistoryEntry[];
}

/**
 * The part that is identical for every visitor in the same Cloudflare colo and
 * therefore safe to cache/edge-share. `system` (requester city/region/ISP) and
 * `checkedAt` are deliberately absent: `decorateStatus` rebuilds them per request.
 */
export type CachedStatusPayload = Omit<StatusPayload, 'system' | 'checkedAt'>;

/**
 * Attach the per-request fields to a cached status payload.
 *
 * Called from `/api/status`'s `decorate`, i.e. *after* the shared cache read:
 * `request.cf` describes the current visitor, so caching it would leak the first
 * visitor's location to everyone else served by the same colo. This function is
 * pure and never mutates `payload`, keeping the route free of a second,
 * test-only copy of the assembly logic.
 */
export function decorateStatus(payload: CachedStatusPayload, cf: unknown, now: string): StatusPayload {
  return {
    ...payload,
    checkedAt: now,
    system: readStatusSystem(cf, now),
  };
}

export interface StatusCheckRow {
  checked_at: number;
  ok: number;
  detail: string | null;
}

export interface StatusHistoryEntry {
  /** Unix seconds. */
  checkedAt: number;
  ok: boolean;
  /** Failing service keys (comma separated) or `ok`. */
  detail: string;
}

/** Unix seconds before which rows are outside the history window. */
export function statusHistoryStart(nowSeconds: number): number {
  return nowSeconds - STATUS_HISTORY_HOURS * 60 * 60;
}

/** Unix cutoff for the "record at most once per interval" check. */
export function statusCheckCutoff(nowSeconds: number): number {
  return nowSeconds - STATUS_CHECK_INTERVAL_SECONDS;
}

/** Whether a new sample is due, given the newest recorded `checked_at`. */
export function isStatusCheckDue(
  nowSeconds: number,
  latestCheckedAt: number | null | undefined,
  intervalSeconds: number = STATUS_CHECK_INTERVAL_SECONDS,
): boolean {
  if (latestCheckedAt === null || latestCheckedAt === undefined) return true;
  if (!Number.isFinite(latestCheckedAt)) return true;
  return nowSeconds - latestCheckedAt >= intervalSeconds;
}

/** Every listed service healthy. An empty list is never "healthy". */
export function statusOverallOk(services: readonly StatusProbeLike[]): boolean {
  return services.length > 0 && services.every((service) => service.ok);
}

/**
 * Compact detail stored with a history row: the failing service keys, or
 * `ok`. This is deliberately stable, non-human text; the UI maps service keys
 * to localised labels.
 */
export function summariseStatusDetail(services: readonly StatusProbeLike[]): string {
  const failing = services.filter((service) => !service.ok).map((service) => service.key);
  return failing.length > 0 ? failing.join(',') : 'ok';
}

/** Converts D1 rows into the API shape, newest last, windowed and bounded. */
export function normaliseStatusHistory(
  rows: readonly StatusCheckRow[],
  nowSeconds: number,
  limit: number = STATUS_HISTORY_LIMIT,
): StatusHistoryEntry[] {
  const start = statusHistoryStart(nowSeconds);
  return rows
    .filter((row) => Number.isFinite(row.checked_at) && row.checked_at >= start && row.checked_at <= nowSeconds)
    .sort((a, b) => a.checked_at - b.checked_at)
    .slice(-limit)
    .map((row) => ({
      checkedAt: Math.trunc(row.checked_at),
      ok: Number(row.ok) === 1,
      detail: row.detail && row.detail.trim() ? row.detail.trim() : 'ok',
    }));
}
