// Request helpers shared by the API routes.

/**
 * Best-effort client IP extraction, consistent across every API route.
 *
 * `CF-Connecting-IP` is set by Cloudflare and is the authoritative value.
 * `X-Forwarded-For` is only a local-development fallback because it is
 * client-controlled when the request has not passed through Cloudflare.
 */
export function getClientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
}
