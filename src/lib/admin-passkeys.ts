import { siteConfig } from '../site.config.ts';
import { env } from 'cloudflare:workers';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type { APIRoute } from 'astro';
import { base64UrlDecode, base64UrlEncode, expiredCookie, serializeCookie } from './auth-crypto';
import { isAdminPasswordConfigured, isAdminSessionConfigured, issueAdminCookie, requireAdmin } from './admin-auth';
import {
  ADMIN_CHALLENGE_COOKIE,
  ADMIN_CHALLENGE_TTL_SECONDS,
  generateChallengeId,
  parseChallengeCookie,
  signChallengeCookie,
} from './admin-passkeys-core';
import { getClientIp } from './request';
import { isSameOriginRequest } from './request-security';

const RP_NAME = `${siteConfig.adminName}管理後台`;

type ChallengePurpose = 'login' | 'register';
type StoredPasskey = {
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string;
  device_type: string;
  backed_up: number;
  last_used_at?: string | null;
};

function noStoreHeaders(): Headers {
  return new Headers({ 'cache-control': 'no-store, private' });
}

function json(body: unknown, status = 200, headers = new Headers()): Response {
  const merged = new Headers(headers);
  merged.set('content-type', 'application/json; charset=utf-8');
  merged.set('cache-control', 'no-store, private');
  return new Response(JSON.stringify(body), { status, headers: merged });
}

function loginOptionsError(message: string, status = 503, headers = new Headers()): Response {
  return json({ ok: false, error: message, passwordFallbackAvailable: isAdminPasswordConfigured() }, status, headers);
}

function challengeCookie(value: string): string {
  return serializeCookie(ADMIN_CHALLENGE_COOKIE, value, ADMIN_CHALLENGE_TTL_SECONDS);
}

function clearChallengeCookie(): string {
  return expiredCookie(ADMIN_CHALLENGE_COOKIE);
}

/** Sign a challenge id with the dedicated admin session secret. */
async function signChallenge(purpose: ChallengePurpose, id: string): Promise<string> {
  const secret = env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error('Admin session secret is not configured');
  return signChallengeCookie(secret, purpose, id);
}

async function readChallengeCookie(request: Request, expectedPurpose: ChallengePurpose): Promise<string | null> {
  const rawCookie = request.headers.get('cookie') ?? '';
  const prefix = `${ADMIN_CHALLENGE_COOKIE}=`;
  const raw = rawCookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
  const secret = env.ADMIN_SESSION_SECRET;
  if (!secret) return null;
  return parseChallengeCookie(secret, raw, expectedPurpose);
}

async function issueChallenge(purpose: ChallengePurpose, challenge: string): Promise<{ cookie: string }> {
  if (!env.DB) throw new Error('D1 database is not configured');
  const now = Math.floor(Date.now() / 1000);
  const id = generateChallengeId();
  await env.DB.prepare('DELETE FROM admin_webauthn_challenges WHERE expires_at <= ?').bind(now).run();
  await env.DB.prepare(
    'INSERT INTO admin_webauthn_challenges (challenge_id, challenge, purpose, expires_at) VALUES (?, ?, ?, ?)',
  )
    .bind(id, challenge, purpose, now + ADMIN_CHALLENGE_TTL_SECONDS)
    .run();
  return { cookie: challengeCookie(await signChallenge(purpose, id)) };
}

/** Atomic single-use challenge consumption prevents replay and parallel double verification. */
async function consumeChallenge(request: Request, purpose: ChallengePurpose): Promise<string | null> {
  if (!env.DB) return null;
  const id = await readChallengeCookie(request, purpose);
  if (!id) return null;
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    'DELETE FROM admin_webauthn_challenges WHERE challenge_id = ? AND purpose = ? AND expires_at > ? RETURNING challenge',
  )
    .bind(id, purpose, now)
    .first<{ challenge: string }>();
  return row?.challenge ?? null;
}

/**
 * Resolve the WebAuthn RP ID and the exact origin a credential is bound to.
 *
 * Production must configure `ADMIN_WEBAUTHN_ORIGIN`: falling back to the request
 * Host would let whatever hostname reached the Worker (workers.dev, a preview
 * domain, …) become the origin. Astro's dev server keeps the request-origin
 * fallback so localhost passkeys keep working.
 */
function webAuthnOrigin(request: Request): { rpID: string; origin: string } | null {
  try {
    const requestUrl = new URL(request.url);
    const configuredOrigin = (env.ADMIN_WEBAUTHN_ORIGIN || '').trim();
    if (!configuredOrigin && import.meta.env.PROD) return null;
    const origin = (configuredOrigin || requestUrl.origin).replace(/\/$/, '');
    const expectedOrigin = new URL(origin);
    const configuredRpId = (env.ADMIN_WEBAUTHN_RP_ID || '').trim();
    const rpID = configuredRpId || expectedOrigin.hostname;
    const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(expectedOrigin.hostname);
    if (expectedOrigin.protocol !== 'https:' && !isLoopback) return null;
    if (
      expectedOrigin.username ||
      expectedOrigin.password ||
      expectedOrigin.pathname !== '/' ||
      expectedOrigin.search ||
      expectedOrigin.hash
    )
      return null;
    if (requestUrl.origin !== expectedOrigin.origin) return null;
    if (!rpID || rpID.includes('/') || rpID.includes(':') || rpID.startsWith('.') || rpID.endsWith('.')) return null;
    if (requestUrl.hostname !== rpID && !requestUrl.hostname.endsWith(`.${rpID}`)) return null;
    return { rpID, origin: expectedOrigin.origin };
  } catch {
    return null;
  }
}

/**
 * Fixed WebAuthn user handle for the single administrator account. It is a
 * constant digest, so the same handle is returned on every device and can be
 * compared against the `userHandle` of a discoverable assertion.
 */
async function adminWebAuthnUserId(): Promise<Uint8Array<ArrayBuffer>> {
  const secret = env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error('Admin session secret is not configured');
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${siteConfig.webauthnSalt}:admin-webauthn-user:v1`),
  );
  // `digest` is a plain ArrayBuffer, so the view is `Uint8Array<ArrayBuffer>` and
  // can be passed to generateRegistrationOptions() as `userID` without a cast.
  return new Uint8Array(digest);
}

async function listPasskeys(): Promise<StoredPasskey[]> {
  if (!env.DB) throw new Error('D1 database is not configured');
  const result = await env.DB.prepare(
    'SELECT credential_id, public_key, counter, transports, device_type, backed_up, last_used_at FROM admin_passkeys ORDER BY created_at ASC',
  ).all<StoredPasskey>();
  return result.results ?? [];
}

async function rateLimitPasskey(request: Request): Promise<boolean> {
  const limiter = env.ADMIN_PASSKEY_RATE_LIMIT;
  if (!limiter) return true;
  const result = await limiter.limit({ key: `admin-passkey:${getClientIp(request)}` });
  return result.success;
}

function credentialFromBody(body: any): any | null {
  const credential = body?.credential;
  if (!credential || typeof credential !== 'object' || Array.isArray(credential)) return null;
  if (typeof credential.id !== 'string' || credential.id.length > 2048) return null;
  if (typeof credential.rawId !== 'string' || credential.rawId.length > 2048) return null;
  if (credential.type !== 'public-key' || !credential.response || typeof credential.response !== 'object') return null;
  return credential;
}

const MAX_WEBAUTHN_BODY_BYTES = 64 * 1024;

async function readBoundedJson(
  request: Request,
): Promise<{ ok: true; value: unknown } | { ok: false; status: 400 | 413 | 415 }> {
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return { ok: false, status: 415 };
  }

  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBAUTHN_BODY_BYTES) {
    return { ok: false, status: 413 };
  }

  if (!request.body) return { ok: false, status: 400 };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_WEBAUTHN_BODY_BYTES) {
        await reader.cancel();
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400 };
  }

  try {
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
  } catch {
    return { ok: false, status: 400 };
  }
}

export const passkeyStatus: APIRoute = async ({ request }) => {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  if (!env.DB) return json({ ok: false, error: 'D1 database is not configured.' }, 503);
  let passkeys: StoredPasskey[];
  try {
    passkeys = await listPasskeys();
  } catch {
    return json({ ok: false, error: 'Passkey storage is not migrated yet.' }, 503);
  }
  return json({
    ok: true,
    count: passkeys.length,
    lastUsedAt: passkeys.reduce<string | null>((latest, item) => {
      const timestamp = item.last_used_at ?? null;
      return timestamp && (!latest || timestamp > latest) ? timestamp : latest;
    }, null),
  });
};

export const passkeyLoginOptions: APIRoute = async ({ request }) => {
  if (request.method !== 'POST' || !isSameOriginRequest(request))
    return json({ ok: false, error: 'Invalid request.' }, 403);
  if (!isAdminSessionConfigured()) return loginOptionsError('Admin session signing is not configured.', 503);
  if (!env.DB) return loginOptionsError('Passkey storage is unavailable. Use password login.', 503);
  if (!(await rateLimitPasskey(request)))
    return loginOptionsError('Too many attempts. Try again shortly.', 429, new Headers({ 'retry-after': '60' }));

  let passkeys: StoredPasskey[];
  try {
    passkeys = await listPasskeys();
  } catch {
    return loginOptionsError('Passkey storage is not migrated yet. Use password login.', 503);
  }
  if (passkeys.length === 0)
    return json({ ok: true, configured: false, passwordFallbackAvailable: isAdminPasswordConfigured() });
  const webAuthn = webAuthnOrigin(request);
  if (!webAuthn) return loginOptionsError('Passkey origin/RP configuration is invalid.', 503);

  try {
    const options = await generateAuthenticationOptions({
      rpID: webAuthn.rpID,
      userVerification: 'required',
      allowCredentials: [], // Discoverable credentials enable account selection without an allow-list.
    });
    const challenge = await issueChallenge('login', options.challenge);
    const headers = noStoreHeaders();
    headers.append('set-cookie', challenge.cookie);
    return json(
      { ok: true, configured: true, passwordFallbackAvailable: isAdminPasswordConfigured(), options },
      200,
      headers,
    );
  } catch {
    return loginOptionsError('Unable to initialise Passkey login. Use password fallback.', 503);
  }
};

export const passkeyLoginVerify: APIRoute = async ({ request }) => {
  if (!isSameOriginRequest(request))
    return json({ ok: false, error: 'Invalid request.' }, 403, new Headers({ 'set-cookie': clearChallengeCookie() }));
  if (!isAdminSessionConfigured() || !env.DB)
    return json(
      { ok: false, error: 'Passkey login is not configured.' },
      503,
      new Headers({ 'set-cookie': clearChallengeCookie() }),
    );
  if (!(await rateLimitPasskey(request)))
    return json(
      { ok: false, error: 'Too many attempts. Try again shortly.' },
      429,
      new Headers({ 'retry-after': '60', 'set-cookie': clearChallengeCookie() }),
    );

  const expectedChallenge = await consumeChallenge(request, 'login');
  const headers = noStoreHeaders();
  headers.append('set-cookie', clearChallengeCookie());
  if (!expectedChallenge) return json({ ok: false, error: 'Passkey challenge expired. Try again.' }, 400, headers);

  const parsedBody = await readBoundedJson(request);
  if (!parsedBody.ok) {
    return json(
      {
        ok: false,
        error:
          parsedBody.status === 413
            ? 'Passkey response is too large.'
            : parsedBody.status === 415
              ? 'Expected JSON request body.'
              : 'Invalid JSON request body.',
      },
      parsedBody.status,
      headers,
    );
  }
  const credentialResponse = credentialFromBody(parsedBody.value);
  if (!credentialResponse) return json({ ok: false, error: 'Invalid passkey response.' }, 400, headers);

  const webAuthn = webAuthnOrigin(request);
  if (!webAuthn) return json({ ok: false, error: 'Passkey origin/RP configuration is invalid.' }, 503, headers);

  try {
    const stored = await env.DB.prepare(
      'SELECT credential_id, public_key, counter, transports FROM admin_passkeys WHERE credential_id = ? LIMIT 1',
    )
      .bind(credentialResponse.id)
      .first<StoredPasskey>();
    if (!stored) return json({ ok: false, error: 'Passkey was not recognised. Use password login.' }, 401, headers);

    // Discoverable credentials must return the fixed administrator user handle.
    // This prevents a credential registered for a different account context
    // from being accepted merely because a credential ID happened to match.
    const expectedUserHandle = base64UrlEncode(await adminWebAuthnUserId());
    if (credentialResponse.response.userHandle !== expectedUserHandle) {
      return json({ ok: false, error: 'Passkey account handle did not match.' }, 401, headers);
    }

    const transports = JSON.parse(stored.transports) as string[];
    const verification = await verifyAuthenticationResponse({
      response: credentialResponse,
      expectedChallenge,
      expectedOrigin: webAuthn.origin,
      expectedRPID: webAuthn.rpID,
      credential: {
        id: stored.credential_id,
        publicKey: base64UrlDecode(stored.public_key),
        counter: Number(stored.counter) || 0,
        transports: transports as any,
      },
      requireUserVerification: true,
    });

    if (!verification.verified)
      return json({ ok: false, error: 'Passkey verification failed. Use password login.' }, 401, headers);
    // Compare-and-set the signature counter. A cloned authenticator presenting
    // the same counter cannot both be accepted, and a concurrent assertion that
    // lost the race is reported instead of silently overwriting the counter.
    const counterUpdate = await env.DB.prepare(
      'UPDATE admin_passkeys SET counter = ?, last_used_at = CURRENT_TIMESTAMP WHERE credential_id = ? AND counter = ?',
    )
      .bind(verification.authenticationInfo.newCounter, stored.credential_id, Number(stored.counter) || 0)
      .run();
    const counterChanged = (counterUpdate.meta as { changes?: unknown }).changes;
    if (typeof counterChanged === 'number' && counterChanged === 0) {
      return json({ ok: false, error: 'Passkey verification failed. Use password login.' }, 401, headers);
    }
    // Both login paths create a server-side revocable session (#13). If the D1
    // write fails (missing migration, storage outage), fail closed with 503
    // instead of returning a cookie that could never be verified.
    let sessionCookie: string;
    try {
      sessionCookie = await issueAdminCookie();
    } catch {
      return json({ ok: false, error: 'Admin session storage is unavailable. Try again shortly.' }, 503, headers);
    }
    headers.append('set-cookie', sessionCookie);
    return json({ ok: true }, 200, headers);
  } catch {
    return json({ ok: false, error: 'Passkey verification failed. Use password login.' }, 401, headers);
  }
};

export const passkeyRegisterOptions: APIRoute = async ({ request }) => {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  if (!env.DB) return json({ ok: false, error: 'D1 database is not configured.' }, 503);
  if (!(await rateLimitPasskey(request)))
    return json(
      { ok: false, error: 'Too many attempts. Try again shortly.' },
      429,
      new Headers({ 'retry-after': '60' }),
    );
  const webAuthn = webAuthnOrigin(request);
  if (!webAuthn) return json({ ok: false, error: 'Passkey origin/RP configuration is invalid.' }, 503);

  let passkeys: StoredPasskey[];
  try {
    passkeys = await listPasskeys();
  } catch {
    return json({ ok: false, error: 'Passkey storage is not migrated yet.' }, 503);
  }
  if (passkeys.length >= 10) return json({ ok: false, error: '最多可登記 10 把 Passkey。' }, 409);

  try {
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: webAuthn.rpID,
      userID: await adminWebAuthnUserId(),
      userName: 'admin',
      userDisplayName: '網站管理員',
      attestationType: 'none',
      supportedAlgorithmIDs: [-7, -257],
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
      excludeCredentials: passkeys.map((passkey) => ({
        id: passkey.credential_id,
        transports: JSON.parse(passkey.transports) as any,
      })),
    });
    const challenge = await issueChallenge('register', options.challenge);
    const headers = noStoreHeaders();
    headers.append('set-cookie', challenge.cookie);
    return json({ ok: true, options }, 200, headers);
  } catch {
    return json({ ok: false, error: 'Unable to initialise Passkey registration.' }, 503);
  }
};

export const passkeyRegisterVerify: APIRoute = async ({ request }) => {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  if (!env.DB)
    return json(
      { ok: false, error: 'D1 database is not configured.' },
      503,
      new Headers({ 'set-cookie': clearChallengeCookie() }),
    );
  if (!(await rateLimitPasskey(request)))
    return json(
      { ok: false, error: 'Too many attempts. Try again shortly.' },
      429,
      new Headers({ 'retry-after': '60', 'set-cookie': clearChallengeCookie() }),
    );

  const expectedChallenge = await consumeChallenge(request, 'register');
  const headers = noStoreHeaders();
  headers.append('set-cookie', clearChallengeCookie());
  if (!expectedChallenge) return json({ ok: false, error: 'Passkey registration challenge expired.' }, 400, headers);

  const parsedBody = await readBoundedJson(request);
  if (!parsedBody.ok) {
    return json(
      {
        ok: false,
        error:
          parsedBody.status === 413
            ? 'Passkey response is too large.'
            : parsedBody.status === 415
              ? 'Expected JSON request body.'
              : 'Invalid JSON request body.',
      },
      parsedBody.status,
      headers,
    );
  }
  const credentialResponse = credentialFromBody(parsedBody.value);
  if (!credentialResponse) return json({ ok: false, error: 'Invalid passkey registration response.' }, 400, headers);
  const webAuthn = webAuthnOrigin(request);
  if (!webAuthn) return json({ ok: false, error: 'Passkey origin/RP configuration is invalid.' }, 503, headers);

  try {
    const verification = await verifyRegistrationResponse({
      response: credentialResponse,
      expectedChallenge,
      expectedOrigin: webAuthn.origin,
      expectedRPID: webAuthn.rpID,
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo) {
      return json({ ok: false, error: 'Passkey registration verification failed.' }, 400, headers);
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    // Atomic 10-passkey cap. The options endpoint checks the count early for a
    // friendly 409, but two parallel registration ceremonies must not be able to
    // exceed the documented limit, so the INSERT itself is conditional.
    const inserted = await env.DB.prepare(
      `INSERT INTO admin_passkeys
        (credential_id, public_key, counter, transports, device_type, backed_up)
       SELECT ?, ?, ?, ?, ?, ?
       WHERE (SELECT COUNT(*) FROM admin_passkeys) < 10`,
    )
      .bind(
        credential.id,
        base64UrlEncode(credential.publicKey),
        credential.counter,
        JSON.stringify(credential.transports ?? []),
        credentialDeviceType,
        credentialBackedUp ? 1 : 0,
      )
      .run();
    const insertedRows = (inserted.meta as { changes?: unknown }).changes;
    if (typeof insertedRows === 'number' && insertedRows === 0) {
      return json({ ok: false, error: '最多可登記 10 把 Passkey。' }, 409, headers);
    }

    return json({ ok: true, count: (await listPasskeys()).length }, 200, headers);
  } catch {
    return json({ ok: false, error: 'Passkey registration failed. Please try again.' }, 400, headers);
  }
};
