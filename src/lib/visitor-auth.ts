import { env } from 'cloudflare:workers';
import { readCookie, serializeCookie, signIssuedAt, verifyIssuedAt } from './auth-crypto';

export const VISITOR_COOKIE_NAME = '__Host-bm-visit';
export const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

// __Host- makes this a host-only first-party cookie: no Domain attribute and
// HTTPS-only storage. This is deliberately server-issued and HttpOnly so the
// browser, not page JavaScript, owns the new/returning signal. Since audit
// 2026-11 (#1) it no longer suppresses the visit write — every view is recorded;
// it only distinguishes new from returning visitors and suppresses Turnstile.

function getCookieSecret(): string {
  // Keep deployment friction low: allow a dedicated secret, while using the
  // existing site secret as a fallback when no dedicated visitor cookie secret
  // has been configured yet.
  return env.VISITOR_COOKIE_SECRET || env.TURNSTILE_SECRET || '';
}

export async function issueVisitorCookie(): Promise<string> {
  const secret = getCookieSecret();
  if (!secret) throw new Error('Visitor cookie secret is not configured');

  const value = await signIssuedAt(secret, Math.floor(Date.now() / 1000));
  return serializeCookie(VISITOR_COOKIE_NAME, value, VISITOR_COOKIE_MAX_AGE);
}

export async function hasValidVisitorCookie(request: Request): Promise<boolean> {
  const secret = getCookieSecret();
  if (!secret) return false;

  const raw = readCookie(request, VISITOR_COOKIE_NAME);
  return verifyIssuedAt(secret, raw ?? '', VISITOR_COOKIE_MAX_AGE);
}
