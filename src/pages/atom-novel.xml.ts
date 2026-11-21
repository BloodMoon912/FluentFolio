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
 * Atom 1.0 feed for the serialised novel, mirroring `/rss-novel.xml`. Chapter
 * descriptions fall back to the volume/chapter label exactly like the RSS feed,
 * so readers that only show `<summary>` still get a usable line.
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

  const updated = chapters[0]?.data.date ?? new Date();

  const entries = chapters
    .map((chapter) => {
      const link = `${origin}/posts/novel/${encodeURIComponent(chapter.id)}`;
      const description =
        chapter.data.description ||
        `${chapter.data.volume} 第 ${chapter.data.chapter} 章${chapter.data.title ? `：${chapter.data.title}` : ''}`;
      return `
  <entry>
    <title>${escapeXml(chapter.data.title)}</title>
    <link href="${escapeXml(link)}" />
    <id>${escapeXml(link)}</id>
    <updated>${chapter.data.date.toISOString()}</updated>
    <summary>${escapeXml(description)}</summary>
    <author><name>${escapeXml(chapter.data.author)}</name></author>
  </entry>`;
    })
    .join('');

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(siteConfig.feeds.novel.title)}</title>
  <subtitle>${escapeXml(siteConfig.feeds.novel.description)}</subtitle>
  <link href="${escapeXml(origin)}/atom-novel.xml" rel="self" type="application/atom+xml" />
  <link href="${escapeXml(origin)}/posts?tab=novel" rel="alternate" type="text/html" />
  <id>${escapeXml(origin)}/posts?tab=novel</id>
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
