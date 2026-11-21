import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { siteConfig } from '../site.config';

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/**
 * Blog feed. The absolute origin comes from Astro's configured `site` (endpoint
 * context), not from the request URL, so the feed is canonical whichever
 * hostname served it. The author element is `dc:creator` — RSS 2.0's own
 * `<author>` expects an email address and most readers ignore it.
 */
export const GET: APIRoute = async ({ site, url }) => {
  const origin = site?.origin ?? url.origin;
  const posts = (await getCollection('blog', ({ data }) => !data.draft))
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf())
    .slice(0, 20);

  const items = posts
    .map((post) => {
      const link = `${origin}/posts/blog/${encodeURIComponent(post.id)}`;
      return `
    <item>
      <title>${escapeXml(post.data.title)}</title>
      <description>${escapeXml(post.data.description)}</description>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(link)}</guid>
      <pubDate>${post.data.date.toUTCString()}</pubDate>
      <category>${escapeXml(post.data.category)}</category>
      ${post.data.tags.map((tag) => `<category>${escapeXml(tag)}</category>`).join('')}
      <dc:creator>${escapeXml(post.data.author)}</dc:creator>
    </item>`;
    })
    .join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeXml(siteConfig.feeds.blog.title)}</title>
    <description>${escapeXml(siteConfig.feeds.blog.description)}</description>
    <link>${escapeXml(origin)}/posts</link>
    <atom:link xmlns:atom="http://www.w3.org/2005/Atom" href="${escapeXml(origin)}/rss.xml" rel="self" type="application/rss+xml" />
    <language>zh-Hant-TW</language>
    <lastBuildDate>${posts[0]?.data.updatedDate?.toUTCString() ?? posts[0]?.data.date.toUTCString() ?? new Date().toUTCString()}</lastBuildDate>
    ${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=900',
    },
  });
};
