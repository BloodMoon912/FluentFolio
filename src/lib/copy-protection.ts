// Pure copy-protection policy. The client-side guard and the content schema
// share this module so "which collections are protected" has one definition.

export type CopyCollection = 'blog' | 'novel' | 'dictionary' | 'world';

/** Clipboard text above this length is truncated to the opening and a source line. */
export const COPY_MAX_CHARS = 120;

const PROTECTED_COLLECTIONS: ReadonlySet<CopyCollection> = new Set(['novel', 'dictionary', 'world']);

/**
 * Fiction, world-building and dictionary entries are protected by default;
 * blog posts are not. `override` is the per-entry frontmatter value and wins.
 */
export function isCopyProtected(collection: CopyCollection, override?: boolean): boolean {
  if (typeof override === 'boolean') return override;
  return PROTECTED_COLLECTIONS.has(collection);
}
