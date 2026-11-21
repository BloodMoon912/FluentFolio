// Pure signing/validation for the WebAuthn challenge cookie (#16).
//
// Extracted from `admin-passkeys.ts` so the issue -> verify round-trip and every
// rejection rule can be unit-tested under plain `node --test`: the route module
// imports `cloudflare:workers` and `@simplewebauthn/server`, so it cannot be
// loaded there. The wire format, length cap, five-minute TTL and clock-skew
// rules are byte-for-byte the ones the routes used before the extraction.
//
// The cookie travels between the options endpoint (which creates the D1
// challenge row) and the verify endpoint (which consumes it atomically). It
// binds the purpose (login/register) and the issue time so a value from one
// ceremony can never be replayed in the other.

import { base64UrlDecode, base64UrlEncode } from './auth-crypto.ts';

/** Cookie that carries the challenge id between the options and verify routes. */
export const ADMIN_CHALLENGE_COOKIE = '__Host-bm-admin-webauthn';

/** The D1 challenge row and the cookie share this five-minute lifetime. */
export const ADMIN_CHALLENGE_TTL_SECONDS = 5 * 60;

/** Allowed clock skew for the signed issue time, in seconds. */
export const ADMIN_CHALLENGE_CLOCK_SKEW_SECONDS = 60;

/** A challenge id is 24 random bytes, i.e. exactly 32 base64url characters. */
export const ADMIN_CHALLENGE_ID_PATTERN = /^[A-Za-z0-9_-]{32}$/;

/** Cookies longer than this are rejected before parsing (same limit as before). */
const MAX_CHALLENGE_COOKIE_LENGTH = 512;

export type AdminChallengePurpose = 'login' | 'register';

function challengePayload(purpose: AdminChallengePurpose, id: string, issuedAt: number): string {
  return `${purpose}\n${id}\n${issuedAt}`;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

/** 24 random bytes encode to exactly 32 base64url characters. */
export function generateChallengeId(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(24)));
}

/** Build the `<base64url(payload)>.<base64url(hmac)>` challenge cookie value. */
export async function signChallengeCookie(
  secret: string,
  purpose: AdminChallengePurpose,
  id: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const payload = challengePayload(purpose, id, nowSeconds);
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return `${base64UrlEncode(new TextEncoder().encode(payload))}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * Validate a challenge cookie value and return its challenge id. Returns null
 * for every malformed, tampered, wrong-purpose, expired or future value, and
 * for a missing secret — callers therefore fail closed without extra checks.
 */
export async function parseChallengeCookie(
  secret: string | null | undefined,
  raw: string | null | undefined,
  expectedPurpose: AdminChallengePurpose,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string | null> {
  if (!secret || !raw || raw.length > MAX_CHALLENGE_COOKIE_LENGTH) return null;

  try {
    const parts = raw.split('.');
    if (parts.length !== 2) return null;
    const [payloadPart, signaturePart] = parts;
    if (!payloadPart || !signaturePart) return null;

    const payload = new TextDecoder().decode(base64UrlDecode(payloadPart));
    const fields = payload.split('\n');
    if (fields.length !== 3) return null;
    const [purpose, id, issuedAtText] = fields;
    if (purpose !== expectedPurpose || !ADMIN_CHALLENGE_ID_PATTERN.test(id ?? '')) return null;

    const issuedAt = Number(issuedAtText);
    if (!Number.isInteger(issuedAt)) return null;
    if (issuedAt > nowSeconds + ADMIN_CHALLENGE_CLOCK_SKEW_SECONDS) return null;
    if (nowSeconds - issuedAt > ADMIN_CHALLENGE_TTL_SECONDS) return null;

    const key = await importHmacKey(secret);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlDecode(signaturePart),
      new TextEncoder().encode(payload),
    );
    return valid ? id : null;
  } catch {
    return null;
  }
}
