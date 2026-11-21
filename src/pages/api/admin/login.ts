import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { checkAdminPassword, isAdminPasswordConfigured, issueAdminCookie } from '../../../lib/admin-auth';
import { decideAdminLogin } from '../../../lib/admin-login-core';
import { getClientIp } from '../../../lib/request';
import { isSameOriginRequest } from '../../../lib/request-security';

export const prerender = false;

const MAX_LOGIN_BODY_BYTES = 8 * 1024;
const MAX_PASSWORD_LENGTH = 1024;

type LoginBodyResult = { ok: true; password: string } | { ok: false; status: 400 | 413 | 415 };

/**
 * Read the login body with a hard 8 KB ceiling. The limit is enforced against
 * the bytes actually received, not only against the client-declared
 * Content-Length, so a chunked/lying request cannot stream an oversized body.
 */
async function readLoginBody(request: Request): Promise<LoginBodyResult> {
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return { ok: false, status: 415 };
  }
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_LOGIN_BODY_BYTES) {
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
      if (total > MAX_LOGIN_BODY_BYTES) {
        await reader.cancel();
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const parsed = JSON.parse(new TextDecoder().decode(body));
    if (typeof parsed?.password !== 'string' || parsed.password.length > MAX_PASSWORD_LENGTH) {
      return { ok: false, status: 400 };
    }
    return { ok: true, password: parsed.password };
  } catch {
    return { ok: false, status: 400 };
  }
}

function loginBodyErrorMessage(status: 400 | 413 | 415): string {
  if (status === 413) return 'Login request is too large.';
  if (status === 415) return 'Expected a JSON request body.';
  return 'Invalid login request body.';
}

export const POST: APIRoute = async ({ request }) => {
  if (!isSameOriginRequest(request)) {
    return Response.json({ ok: false, error: 'Cross-origin request rejected.' }, { status: 403 });
  }

  if (!isAdminPasswordConfigured()) {
    return Response.json(
      { ok: false, error: 'Admin CMS is not configured yet (ADMIN_PASSWORD / ADMIN_SESSION_SECRET missing).' },
      { status: 503 },
    );
  }

  const parsedBody = await readLoginBody(request);
  if (!parsedBody.ok) {
    return Response.json(
      { ok: false, error: loginBodyErrorMessage(parsedBody.status) },
      { status: parsedBody.status, headers: { 'cache-control': 'no-store' } },
    );
  }
  const password = parsedBody.password;

  // #3: the edge limiter runs BEFORE the password comparison and every attempt
  // (success or failure) consumes the same bucket. A correct password presented
  // after the bucket is exhausted is therefore still answered 429, so an
  // attacker cannot outpace the limiter by guessing correctly. The dashboard
  // Rate Limiting rule remains a recommended second layer.
  const decision = await decideAdminLogin({
    password,
    limiter: env.ADMIN_LOGIN_RATE_LIMIT,
    rateLimitKey: `admin-login:${getClientIp(request)}`,
    checkPassword: checkAdminPassword,
  });

  if (decision.kind === 'rate-limited') {
    return Response.json(
      { ok: false, error: 'Too many login attempts. Try again shortly.' },
      {
        status: 429,
        headers: { 'cache-control': 'no-store', 'retry-after': String(decision.retryAfterSeconds) },
      },
    );
  }

  if (decision.kind === 'invalid-password') {
    // Deliberately generic message + no timing difference (see timingSafeEqual).
    return Response.json(
      { ok: false, error: 'Incorrect password.' },
      { status: 401, headers: { 'cache-control': 'no-store' } },
    );
  }

  let setCookie: string;
  try {
    setCookie = await issueAdminCookie();
  } catch {
    // Missing D1 binding or migration 0008 not applied: fail closed, never a
    // session. The password was correct, but no session can be persisted.
    return Response.json(
      { ok: false, error: 'Admin session storage is unavailable. Apply the D1 migration and try again.' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }

  return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store', 'Set-Cookie': setCookie } });
};
