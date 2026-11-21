import { getCollection } from 'astro:content';
import { getWordCount } from './word-count';

// Site-wide content statistics for the SSR /about page.
//
// The collections are baked into the Worker at build time, so the totals can
// only change when a new deploy ships. `getWordCount()` used to run over every
// post body on every request; the promise below is created once per Worker
// isolate and reused for the rest of its lifetime (cold start pays it once).
// Keeping this in a module means the other content reads on /about (counts,
// categories, tags) share the same single collection query as well.

export interface ContentStats {
  postCount: number;
  categories: number;
  tags: number;
  wordCount: number;
}

let cachedStats: Promise<ContentStats> | null = null;

export function getContentStats(): Promise<ContentStats> {
  cachedStats ??= (async () => {
    const posts = await getCollection('blog', ({ data }) => !data.draft);
    const categories = new Set(posts.map((post) => post.data.category).filter(Boolean)).size;
    const tags = new Set(posts.flatMap((post) => post.data.tags)).size;
    const wordCount = posts.reduce((total, post) => total + getWordCount(post.body ?? ''), 0);
    return { postCount: posts.length, categories, tags, wordCount };
  })();

  return cachedStats;
}
