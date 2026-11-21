// Shared cryptographic and cookie primitives for this site's first-party auth.
//
// Deliberately free of any `cloudflare:workers` import so it can be unit-tested
// in plain Node (see tests/auth-crypto.test.ts). Previously `visitor-auth.ts`
// and `admin-auth.ts` each carried a byte-identical copy of this code.

/** Allowed clock skew, in seconds, when reading cookie timestamps. */
export const CLOCK_SKEW_SECONDS = 60;

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** First occurrence of `name=` in the Cookie header, or null. */
export function readCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get('Cookie') || '';
  const prefix = `${name}=`;
  for (const part of cookie.split(';')) {
    const value = part.trim();
    if (value.startsWith(prefix)) return value.slice(prefix.length);
  }
  return null;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

/**
 * String a cookie signature is computed over. The visitor cookie signs the bare
 * timestamp; the admin cookie prefixes a scope, so a visitor token can never
 * validate as an admin session even if the two ever share a secret.
 */
export function payloadFor(issuedAt: string, scope = ''): string {
  return scope ? `${scope}.${issuedAt}` : issuedAt;
}

/** Build the `<issuedAt>.<signature>` value that is stored in the cookie. */
export async function signIssuedAt(secret: string, issuedAt: number, scope = ''): Promise<string> {
  const issuedAtText = String(issuedAt);
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadFor(issuedAtText, scope)));
  return `${issuedAtText}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * Verify a `<issuedAt>.<signature>` cookie value: shape, age window and HMAC.
 * `nowSeconds` is injectable so the age/skew rules can be tested deterministically.
 */
export async function verifyIssuedAt(
  secret: string,
  raw: string,
  maxAge: number,
  scope = '',
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!secret || !raw) return false;

  const separator = raw.indexOf('.');
  if (separator <= 0 || separator === raw.length - 1) return false;

  const issuedAtText = raw.slice(0, separator);
  const signatureText = raw.slice(separator + 1);
  const issuedAt = Number(issuedAtText);
  if (!Number.isInteger(issuedAt)) return false;
  if (issuedAt > nowSeconds + CLOCK_SKEW_SECONDS || nowSeconds - issuedAt > maxAge) return false;

  try {
    const key = await hmacKey(secret);
    return await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlDecode(signatureText),
      new TextEncoder().encode(payloadFor(issuedAtText, scope)),
    );
  } catch {
    return false;
  }
}

// --- Revocable admin sessions (#13) -----------------------------------------
//
// The admin session cookie carries a random session id, the issue timestamp and
// an HMAC over both. The session id is the primary key of the `admin_sessions`
// D1 table, which is what makes revocation possible: the HMAC proves this Worker
// issued the cookie, and the row proves the session is still active. The 2-part
// `<issuedAt>.<signature>` format used before #13 can never satisfy this parser,
// so every old-format cookie is invalid by construction (the user logs in once).

/** A random 24-byte session id encodes to exactly 32 base64url characters. */
export const ADMIN_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{32}$/;

const ADMIN_SESSION_SCOPE = 'admin.session';

export interface ParsedAdminSession {
  sessionId: string;
  issuedAt: number;
}

function adminSessionPayload(sessionId: string, issuedAtText: string): string {
  return `${ADMIN_SESSION_SCOPE}.${sessionId}.${issuedAtText}`;
}

/** Build the `<sessionId>.<issuedAt>.<signature>` admin session cookie value. */
export async function signAdminSession(secret: string, sessionId: string, issuedAt: number): Promise<string> {
  const issuedAtText = String(issuedAt);
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(adminSessionPayload(sessionId, issuedAtText)),
  );
  return `${sessionId}.${issuedAtText}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * Verify the new admin session cookie format: three parts, a well-formed session
 * id, an issue time inside the skill window and age window, and a valid HMAC.
 * Returns null for every malformed value, including all pre-#13 2-part cookies.
 */
export async function parseAdminSessionCookie(
  secret: string,
  raw: string,
  maxAge: number,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<ParsedAdminSession | null> {
  if (!secret || !raw) return null;

  const parts = raw.split('.');
  if (parts.length !== 3) return null;
  const [sessionId, issuedAtText, signatureText] = parts;
  if (!ADMIN_SESSION_ID_PATTERN.test(sessionId)) return null;

  const issuedAt = Number(issuedAtText);
  if (!Number.isInteger(issuedAt)) return null;
  if (issuedAt > nowSeconds + CLOCK_SKEW_SECONDS || nowSeconds - issuedAt > maxAge) return null;

  try {
    const key = await hmacKey(secret);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlDecode(signatureText),
      new TextEncoder().encode(adminSessionPayload(sessionId, issuedAtText)),
    );
    return valid ? { sessionId, issuedAt } : null;
  } catch {
    return null;
  }
}

/** `__Host-`-style attributes: host-only, HTTPS-only, HttpOnly, SameSite=Lax. */
export function serializeCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export function expiredCookie(name: string): string {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

/** Constant-time string comparison, so a secret is not leaked through timing. */
export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}
