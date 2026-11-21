// Pure, injectable core for server-side revocable admin sessions (#13).
//
// Deliberately free of any `cloudflare:workers` import: the whole session
// lifecycle is written against a minimal D1-like interface, so `node --test` can
// run create -> verify -> touch -> revoke -> cleanup against an in-memory fake
// (see tests/admin-sessions.test.ts). `admin-auth.ts` binds the real `env.DB`.

import { base64UrlEncode, parseAdminSessionCookie, signAdminSession } from './auth-crypto.ts';

/** Admin sessions stay valid for 7 days, exactly like the old signed cookie. */
export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

/** Only refresh `last_seen_at` periodically, not on every admin request. */
export const ADMIN_SESSION_TOUCH_INTERVAL_SECONDS = 5 * 60;

/** The subset of the D1 API these queries need; Cloudflare's `D1Database` fits. */
export interface AdminSessionStatement {
  bind(...values: unknown[]): AdminSessionStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}

export interface AdminSessionDb {
  prepare(query: string): AdminSessionStatement;
}

/** One row of `admin_sessions`. Times are Unix seconds. */
export interface AdminSessionRow {
  session_id: string;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
  last_seen_at: number | null;
}

export interface CreatedAdminSession {
  sessionId: string;
  cookieValue: string;
  expiresAt: number;
}

/**
 * Outcome of a session check. `unavailable` is deliberately distinct from
 * `unauthenticated`: a D1 outage or a not-yet-applied migration must produce a
 * 503, never an ordinary 401 (and never an allowed request).
 */
export type AdminSessionLookup =
  { status: 'ok'; row: AdminSessionRow } | { status: 'unauthenticated' } | { status: 'unavailable' };

const SELECT_SESSION =
  'SELECT session_id, created_at, expires_at, revoked_at, last_seen_at FROM admin_sessions WHERE session_id = ? LIMIT 1';

const INSERT_SESSION =
  'INSERT INTO admin_sessions (session_id, created_at, expires_at, revoked_at, last_seen_at) VALUES (?, ?, ?, NULL, ?)';

const REVOKE_ONE = 'UPDATE admin_sessions SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL';

const REVOKE_ALL = 'UPDATE admin_sessions SET revoked_at = ? WHERE revoked_at IS NULL';

const TOUCH_ONE = 'UPDATE admin_sessions SET last_seen_at = ? WHERE session_id = ?';

const DELETE_EXPIRED = 'DELETE FROM admin_sessions WHERE expires_at <= ?';

function resolveNow(nowSeconds?: number): number {
  return nowSeconds ?? Math.floor(Date.now() / 1000);
}

/** 24 random bytes encode to exactly 32 base64url characters. */
export function generateAdminSessionId(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(24)));
}

/** Insert a new active session and return the signed cookie value for it. */
export async function createAdminSession(
  db: AdminSessionDb,
  secret: string,
  nowSeconds?: number,
): Promise<CreatedAdminSession> {
  const now = resolveNow(nowSeconds);
  const sessionId = generateAdminSessionId();
  const expiresAt = now + ADMIN_SESSION_TTL_SECONDS;
  const cookieValue = await signAdminSession(secret, sessionId, now);
  await db.prepare(INSERT_SESSION).bind(sessionId, now, expiresAt, now).run();
  return { sessionId, cookieValue, expiresAt };
}

/**
 * Verify the cookie signature *and* the D1 row.
 *
 * A malformed/tampered/expired cookie and an unknown/revoked/expired row are
 * `unauthenticated` (401 at the edge). Any D1 failure — connection, query, or a
 * missing `admin_sessions` table because migration 0008 was not applied — is
 * `unavailable` (503), never a valid session and never a plain 401.
 */
export async function lookupAdminSession(
  db: AdminSessionDb,
  secret: string,
  rawCookie: string,
  nowSeconds?: number,
): Promise<AdminSessionLookup> {
  const now = resolveNow(nowSeconds);
  const parsed = await parseAdminSessionCookie(secret, rawCookie, ADMIN_SESSION_TTL_SECONDS, now);
  if (!parsed) return { status: 'unauthenticated' };

  try {
    const row = await db.prepare(SELECT_SESSION).bind(parsed.sessionId).first<AdminSessionRow>();
    if (!row) return { status: 'unauthenticated' };
    if (row.revoked_at != null) return { status: 'unauthenticated' };
    if (!Number.isFinite(row.expires_at) || row.expires_at <= now) return { status: 'unauthenticated' };
    return { status: 'ok', row };
  } catch {
    // Includes "no such table: admin_sessions" when the migration is pending.
    return { status: 'unavailable' };
  }
}

/**
 * The HTTP-level outcome an admin guard must produce for a session lookup.
 *
 * Extracted from `admin-auth.ts` so the 401-vs-503 rule is unit-testable without
 * `cloudflare:workers`: an invalid/expired/revoked cookie is 401, while a D1
 * outage or a pending migration is 503 (fail closed — never treated as a valid
 * session, and never as an ordinary "not logged in").
 */
export type AdminSessionGuard =
  { allow: true; row: AdminSessionRow } | { allow: false; status: 401 | 503; error: string };

export function adminSessionGuard(lookup: AdminSessionLookup): AdminSessionGuard {
  if (lookup.status === 'ok') return { allow: true, row: lookup.row };
  if (lookup.status === 'unavailable') {
    return { allow: false, status: 503, error: 'Admin session storage is unavailable. Try again shortly.' };
  }
  return { allow: false, status: 401, error: 'Not authenticated.' };
}

export function shouldTouchAdminSession(row: AdminSessionRow, nowSeconds?: number): boolean {
  const now = resolveNow(nowSeconds);
  return !row.last_seen_at || now - row.last_seen_at >= ADMIN_SESSION_TOUCH_INTERVAL_SECONDS;
}

export async function touchAdminSession(db: AdminSessionDb, sessionId: string, nowSeconds?: number): Promise<void> {
  await db.prepare(TOUCH_ONE).bind(resolveNow(nowSeconds), sessionId).run();
}

/** Mark one session revoked. Idempotent: an already-revoked row is left alone. */
export async function revokeAdminSession(db: AdminSessionDb, sessionId: string, nowSeconds?: number): Promise<void> {
  await db.prepare(REVOKE_ONE).bind(resolveNow(nowSeconds), sessionId).run();
}

/** Revoke every currently active session ("log out all devices"). */
export async function revokeAllAdminSessions(db: AdminSessionDb, nowSeconds?: number): Promise<void> {
  await db.prepare(REVOKE_ALL).bind(resolveNow(nowSeconds)).run();
}

/** Opportunistic garbage collection; failures are the caller's to swallow. */
export async function cleanupExpiredAdminSessions(db: AdminSessionDb, nowSeconds?: number): Promise<void> {
  await db.prepare(DELETE_EXPIRED).bind(resolveNow(nowSeconds)).run();
}
