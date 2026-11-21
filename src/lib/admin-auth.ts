import { env } from 'cloudflare:workers';
import { expiredCookie, parseAdminSessionCookie, readCookie, serializeCookie, timingSafeEqual } from './auth-crypto';
import {
  ADMIN_SESSION_TTL_SECONDS,
  adminSessionGuard,
  cleanupExpiredAdminSessions,
  createAdminSession,
  lookupAdminSession,
  revokeAdminSession,
  revokeAllAdminSessions,
  shouldTouchAdminSession,
  touchAdminSession,
  type AdminSessionLookup,
  type AdminSessionRow,
} from './admin-sessions-core';
import { isSameOriginRequest } from './request-security';

// This is the site's own account/session gate (password or Passkey), which is
// always layered AFTER the mandatory Cloudflare Access gate in middleware.
// The signed application session is independent of the Access JWT and is
// required for every CMS page/API except the login ceremony endpoints.
//
// Since #13 the cookie holds a random session id plus an HMAC, and every check
// also reads the `admin_sessions` D1 row (migrations/0008_admin_sessions.sql),
// so a session can be revoked server-side before its 7-day expiry. D1 is now
// part of authentication: if it is unavailable the admin CMS fails closed with
// 503 rather than silently accepting or rejecting the cookie as if it were a
// stateless token.

export const ADMIN_COOKIE_NAME = '__Host-bm-admin';
export const ADMIN_SESSION_MAX_AGE = ADMIN_SESSION_TTL_SECONDS; // 7 days

/** Chance of running the expired-session cleanup on a successful login. */
const SESSION_CLEANUP_PROBABILITY = 0.01;

// The admin session secret must be dedicated to this purpose. Falling back to
// the visitor-cookie or Turnstile secret made the admin session's security
// depend on unrelated features and their rotation cycles, and it hid a missing
// configuration behind a working login. A missing ADMIN_SESSION_SECRET now
// means "admin CMS not configured", not "borrow another secret".
function getSessionSecret(): string {
  return env.ADMIN_SESSION_SECRET || '';
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function isAdminSessionConfigured(): boolean {
  return Boolean(env.ADMIN_SESSION_SECRET);
}

export function isAdminPasswordConfigured(): boolean {
  return Boolean(env.ADMIN_PASSWORD && env.ADMIN_SESSION_SECRET);
}

export function checkAdminPassword(candidate: string): boolean {
  const expected = env.ADMIN_PASSWORD;
  if (!expected || !candidate) return false;
  return timingSafeEqual(candidate, expected);
}

/** Create the D1 session row and return the signed `Set-Cookie` value for it. */
export async function issueAdminCookie(): Promise<string> {
  const secret = getSessionSecret();
  if (!secret) throw new Error('Admin session secret is not configured');
  if (!env.DB) throw new Error('Admin session storage is not configured (missing DB binding)');

  const now = nowSeconds();
  const { cookieValue } = await createAdminSession(env.DB, secret, now);

  // Opportunistic cleanup of expired rows, on roughly 1% of successful logins.
  // A cleanup failure must never fail the login.
  if (Math.random() < SESSION_CLEANUP_PROBABILITY) {
    try {
      await cleanupExpiredAdminSessions(env.DB, now);
    } catch {
      // Best effort.
    }
  }

  return serializeCookie(ADMIN_COOKIE_NAME, cookieValue, ADMIN_SESSION_MAX_AGE);
}

export function clearAdminCookie(): string {
  return expiredCookie(ADMIN_COOKIE_NAME);
}

/** Best-effort session touch; `last_seen_at` is advisory metadata. */
async function maybeTouchSession(row: AdminSessionRow): Promise<void> {
  if (!env.DB || !shouldTouchAdminSession(row, nowSeconds())) return;
  try {
    await touchAdminSession(env.DB, row.session_id, nowSeconds());
  } catch {
    // Ignore: an advisory write must not fail an authenticated request.
  }
}

/** Classify the request's session without throwing (used by page guards). */
export type AdminPageAccess = 'ok' | 'unauthenticated' | 'unavailable';

export async function checkAdminPageAccess(request: Request): Promise<AdminPageAccess> {
  const secret = getSessionSecret();
  if (!secret || !env.DB) return 'unavailable';

  const raw = readCookie(request, ADMIN_COOKIE_NAME);
  if (!raw) return 'unauthenticated';

  const result: AdminSessionLookup = await lookupAdminSession(env.DB, secret, raw, nowSeconds());
  if (result.status === 'ok') {
    await maybeTouchSession(result.row);
    return 'ok';
  }
  return result.status;
}

/** True only for an active server-side session; `false` also covers D1 errors. */
export async function hasValidAdminSession(request: Request): Promise<boolean> {
  return (await checkAdminPageAccess(request)) === 'ok';
}

/** Shared guard for every /api/admin/* route. Returns a 401/503 Response if the caller isn't authenticated. */
export async function requireAdmin(request: Request): Promise<Response | null> {
  // State-changing browser requests must originate from this exact origin.
  // GET remains available for read-only filters/searches; POST is used for all
  // CMS mutations so sensitive or large payloads never travel in query strings.
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method.toUpperCase()) && !isSameOriginRequest(request)) {
    return Response.json({ ok: false, error: 'Cross-origin request rejected.' }, { status: 403 });
  }

  if (!isAdminSessionConfigured()) {
    return Response.json(
      { ok: false, error: 'Admin CMS session signing is not configured (missing ADMIN_SESSION_SECRET).' },
      { status: 503 },
    );
  }

  // From here the only question is "what does the session lookup say?". The
  // 401-vs-503 mapping lives in `adminSessionGuard` so it is unit-tested without
  // importing this module (which imports `cloudflare:workers`).
  let lookup: AdminSessionLookup;
  if (!env.DB) {
    lookup = { status: 'unavailable' };
  } else {
    const raw = readCookie(request, ADMIN_COOKIE_NAME);
    if (!raw) {
      lookup = { status: 'unauthenticated' };
    } else {
      try {
        lookup = await lookupAdminSession(env.DB, getSessionSecret(), raw, nowSeconds());
      } catch {
        lookup = { status: 'unavailable' };
      }
    }
  }

  const guard = adminSessionGuard(lookup);
  if (!guard.allow) {
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  }

  await maybeTouchSession(guard.row);
  return null;
}

/**
 * Revoke the session referenced by the request's cookie, if one is signable.
 * Deliberately best-effort: logout is idempotent and must clear the cookie even
 * when D1 is down or the cookie is already invalid.
 */
export async function revokeCurrentAdminSession(request: Request): Promise<void> {
  const secret = getSessionSecret();
  if (!secret || !env.DB) return;

  const raw = readCookie(request, ADMIN_COOKIE_NAME);
  if (!raw) return;

  try {
    const now = nowSeconds();
    const parsed = await parseAdminSessionCookie(secret, raw, ADMIN_SESSION_MAX_AGE, now);
    if (parsed) await revokeAdminSession(env.DB, parsed.sessionId, now);
  } catch {
    // The cookie is cleared by the caller regardless.
  }
}

/** Revoke every active session. Throws when D1 is unavailable (caller returns 503). */
export async function revokeAllAdminSessionsForCurrentAdmin(): Promise<void> {
  if (!env.DB) throw new Error('Admin session storage is not configured (missing DB binding)');
  await revokeAllAdminSessions(env.DB, nowSeconds());
}
