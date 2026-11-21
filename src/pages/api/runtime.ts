import type { APIRoute } from 'astro';
import { HONG_KONG_TIME_ZONE } from '../../lib/time';

// Cloudflare Workers attach request metadata (edge colo, country, TLS info, …)
// on `request.cf`. It isn't part of the standard Request type, so it's read
// defensively here — this keeps the endpoint safe to call even outside the
// Workers runtime (e.g. local `astro dev`).
export const GET: APIRoute = async ({ request }) => {
  const cf = (request as unknown as { cf?: Record<string, unknown> }).cf;

  return Response.json(
    {
      ok: true,
      edge: {
        colo: (cf?.colo as string) ?? null,
        country: (cf?.country as string) ?? null,
        city: (cf?.city as string) ?? null,
        region: (cf?.region as string) ?? null,
        asOrganization: (cf?.asOrganization as string) ?? null,
        httpProtocol: (cf?.httpProtocol as string) ?? null,
        tlsVersion: (cf?.tlsVersion as string) ?? null,
      },
      runtime: 'Cloudflare Workers',
      timeZone: HONG_KONG_TIME_ZONE,
      timeSource: 'Cloudflare runtime clock',
      now: new Date().toISOString(),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
};
