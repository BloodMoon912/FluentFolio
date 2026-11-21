import type { CollectionEntry } from 'astro:content';

// Lore lookups and the reverse index.
//
// The forward direction (chapter → lore) lives in the novel schema as
// `relatedLore`. The reverse direction is derived here by scanning the novel
// collection, so it can never drift from the frontmatter.
//
// Definitions are no longer exported as a lookup table: the Sätteri plugin in
// `src/lib/lore-plugin.mjs` inlines each definition as a `data-tooltip`
// attribute at build time, so the client needs no /lore.json endpoint.

export type NovelEntry = CollectionEntry<'novel'>;

/**
 * Reverse index: every published chapter whose `relatedLore` mentions this
 * dictionary entry. Reading order is `order`, then chapter number.
 */
export function chaptersMentioning(dictionaryId: string, novelEntries: NovelEntry[]): NovelEntry[] {
  return novelEntries
    .filter((entry) => !entry.data.draft && entry.data.relatedLore.includes(dictionaryId))
    .sort((a, b) => a.data.order - b.data.order || a.data.chapter - b.data.chapter);
}

/** Reverse index for the world pages: chapters whose `relatedLore` lists this world entry. */
export function chaptersMentioningWorld(worldId: string, novelEntries: NovelEntry[]): NovelEntry[] {
  return novelEntries
    .filter((entry) => !entry.data.draft && entry.data.relatedLore.includes(worldId))
    .sort((a, b) => a.data.order - b.data.order || a.data.chapter - b.data.chapter);
}
