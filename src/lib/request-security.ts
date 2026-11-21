/**
 * Fail closed unless a state-changing browser request comes from this exact
 * origin. This is an additional CSRF barrier alongside the admin session's
 * SameSite cookie, not a replacement for authentication.
 */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
