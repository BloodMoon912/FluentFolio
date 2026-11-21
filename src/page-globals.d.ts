// Page-global namespace shared between the shell script in BaseLayout.astro and
// the per-page scripts.
//
// These live on `window` because the scripts have different lifecycles: the
// shell runs once per full page load, while a page script is re-executed by swup
// on every navigation and has to find the shell's helpers already in place.
//
// Declaring them here is what lets those scripts be type-checked instead of
// silenced: without it, `astro check` reports "Property 'T' does not exist on
// type 'Window & typeof globalThis'" for every access.

export {};

declare global {
  interface Window {
    /** Translate a dictionary key, with optional positional substitutions. */
    T?: (key: string, ...args: unknown[]) => string;
    /** Current UI language, as chosen by the visitor. */
    getLang?: () => 'zh' | 'en';
    /** Switch language and re-apply every `[data-i18n*]` label on the page. */
    setLang?: (next: string) => void;
    /** Set by the homepage dashboard script; stops the previous run's timers and socket. */
    __bmHomeCleanup?: () => void;
    /** Set once this tab's visit beacon has been installed (guards a second run). */
    __bmVisitBeaconInstalled?: boolean;
    /** Set before the single Turnstile challenge this tab is allowed to make. */
    __bmVisitChallengeAttempted?: boolean;
    /** Scroll listener for <ReadingProgress /> is bound (re-runs update instead). */
    __bmReadingProgressBound?: boolean;
    /** Scroll listener for <TOC /> scroll spy is bound. */
    __bmTocBound?: boolean;
    /** Lore popover listeners are bound (definitions come from data-tooltip, no fetch). */
    __bmLoreTooltipBound?: boolean;
    /** Copy-guard delegated listeners are bound (module loads once, survives Swup). */
    __bmCopyGuardInstalled?: boolean;
  }
}
