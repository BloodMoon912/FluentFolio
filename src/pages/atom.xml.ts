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
 * Atom 1.0 feed for the blog. Same entry set and ordering as `/rss.xml`; Atom is
 * offered because some readers prefer it and it has typed timestamps. The
 * origin comes from Astro's `site` (or the request URL in dev) and the titles
 * from `src/site.config.ts`, so the feed carries no hardcoded site identity.
 */
export const GET: APIRoute = async ({ site, url }) => {
  const origin = site?.origin ?? url.origin;
  const posts = (await getCollection('blog', ({ data }) => !data.draft))
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf())
    .slice(0, 20);

  const updated = posts[0]?.data.updatedDate ?? posts[0]?.data.date ?? new Date();

  const entries = posts
    .map((post) => {
      const link = `${origin}/posts/blog/${encodeURIComponent(post.id)}`;
      const published = post.data.date.toISOString();
      const changed = (post.data.updatedDate ?? post.data.date).toISOString();
      const categories = [post.data.category, ...post.data.tags]
        .map((term) => `<category term="${escapeXml(term)}" />`)
        .join('\n      ');
      return `
  <entry>
    <title>${escapeXml(post.data.title)}</title>
    <link href="${escapeXml(link)}" />
    <id>${escapeXml(link)}</id>
    <published>${published}</published>
    <updated>${changed}</updated>
    <summary>${escapeXml(post.data.description)}</summary>
    <author><name>${escapeXml(post.data.author)}</name></author>
    ${categories}
  </entry>`;
    })
    .join('');

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(siteConfig.feeds.blog.title)}</title>
  <subtitle>${escapeXml(siteConfig.feeds.blog.description)}</subtitle>
  <link href="${escapeXml(origin)}/atom.xml" rel="self" type="application/atom+xml" />
  <link href="${escapeXml(origin)}/posts" rel="alternate" type="text/html" />
  <id>${escapeXml(origin)}/</id>
  <updated>${updated.toISOString()}</updated>
  <author><name>${escapeXml(siteConfig.titleSuffix)}</name></author>
  ${entries}
</feed>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/atom+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=900',
    },
  });
};
