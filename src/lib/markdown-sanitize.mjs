import { satteriSanitize } from 'satteri-sanitize';

// HAST sanitizer for every Markdown document rendered by the site.
//
// Sätteri passes raw HTML through untouched, so Markdown that contains
// `<script>` or `javascript:` links would otherwise reach the page verbatim.
// This is wired as the last `hastPlugins` entry in astro.config.mjs.
//
// The only allowlist widening is for the span that `loreLinksPlugin` generates:
// without it the sanitizer keeps the text but drops `class` / `data-*`, which
// would silently disable the dictionary popover. `className` is the hast
// property name the default span allowlist uses; the rest are the lore
// attributes in their lower-case HTML form.
//
// Deliberately NOT allowed: `on*` handlers (the sanitizer refuses them even if
// listed), `style`, iframes, and `javascript:` / `data:` URLs. Do not widen
// this to make hand-written HTML look nicer.

/** Attributes the lore span needs; keep in sync with `src/lib/lore-plugin.mjs`. */
export const LORE_SPAN_ATTRIBUTES = ['className', 'data-lore-word', 'data-tooltip', 'data-lore-missing', 'tabindex'];

export const markdownSanitize = satteriSanitize({
  attributes: {
    span: LORE_SPAN_ATTRIBUTES,
  },
});

export default markdownSanitize;
