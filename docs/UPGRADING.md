# Upgrading a site that uses FluentFolio

FluentFolio is designed to be an upstream theme, not a starting point you fork
and rewrite. A site built on it keeps three layers apart so a theme update only
touches the first one.

## The three layers

| Layer       | Files                                                                                                                                                                                                             | Owner                |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **Theme**   | `src/components/**`, `src/layouts/**`, `src/pages/**` (except content pages), `src/styles/**`, `src/scripts/**`, `src/lib/**` (except identity data), `public/scripts/**`, `tests/**`, `scripts/**`, build config | Upstream (this repo) |
| **Site**    | `site.config.json`, `src/i18n/ui.ts`, `wrangler.jsonc`, `.env*`, `src/pages/{about,terms,privacy}.astro`                                                                                                          | Your site            |
| **Content** | `src/content/**`, `assets/brand/**`, `assets/background.webp` (normally in a private repository fetched during CI)                                                                                                | Your site            |

Two rules keep upgrades painless:

1. **Identity is data, not code.** Every site-specific value lives in
   `site.config.json`: title, URL, author, nav, feeds, licence, social links,
   About rows, terminology, brand asset paths. `.astro` and `.ts` files stay
   generic, so a theme update replaces them wholesale.
2. **Personal media is content, not code.** Logo, favicon, icons, the background
   video and the Easter egg live under `public/brand/` and are overlaid from the
   content repository at build time. The code repository only keeps the theme's
   placeholder files.

The rule of thumb: **if a change is about who you are, it belongs in
`site.config.json` or the content repository.** If it is about how the site
behaves for everyone, it belongs upstream in the theme.

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

## Sites with a private content repository (the default)

The recommended setup keeps code, identity and media in two repositories:

- **Code repository** — this theme plus a generic `site.config.json` and
  placeholder `public/brand/` files. It is safe to publish and has no personal
  data.
- **Content repository (private)** — the published Markdown **and** the private
  overlay:

  ```
  site.config.json          the real identity, nav, feeds, licence, contacts
  assets/brand/*            logo, favicon, icons, background video/audio
  assets/background.webp    still background for the parallax layer
  src/content/<collection>/ published articles
  ```

The overlay may also include `i18n/ui.json` — every visible string — so even the prose can live in the private repository.

During CI and local development, `npm run fetch:content` clones that repository
and copies the overlay over the theme defaults before Astro builds:

```bash
npm run fetch:content -- --from ../my-content-repo   # local
npm run fetch:content                                # CI, uses CONTENT_REPO_TOKEN
```

Because the overlay is applied after checkout, a theme update never conflicts
with identity or media: the merge only sees theme files, and the private values
are put back on the next build. Use `CONTENT_REQUIRED=1` in CI so a missing
token fails the build instead of publishing an empty site.

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

## Generated output driven by the Site layer

`sitemap`, robots, RSS/Atom, the default author, the admin name and the WebAuthn salt all read
`siteConfig` at runtime or build time, so an upgrade only has to keep this one file (plus the Site-layer
files listed below) and never edit a lib:

| Value           | Affects                                                                             |
| --------------- | ----------------------------------------------------------------------------------- |
| `url`           | canonical, the Sitemap line in robots, feed links and `<id>`                        |
| `licenseNotice` | the copyright line appended when a reader copies an excerpt (`data-copy-license-*`) |
| `feeds`         | the title and description of `/rss*.xml` and `/atom*.xml`                           |
| `authorName`    | the default author for frontmatter and the CMS                                      |
| `adminName`     | the admin area / passkey prompt name                                                |
| `discordName`   | the webhook name for post notifications                                             |
| `webauthnSalt`  | the passkey user handle salt (**changing it invalidates existing passkeys**)        |
| `cmsSlug`       | the GitHub CMS User-Agent                                                           |

The remaining files the Site layer keeps owning: `src/lib/data.ts`, `src/i18n/ui.ts`,
`src/lib/terminology.ts`, `src/pages/about.astro`, `src/pages/terms.astro`, `public/_headers`, the icons
and brand files in `public/`, `src/content/` and `tests/fixtures/`.
