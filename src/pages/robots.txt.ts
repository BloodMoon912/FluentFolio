import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { buildRobotsTxt } from '../lib/robots-txt';
import { siteConfig } from '../site.config';
import type { CrawlPolicyEntry } from '../lib/crawl-policy';

// The policy only changes when content or its frontmatter changes, so the file
// is baked at build time and served as an asset. A per-request route would add
// latency for no benefit and could drift from the sitemap generated at the same
// build.
export const prerender = true;

/**
 * robots.txt, generated from the same content collections the pages render.
 * Drafts are skipped by the policy helpers, so an unpublished chapter can never
 * leak a trial allowance.
 */
export const GET: APIRoute = async () => {
  const [blog, novel, dictionary, world] = await Promise.all([
    getCollection('blog'),
    getCollection('novel'),
    getCollection('dictionary'),
    getCollection('world'),
  ]);

  const entries: CrawlPolicyEntry[] = [
    ...blog.map((entry) => ({
      id: entry.id,
      collection: 'blog' as const,
      draft: entry.data.draft,
      override: entry.data.crawl,
    })),
    ...novel.map((entry) => ({
      id: entry.id,
      collection: 'novel' as const,
      chapter: entry.data.chapter,
      draft: entry.data.draft,
      override: entry.data.crawl,
    })),
    ...dictionary.map((entry) => ({
      id: entry.id,
      collection: 'dictionary' as const,
      draft: entry.data.draft,
      override: entry.data.crawl,
    })),
    ...world.map((entry) => ({
      id: entry.id,
      collection: 'world' as const,
      draft: entry.data.draft,
      override: entry.data.crawl,
    })),
  ];

  return new Response(buildRobotsTxt(entries, siteConfig.url), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
