import type { CollectionEntry } from 'astro:content';

// Shared feed plumbing for the unified /posts/ area.
//
// Blog essays and novel chapters live in two different collections but are
// presented as one chronological stream on the homepage and in /posts/. Keeping
// the mapping here means the badge, the href and the sort order cannot drift
// between the two pages.

export type FeedKind = 'blog' | 'novel';

export interface FeedItem {
  kind: FeedKind;
  id: string;
  title: string;
  date: Date;
  href: string;
  description: string;
  meta: string;
  tags: string[];
  volume?: string;
  chapter?: number;
}

/** "第一卷 · 第 2 章" — used in meta rows and chapter lists. */
export function chapterLabel(volume: string, chapter: number): string {
  return `${volume} · 第 ${chapter} 章`;
}

export function toBlogFeedItem(entry: CollectionEntry<'blog'>): FeedItem {
  return {
    kind: 'blog',
    id: entry.id,
    title: entry.data.title,
    date: entry.data.date,
    href: `/posts/blog/${entry.id}`,
    description: entry.data.description,
    meta: entry.data.category,
    tags: entry.data.tags,
  };
}

export function toNovelFeedItem(entry: CollectionEntry<'novel'>): FeedItem {
  return {
    kind: 'novel',
    id: entry.id,
    title: entry.data.title,
    date: entry.data.date,
    href: `/posts/novel/${entry.id}`,
    description: entry.data.description,
    meta: chapterLabel(entry.data.volume, entry.data.chapter),
    tags: entry.data.tags,
    volume: entry.data.volume,
    chapter: entry.data.chapter,
  };
}

/**
 * Merge both collections into one newest-first stream. Ties fall back to the
 * id so the server render is stable (two items published the same day must not
 * swap order between builds).
 */
export function buildMixedFeed(
  blog: CollectionEntry<'blog'>[],
  novel: CollectionEntry<'novel'>[],
  limit?: number,
): FeedItem[] {
  const items = [...blog.map(toBlogFeedItem), ...novel.map(toNovelFeedItem)].sort(
    (a, b) => b.date.valueOf() - a.date.valueOf() || a.id.localeCompare(b.id),
  );
  return typeof limit === 'number' ? items.slice(0, limit) : items;
}

/** Reading order is `order` first (explicit), then chapter number. */
export function sortNovelChapters(entries: CollectionEntry<'novel'>[]): CollectionEntry<'novel'>[] {
  return [...entries].sort((a, b) => a.data.order - b.data.order || a.data.chapter - b.data.chapter);
}

/** Previous / next chapter for the reading page, in reading order. */
export function novelNeighbours(
  entries: CollectionEntry<'novel'>[],
  currentId: string,
): { prev: CollectionEntry<'novel'> | null; next: CollectionEntry<'novel'> | null } {
  const sorted = sortNovelChapters(entries.filter((entry) => !entry.data.draft));
  const index = sorted.findIndex((entry) => entry.id === currentId);
  if (index === -1) return { prev: null, next: null };
  return {
    prev: index > 0 ? sorted[index - 1] : null,
    next: index < sorted.length - 1 ? sorted[index + 1] : null,
  };
}

/** Group chapters by volume, preserving reading order inside each volume. */
export function groupNovelByVolume(
  entries: CollectionEntry<'novel'>[],
): { volume: string; chapters: CollectionEntry<'novel'>[] }[] {
  const groups: { volume: string; chapters: CollectionEntry<'novel'>[] }[] = [];
  for (const entry of sortNovelChapters(entries)) {
    const last = groups[groups.length - 1];
    if (last && last.volume === entry.data.volume) last.chapters.push(entry);
    else groups.push({ volume: entry.data.volume, chapters: [entry] });
  }
  return groups;
}
