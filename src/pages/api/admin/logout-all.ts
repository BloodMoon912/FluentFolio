import type { APIRoute } from 'astro';
import { clearAdminCookie, requireAdmin, revokeAllAdminSessionsForCurrentAdmin } from '../../../lib/admin-auth';

export const prerender = false;

/**
 * Revoke every server-side admin session ("log out all devices"). Requires an
 * active session, so a caller cannot use it to log the administrator out; D1
 * unavailability is a 503 (fail closed), never a silent success.
 */
export const POST: APIRoute = async ({ request }) => {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  try {
    await revokeAllAdminSessionsForCurrentAdmin();
  } catch {
    return Response.json(
      { ok: false, error: 'Admin session storage is unavailable. Try again shortly.' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }

  return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store', 'Set-Cookie': clearAdminCookie() } });
};
