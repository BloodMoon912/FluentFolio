import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection, getEntry } from 'astro:content';
import { defaultOgCard, renderOgPng } from '../../lib/og-png';
import { formatHKTDate } from '../../lib/time';

// One prerendered PNG per published essay and novel chapter, produced at build
// time in Node (see `prerenderEnvironment` in astro.config.mjs). The SVG twin
// `/og/[slug].svg` stays for old links.
export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () => {
  const [posts, chapters] = await Promise.all([
    getCollection('blog', ({ data }) => !data.draft),
    getCollection('novel', ({ data }) => !data.draft),
  ]);

  const seen = new Set<string>();
  const paths: { params: { slug: string } }[] = [];
  // Either collection may be empty; the route then simply generates no files.
  for (const entry of [...posts, ...chapters]) {
    // `/og/[slug].png` is a single path segment. Nested ids (e.g. `guides/setup`)
    // would not match, so the article pages fall back to the site default card
    // for those; a blog/novel id collision keeps the essay's card.
    if (entry.id.includes('/') || seen.has(entry.id)) continue;
    seen.add(entry.id);
    paths.push({ params: { slug: entry.id } });
  }
  return paths;
};

export const GET: APIRoute = async ({ params }) => {
  const slug = params.slug;
  const post = slug ? await getEntry('blog', slug) : undefined;

  const card =
    post && !post.data.draft
      ? {
          eyebrow: post.data.category,
          title: post.data.title,
          meta: `${post.data.author} · ${formatHKTDate(post.data.date)}`,
          brand: defaultOgCard().brand,
        }
      : await novelCard(slug);

  return new Response(renderOgPng(card ?? defaultOgCard()), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};

async function novelCard(slug: string | undefined) {
  const chapter = slug ? await getEntry('novel', slug) : undefined;
  if (!chapter || chapter.data.draft) return null;
  return {
    eyebrow: chapter.data.volume,
    title: chapter.data.title,
    meta: `${chapter.data.author} · ${formatHKTDate(chapter.data.date)}`,
    brand: defaultOgCard().brand,
  };
}
