// Compatibility re-export.
//
// The dictionary and the `t()` / `getI18NDict()` / `fmt()` helpers used to live
// here; they now live in `src/i18n/ui.ts` so i18n has a home of its own. This
// module is kept as a thin alias only: every existing `../lib/i18n` import keeps
// resolving without a repository-wide rewrite, and the exported surface (`t`,
// `getI18NDict`, `Lang`, `Dict`, `DEFAULT_LANG`) is unchanged.
//
// New code may import from either path, but do not add logic here — a second
// copy of anything translation-related would drift from `src/i18n/ui.ts`.

export * from '../i18n/ui';
