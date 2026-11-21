# Upgrading a site that uses FluentFolio

FluentFolio is designed to be an upstream theme, not a starting point you fork
and rewrite. A site built on it keeps three layers apart so a theme update only
touches the first one.

## The three layers

| Layer       | Files                                                                                                                                                                                                             | Owner                |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **Theme**   | `src/components/**`, `src/layouts/**`, `src/pages/**` (except content pages), `src/styles/**`, `src/scripts/**`, `src/lib/**` (except identity data), `public/scripts/**`, `tests/**`, `scripts/**`, build config | Upstream (this repo) |
| **Site**    | `src/site.config.ts`, `src/lib/data.ts`, `src/i18n/ui.ts`, `wrangler.jsonc`, `.env*`, `src/pages/about.astro`, `src/pages/terms.astro`, `src/pages/privacy.astro`                                                 | Your site            |
| **Content** | `src/content/**` (or a private content repository fetched during CI), `public/**` assets, `src/assets/**` images and fonts                                                                                        | Your site            |

The rule of thumb: **if a change is about who you are, put it in the Site layer.**
If it is about how the site behaves for everyone, it belongs upstream in the
theme.

## What makes the merge painless

- `src/layouts/BaseLayout.astro` reads the site title, suffix, alternate names
  and navigation from `src/site.config.ts`. Renaming the site or reordering the
  nav is a one-file edit in the Site layer, so the layout itself can be replaced
  by the upstream version without conflicts.
- `src/lib/data.ts` holds profile/socials/support links; `src/i18n/ui.ts` holds
  every string. Both are Site-layer files that the theme never edits.
- Content lives in `src/content/` and assets in `public/` + `src/assets/`; the
  theme only reads them through the content collections.

## Upgrade procedure

```bash
# one-time
git remote add theme https://github.com/<owner>/fluentfolio.git
git fetch theme

# every upgrade
git switch -c chore/theme-update
git merge theme/main
npm ci
npm run check
npm run check:public
npm run build
npm run check:inline-scripts
npm test
```

Expected conflicts are limited to the Site layer:

- `src/site.config.ts` — keep your values, take new fields from upstream.
- `src/lib/data.ts`, `src/i18n/ui.ts` — keep yours; add any new keys the theme
  expects (the build fails loudly on a missing key).
- `src/pages/{about,terms,privacy}.astro` — site-specific copy; keep yours, or
  move the prose into `src/content/` if you prefer.
- `src/content/**`, `public/**` — yours; upstream demo files can be ignored.

If a theme-owned file conflicts, that is a signal: either the change should be
upstreamed to FluentFolio, or it belongs in `src/site.config.ts`. Do not keep a
long-lived fork of a theme file.

## Sites with a private content repository

Keep the content checkout out of the theme merge entirely. The reference setup
fetches a private repository into `src/content/` during CI (see
`examples/private-content-repo/`), so the code repository never stores articles
and a theme update cannot touch them.

## After the merge

- Check the topbar at 360/768/1024/1280 px, in both themes.
- Check a post page: TOC numbering, the sliding active marker, reading progress.
- Check `/status` and `/about` if you use them; these are Site-layer pages and
  may need a small edit when a theme component changes its props.

## Identity values used by generated files

Two more values live in `src/site.config.ts` precisely because generated output
must not hardcode a site:

- `url` — absolute origin, no trailing slash. `src/pages/robots.txt.ts` passes
  it to `buildRobotsTxt()`, so the sitemap line follows the Site layer.
- `licenseNotice.zh` / `licenseNotice.en` — the attribution appended by the copy
  guard. The protected pages render them as `data-copy-license-*` attributes, so
  `public/scripts/copy-guard.js` itself ships no personal string.
