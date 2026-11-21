# Architecture

Current system map for `fluentfolio`. For conventions and gotchas read
[`AGENTS.md`](../AGENTS.md); this page explains how the pieces fit together. Do not trust
historical process documents (they were moved to [`docs/archive/`](archive/)).

## What it is

A personal site built with **Astro 7 (`output: 'server'`, SSR)** and the
**`@astrojs/cloudflare` adapter**, deployed to **Cloudflare Workers** with **D1** (SQLite) and an
**R2** bucket for CMS images. Content lives in the repository as Markdown collections; an online
admin CMS edits it through the GitHub API, so every change is a commit that Cloudflare Workers
Builds deploys.

```
Browser ──► Cloudflare edge (Access on /admin*, static assets from ASSETS)
                │
                ▼
          Astro Worker (SSR routes + /api/*)  ──►  D1 (DB)
                │                                 R2 (BLOG_IMAGES, public via R2_PUBLIC_BASE_URL)
                ├──► Lanyard / Steam / GitHub APIs
                └──► caches.default (short-lived JSON caches)
```

## Rendering modes

`output: 'server'` renders every route in the Worker unless the page opts into
`export const prerender = true`. Prerendered routes are emitted as static files into
`dist/client` and served by the `ASSETS` binding **before** the Worker (and therefore before
`src/middleware.ts`) runs.

| Route                                                                               | Mode        | Why                                                                                                                              |
| ----------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                                                                 | prerendered | Content collections are baked at build time; the live panels (visitors, Discord, Steam, status) fetch `/api/*` from the browser. |
| `/posts`                                                                            | SSR         | `?tab=blog\|novel` selects the server-rendered tab and must work without JavaScript.                                             |
| `/posts/blog/[...slug]`, `/posts/novel/[...slug]`                                   | prerendered | `getStaticPaths` over published entries.                                                                                         |
| `/dictionary`, `/world`                                                             | SSR         | List indexes; detail pages `/dictionary/[slug]`, `/world/[slug]` are prerendered.                                                |
| `/about`                                                                            | SSR         | Reads the site start time from D1.                                                                                               |
| `/status`                                                                           | SSR         | Real per-request probes of the site, D1, Lanyard and Steam.                                                                      |
| `/privacy`, `/terms`, `/404`                                                        | prerendered | Static text / no request data.                                                                                                   |
| `/admin`, `/admin/login`                                                            | SSR         | Session checks; behind Cloudflare Access.                                                                                        |
| `/api/*`, `/rss.xml`, `/rss-novel.xml`, `/sitemap.xml`, `/og.svg`, `/og/[slug].svg` | SSR         | Worker endpoints.                                                                                                                |
| `/og.png`, `/og/[slug].png`, `/search-index.json`                                   | prerendered | Build-time output (PNG rasterisation, search index).                                                                             |

`cloudflare({ prerenderEnvironment: 'node' })` makes the build evaluate prerendered routes in
Node (the default is workerd), which is required by the native `@resvg/resvg-js` rasteriser.

## Data

- **Content collections** (`src/content.config.ts`): `blog`, `novel`, `dictionary`, `world`.
  Markdown under `src/content/<collection>/`; drafts are excluded everywhere. Build-time data is
  read with `getCollection` / `getEntry` / `render`.
- **Search index**: `/search-index.json` is generated at build time from all four collections,
  including Mandarin (`pinyin-pro`) and Cantonese (`to-jyutping`) romanisation. `src/lib/search-core.ts`
  is the single search engine used by the shell and the admin list.
- **D1** (`DB`, configured in `wrangler.jsonc`, schema in `migrations/`):
  - `visits` — privacy-minimised visitor statistics: hashed visitor id, path, country, referrer host.
  - `cms_drafts` — draft overrides written by the CMS.
  - `admin_passkeys`, `admin_webauthn_challenges` — WebAuthn credentials and single-use challenges.
  - `admin_sessions` — revocable server-side admin sessions.
  - `status_checks` — sampled `/api/status` probe history shown on `/status` (last 24 h).
  - `activity` — only read by `/about` for the site start time.
  - `incidents` — legacy, unused.
- **R2** (`BLOG_IMAGES`): CMS image uploads. Public reads go through `R2_PUBLIC_BASE_URL`; the
  Worker never proxies image bytes.
- **Live APIs**: `/api/activity` proxies Lanyard (with a browser WebSocket fallback),
  `/api/steam` proxies the Steam Web API (whitelisted profile fields only), `/api/status` probes
  the site, D1, Lanyard and Steam.

## Visitor statistics

`public/scripts/visit-beacon.js` sends `POST /api/visitors` on every page view (first load and every
Swup `swup:page:view`), at most once per path per tab, skipping `/admin`, `/api` and `/og`.

- A valid `__Host-bm-visit` cookie (30 days) marks a returning browser and **suppresses Turnstile**;
  it no longer suppresses recording. Every accepted beacon is a view.
- Without that cookie, and only when `TURNSTILE_SECRET` is configured, the request must carry a
  verified Turnstile token (`action: 'visit'`); the client asks for at most one challenge per tab
  and never retries. With no secret the endpoint fails open (analytics must not break the site).
- The server validates the path against known route prefixes, rate-limits per IP
  (`VISITOR_RATE_LIMIT`), hashes `IP + VISITOR_SALT`, treats the same visitor+path pair within 30
  seconds as one view, and only stores the referrer host parsed from the beacon's
  `document.referrer` body field (never the `Referer` header).
- Aggregations cover 30 days; the overview totals cover 180 days. Rows older than
  `VISIT_RETENTION_DAYS` (180) are deleted opportunistically after writes — never on reads.
- `GET /api/visitors` is edge-cached for 60 seconds with a cookie-free cache key; the cookie-derived
  `visited` field is merged after the cache read.

## Security

Two independent gates protect the CMS:

1. **Cloudflare Access** at the edge, plus a Worker-side RS256 JWT verification in
   `src/middleware.ts` → `src/lib/cloudflare-access.ts` (fail-closed; missing config = 503).
   `astro dev` on localhost is the only bypass.
2. **Site session** (`__Host-bm-admin`, HttpOnly/Secure/SameSite=Lax, 7 days): a random session id
   plus an HMAC signed with `ADMIN_SESSION_SECRET`, validated against the `admin_sessions` D1 row
   (expiry, revocation). D1 unavailable ⇒ 503, never a silent allow. Login is Passkey first with an
   `ADMIN_PASSWORD` fallback; `ADMIN_LOGIN_RATE_LIMIT` is consulted _before_ the password comparison
   and counts every attempt. `POST /api/admin/logout` revokes one session; `POST /api/admin/logout-all`
   revokes all of them.

Other defaults: same-origin `Origin` checks on admin mutations, 8 KB login bodies, 64 KB passkey
bodies, sanitised Markdown (`src/lib/markdown-sanitize.mjs`), `escapeHtml` on every interpolated
outer value, and `public/_headers` cache/no-store rules for static assets.

`src/middleware.ts` sets `x-content-type-options`, `referrer-policy`, `x-frame-options`,
`permissions-policy` and the enforced `frame-ancestors`/`object-src`/`base-uri` CSP baseline. A
full `Content-Security-Policy-Report-Only` policy ships for SSR HTML and is **nonce-free**:
every executable script is a same-origin file under `/scripts/`, so `script-src` is
`'self' https://challenges.cloudflare.com`. It is **observational only** — do not enforce it until
the limitations documented in [`DEPLOY-CLOUDFLARE.md`](../DEPLOY-CLOUDFLARE.md) are resolved
(prerendered pages bypass middleware and therefore do not receive the Report-Only header). HSTS is
a Cloudflare dashboard setting, not a code header.

## Bindings and configuration

| Name                       | Type          | Purpose                                     |
| -------------------------- | ------------- | ------------------------------------------- |
| `DB`                       | D1            | All persistent data.                        |
| `BLOG_IMAGES`              | R2            | CMS image uploads.                          |
| `ASSETS`                   | static assets | Build output, prerendered pages, `public/`. |
| `VISITOR_RATE_LIMIT`       | Rate Limiting | 60 visitor beacons / IP / minute.           |
| `ADMIN_LOGIN_RATE_LIMIT`   | Rate Limiting | 5 login attempts / IP / minute.             |
| `ADMIN_PASSKEY_RATE_LIMIT` | Rate Limiting | 20 passkey ceremonies / IP / minute.        |

Plain vars live in `wrangler.jsonc` (`TURNSTILE_HOSTNAMES`, `ACCESS_*`, `ADMIN_WEBAUTHN_*`,
`GITHUB_REPO`, `GITHUB_BRANCH`, `R2_PUBLIC_BASE_URL`). Secrets are set with
`npx wrangler secret put`: `STEAM_API_KEY`, `STEAM_ID`, `VISITOR_SALT`, `VISITOR_COOKIE_SECRET`,
`TURNSTILE_SECRET` (optional), `DISCORD_USER_ID`, `ADMIN_PASSWORD` (optional fallback),
`ADMIN_SESSION_SECRET`, `GITHUB_TOKEN`, `DISCORD_BLOG_WEBHOOK_URL`. `.env.example` lists them all;
`.dev.vars` is git-ignored.

## Build, test and deploy

```bash
npm run check        # astro check (types + diagnostics)
npm run lint         # markdownlint over this repo's docs
npm run validate:md  # content frontmatter/images/links/references
npm run format:check # prettier
npm test             # node --test tests/*.test.ts (pure functions)
npm run build        # production build (prerenders pages, PNG OG cards, search index)
npm run check:og-png # post-build: PNG magic + 1200x630 for /og.png and article cards
```

Logic that needs `cloudflare:workers` is kept thin; decision logic lives in `*-core.ts` modules
(no Worker imports) so it can be unit-tested in plain Node. Every fixed behaviour should have a
test.

Prerendered content pages are evaluated in Node at build time (`prerenderEnvironment: 'node'`),
which is what lets `@resvg/resvg-js` render the Open Graph PNGs from `src/lib/og.ts` using the
subsetted OFL Noto Sans TC fonts in `src/assets/fonts/`. SVG cards are kept for old links; the
default `og:image` is now `/og.png`.

Deployment is driven by Cloudflare Workers Builds on pushes to `main` (`npm run build` +
`npx wrangler deploy`). `.github/workflows/ci.yml` only validates. **Migration order matters**:
apply new migrations to the remote D1 database before the code that reads them is deployed:

```bash
npx wrangler d1 migrations apply personal-site --remote
```

Current migrations: `0001` init, `0002` activity, `0003` visitor geo/referrer, `0004` site start
time, `0005` CMS drafts, `0006` admin passkeys, `0007` visitor indexes, `0008` admin sessions,
`0009` status checks. Never edit an applied migration; add a new numbered file.

## Repository map

- `src/pages/` — routes and `/api/*` Worker endpoints (they read bindings via
  `import { env } from 'cloudflare:workers'`).
- `src/layouts/BaseLayout.astro` — the persistent shell (head metadata, topbar, theme/lang scripts,
  Swup behaviour, visit beacon). `src/components/Seo.astro` emits OG/Twitter/JSON-LD.
- `src/lib/` — server/shared logic; `*-core.ts` files are pure and tested.
- `src/i18n/ui.ts` — zh-HK and en dictionaries and `t()`; user-visible text belongs here.
- `src/styles/` — CSS layers imported by `global.css`.
- `src/scripts/` — bundled client modules (`admin-cms.ts`).
- `public/scripts/` — runtime scripts served verbatim (`home-dashboard.js`, `visit-beacon.js`,
  `turnstile-client.js`, `markdown-enhance.js`, `lore-tooltip.js`).
- `public/icons/` — favicons, manifest icons and vendored Fluent UI SVGs (`public/icons/fluent/`).
- `migrations/`, `tests/`, `scripts/`, `docs/` — schema, tests, tooling and documentation.
