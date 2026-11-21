import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/**
 * Separate feed for the serialised novel, so readers can follow chapters
 * without subscribing to every blog essay (and vice versa). Same conventions as
 * `/rss.xml`: Astro `site` for the origin, `dc:creator` for the author.
 */
export const GET: APIRoute = async ({ site, url }) => {
  const origin = site?.origin ?? url.origin;
  const chapters = (await getCollection('novel', ({ data }) => !data.draft))
    .sort(
      (a, b) =>
        b.data.date.valueOf() - a.data.date.valueOf() ||
        (a.data.volume === b.data.volume ? a.data.chapter - b.data.chapter : 0),
    )
    .slice(0, 20);

  const items = chapters
    .map((chapter) => {
      const link = `${origin}/posts/novel/${encodeURIComponent(chapter.id)}`;
      const description =
        chapter.data.description ||
        `${chapter.data.volume} 第 ${chapter.data.chapter} 章${chapter.data.title ? `：${chapter.data.title}` : ''}`;
      return `
    <item>
      <title>${escapeXml(chapter.data.title)}</title>
      <description>${escapeXml(description)}</description>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(link)}</guid>
      <pubDate>${chapter.data.date.toUTCString()}</pubDate>
      <dc:creator>${escapeXml(chapter.data.author)}</dc:creator>
    </item>`;
    })
    .join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Your Name Novel</title>
    <description>你的名字的連載小說。</description>
    <link>${escapeXml(origin)}/posts?tab=novel</link>
    <atom:link xmlns:atom="http://www.w3.org/2005/Atom" href="${escapeXml(origin)}/rss-novel.xml" rel="self" type="application/rss+xml" />
    <language>zh-Hant-TW</language>
    <lastBuildDate>${chapters[0]?.data.date.toUTCString() ?? new Date().toUTCString()}</lastBuildDate>
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
