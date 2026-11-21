import type { APIRoute } from 'astro';
import { getEntry } from 'astro:content';
import { profile } from '../../lib/data';
import { formatHKTDate } from '../../lib/time';
import { renderOgSvg } from '../../lib/og';

export const GET: APIRoute = async ({ params }) => {
  const slug = params.slug;
  const post = slug ? await getEntry('blog', slug) : null;

  const svg =
    post && !post.data.draft
      ? renderOgSvg({
          eyebrow: post.data.category,
          title: post.data.title,
          meta: `${post.data.author} · ${formatHKTDate(post.data.date)}`,
          brand: profile.nameShort,
        })
      : renderOgSvg({
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
