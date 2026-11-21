// Canonical names for the fiction setting (optional feature).
//
// If you use the dictionary / world-building collections, UI copy should not
// spell these names out by hand: a single rename should be one edit here, not a
// grep across pages. `WORLD_NAME` is the setting itself; `CONLANG_NAME` is the
// constructed language documented in /dictionary.
//
// The dictionary itself stays in `src/i18n/ui.ts` (values are strings, not
// expressions), so `dictionary_page_title` / `world_page_title` may spell these
// names out; keep them in sync with this file when renaming.

export const WORLD_NAME = '你的世界';
export const CONLANG_NAME = '你的語言';
