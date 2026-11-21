import type { APIRoute } from 'astro';
import { profile } from '../lib/data';
import { renderOgSvg } from '../lib/og';

export const GET: APIRoute = async () => {
  const svg = renderOgSvg({
    eyebrow: profile.nameEn,
    title: profile.tagline,
    meta: profile.bio,
    brand: profile.nameShort,
  });

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
