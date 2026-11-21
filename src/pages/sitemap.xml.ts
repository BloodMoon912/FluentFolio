import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/** Newest of a set of dates, as an ISO string, or `undefined` when empty. */
function newest(dates: Date[]): string | undefined {
  if (dates.length === 0) return undefined;
  return new Date(Math.max(...dates.map((date) => date.valueOf()))).toISOString();
}

/**
 * The sitemap is generated from the same content collections the pages render
 * (drafts excluded), so it can never advertise a deleted or unpublished URL.
 * `changefreq` and `priority` are deliberately omitted: Google documents that it
 * ignores both, and they only go stale.
 *
 * The absolute origin comes from Astro's configured `site` (via the endpoint
 * context), never from the request URL, so the URLs are canonical regardless of
 * which hostname served the request.
 */
export const GET: APIRoute = async ({ site, url }) => {
  const origin = site?.origin ?? url.origin;

  const [blogEntries, novelEntries, dictionaryEntries, worldEntries] = await Promise.all([
    getCollection('blog', ({ data }) => !data.draft),
    getCollection('novel', ({ data }) => !data.draft),
    getCollection('dictionary', ({ data }) => !data.draft),
    getCollection('world', ({ data }) => !data.draft),
  ]);

  const latestContent = newest([
    ...blogEntries.map((post) => post.data.updatedDate ?? post.data.date),
    ...novelEntries.map((chapter) => chapter.data.date),
  ]);

  // `/privacy` and `/terms` change only with a policy revision. Keep this in
  // step with `legal_effective` in src/i18n/ui.ts.
  const LEGAL_LAST_MOD = '2026-11-03';

  const staticEntries: Array<{ path: string; lastmod?: string }> = [
    { path: '/', lastmod: latestContent },
    { path: '/posts', lastmod: latestContent },
    // The wiki index pages have no per-entry timestamps; a fabricated lastmod
    // would be worse than none.
    { path: '/dictionary' },
    { path: '/world' },
    { path: '/about', lastmod: latestContent },
    { path: '/terms', lastmod: LEGAL_LAST_MOD },
    { path: '/privacy', lastmod: LEGAL_LAST_MOD },
  ];

  const urlEntry = (loc: string, lastmod?: string) => `
  <url>
    <loc>${escapeXml(loc)}</loc>${lastmod ? `\n    <lastmod>${escapeXml(lastmod)}</lastmod>` : ''}
  </url>`;

  const staticUrls = staticEntries.map((entry) => urlEntry(origin + entry.path, entry.lastmod)).join('');

  const blogUrls = blogEntries
    .map((post) =>
      urlEntry(
        `${origin}/posts/blog/${encodeURIComponent(post.id)}`,
        (post.data.updatedDate ?? post.data.date).toISOString(),
      ),
    )
    .join('');

  const novelUrls = novelEntries
    .map((chapter) =>
      urlEntry(`${origin}/posts/novel/${encodeURIComponent(chapter.id)}`, chapter.data.date.toISOString()),
    )
    .join('');

  // Dictionary and world entries carry no dates, so no lastmod is emitted.
  const dictionaryUrls = dictionaryEntries
    .map((entry) => urlEntry(`${origin}/dictionary/${encodeURIComponent(entry.id)}`))
    .join('');

  const worldUrls = worldEntries.map((entry) => urlEntry(`${origin}/world/${encodeURIComponent(entry.id)}`)).join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${staticUrls}${blogUrls}${novelUrls}${dictionaryUrls}${worldUrls}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
