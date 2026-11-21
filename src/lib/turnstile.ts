/**
 * Server-side Cloudflare Turnstile verification.
 *
 * Deliberately free of any `cloudflare:workers` import: the caller passes the
 * secret and the allowed hostnames in, which keeps this module unit-testable
 * (see tests/turnstile.test.ts).
 *
 * Read this before changing anything here. An earlier Turnstile integration
 * looped — a visitor solved a challenge and a new one appeared immediately —
 * and it was removed rather than left in that state. The loop had a cause on
 * each side, and both are fixed here:
 *
 *   1. Client: `registerVisit` answered *any* non-2xx response with `reset()`,
 *      which re-armed the widget immediately and with no retry limit, and the
 *      rendered widget was never removed once its token had been spent.
 *      See public/scripts/turnstile-client.js.
 *   2. Server: `success` was not the only condition — an action or hostname
 *      mismatch also failed verification, and the caller could not tell a bad
 *      token from a configuration mistake. Every deployment whose hostname was
 *      missing from TURNSTILE_HOSTNAMES therefore rejected every token, which
 *      is what turned (1) into an endless loop.
 *
 * So: this module reports *why* verification failed — visible in a log line and
 * in the 403 body — while keeping Cloudflare's canonical strictness.
 */

export type TurnstileFailureReason =
  | 'not-configured'
  | 'missing-token'
  | 'malformed-token'
  | 'verification-failed'
  | 'action-mismatch'
  | 'hostnames-not-configured'
  | 'hostname-mismatch'
  | 'network-error';

export type TurnstileOutcome = { ok: true } | { ok: false; reason: TurnstileFailureReason };

export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Tokens are opaque and short; bound the length so junk never reaches siteverify. */
const MAX_TOKEN_LENGTH = 2048;

/** `TURNSTILE_HOSTNAMES` is a comma-separated list; blank entries are ignored. */
export function parseHostnameList(raw: string | undefined | null): string[] {
  return (raw ?? '')
    .split(',')
    .map((hostname) => hostname.trim())
    .filter(Boolean);
}

/**
 * Pure decision over Cloudflare's siteverify payload, so the rules can be tested
 * without a network call or a Worker environment.
 *
 * This mirrors Cloudflare's canonical siteverify contract: the token must have
 * succeeded, must carry the action this surface asked for, and must carry a
 * hostname that is on the deployment's allow-list. A missing allow-list is a
 * hard failure, never a silent pass.
 *
 * That strictness is only affordable because the client can no longer loop (see
 * public/scripts/turnstile-client.js). A misconfigured allow-list now degrades a
 * non-critical analytics beacon and reports its reason, instead of trapping the
 * visitor in an endless challenge. An earlier revision of this file made the
 * list advisory as a workaround for that loop — the wrong fix for the right
 * problem: fix the loop, not the security control.
 */
export function judgeTurnstileOutcome(
  payload: unknown,
  expectedAction: string,
  allowedHostnames: readonly string[],
): TurnstileOutcome {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'verification-failed' };

  const result = payload as { success?: boolean; action?: string; hostname?: string };
  if (result.success !== true) return { ok: false, reason: 'verification-failed' };

  // The action stops a token minted for one surface being replayed against
  // another. A blank expectedAction means the surface does not care.
  if (expectedAction && result.action !== expectedAction) return { ok: false, reason: 'action-mismatch' };

  if (allowedHostnames.length === 0) return { ok: false, reason: 'hostnames-not-configured' };
  if (!allowedHostnames.includes(result.hostname ?? '')) return { ok: false, reason: 'hostname-mismatch' };

  return { ok: true };
}

export interface VerifyTurnstileParams {
  token: unknown;
  remoteip: string;
  /** Must match the `action` the client passed to `turnstile.render()`. */
  expectedAction: string;
  secret: string | undefined;
  allowedHostnames: readonly string[];
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Verify one token against siteverify. Never throws: every failure mode is
 * reported as a reason, because the caller has to distinguish "no secret
 * configured" (carry on without protection) from "bad token" (reject the
 * request) without guesswork.
 */
export async function verifyTurnstileToken(params: VerifyTurnstileParams): Promise<TurnstileOutcome> {
  const { token, remoteip, expectedAction, secret, allowedHostnames, fetchImpl = fetch } = params;

  if (!secret) return { ok: false, reason: 'not-configured' };
  if (typeof token !== 'string' || token.length === 0) return { ok: false, reason: 'missing-token' };
  if (token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: 'malformed-token' };

  try {
    const response = await fetchImpl(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({ secret, response: token, remoteip }),
    });
    if (!response.ok) return { ok: false, reason: 'network-error' };
    return judgeTurnstileOutcome(await response.json(), expectedAction, allowedHostnames);
  } catch {
    return { ok: false, reason: 'network-error' };
  }
}
