// Pure ordering/decision core for `POST /api/admin/login` (#3).
//
// The rate limiter is consulted BEFORE the password is compared, and every
// attempt — successful or not — consumes the same bucket. A correct password
// presented after the bucket is exhausted is therefore still answered 429.
// Keeping this a pure function lets tests prove the order without importing
// `cloudflare:workers`.

export const ADMIN_LOGIN_RETRY_AFTER_SECONDS = 60;

export interface AdminLoginRateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export type AdminLoginDecision =
  { kind: 'rate-limited'; retryAfterSeconds: number } | { kind: 'invalid-password' } | { kind: 'ok' };

export interface AdminLoginAttempt {
  password: string;
  /** Rate-limiting bucket, e.g. `admin-login:<client ip>`. */
  rateLimitKey: string;
  checkPassword(candidate: string): boolean;
  /** Absent binding = the site was deployed without the limiter; behaviour unchanged. */
  limiter?: AdminLoginRateLimiter | null;
}

export async function decideAdminLogin(attempt: AdminLoginAttempt): Promise<AdminLoginDecision> {
  if (attempt.limiter) {
    try {
      const { success } = await attempt.limiter.limit({ key: attempt.rateLimitKey });
      if (!success) return { kind: 'rate-limited', retryAfterSeconds: ADMIN_LOGIN_RETRY_AFTER_SECONDS };
    } catch {
      // The edge binding is a best-effort layer; a binding error must not lock
      // the administrator out. The Cloudflare dashboard Rate Limiting rule is
      // still recommended as a second layer.
    }
  }

  return attempt.checkPassword(attempt.password) ? { kind: 'ok' } : { kind: 'invalid-password' };
}
