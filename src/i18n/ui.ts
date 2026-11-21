// UI dictionary and translation helpers.
//
// The copy itself lives in `src/i18n/ui.json` so a site can replace it without
// touching TypeScript, and so a private content repository can overlay it the
// same way it overlays `site.config.json` and the brand media. This module is
// the only place that knows the shape; `src/lib/i18n.ts` re-exports it for
// existing `../lib/i18n` imports.
//
// The dictionary is serialised into `#i18n-dict` by BaseLayout and read by the
// client-side `window.T`, so every key here is part of the client contract —
// rename a key only together with its `data-i18n*` / `t()` consumers.

import raw from './ui.json' with { type: 'json' };

export type Lang = 'zh' | 'en';

export const DEFAULT_LANG: Lang = 'zh';

export type Dict = Record<string, string>;

const I18N = raw as Record<Lang, Dict>;

function fmt(template: string, args: unknown[]): string {
  return template.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? ''));
}

export function t(lang: Lang, key: string, ...args: unknown[]): string {
  const value = I18N?.[lang]?.[key] ?? I18N.zh[key] ?? key;
  return fmt(value, args);
}

export function getI18NDict(): Record<Lang, Dict> {
  return I18N;
}
