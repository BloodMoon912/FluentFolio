import type { APIRoute } from 'astro';
import { clearAdminCookie, revokeCurrentAdminSession } from '../../../lib/admin-auth';
import { isSameOriginRequest } from '../../../lib/request-security';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!isSameOriginRequest(request)) {
    return Response.json({ ok: false, error: 'Cross-origin request rejected.' }, { status: 403 });
  }

  // Best-effort server-side revocation: the D1 row for this cookie is marked
  // revoked (when it exists and D1 is reachable) so a stolen copy of the cookie
  // cannot be replayed. Logout stays idempotent, so the cookie is cleared even
  // when there is no valid session or D1 is unavailable.
  await revokeCurrentAdminSession(request);

  return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store', 'Set-Cookie': clearAdminCookie() } });
};
