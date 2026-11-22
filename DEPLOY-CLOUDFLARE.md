# Deploying to Cloudflare: step by step

## 1. Preparation

You need: Node.js 22+, a Cloudflare account, and this directory.

```powershell
npm install
npx wrangler login
```

Once the browser has finished authorising Cloudflare, confirm:

```powershell
npx wrangler whoami
```

## 2. Create the D1 database

```powershell
npx wrangler d1 create personal-site
```

The command returns a `database_id`. Put it into `wrangler.jsonc`:

```json
"database_id": "<YOUR_D1_DATABASE_ID>"
```

## 3. Apply the migrations

The production Cloudflare D1:

```powershell
npx wrangler d1 migrations apply personal-site --remote
```

Check the migration status:

```powershell
npx wrangler d1 migrations list personal-site --remote
```

## 4. Configure Steam

Get an API key from the Steam Web API, then store it with a Wrangler secret. Do not write the key into Git.

```powershell
npx wrangler secret put STEAM_API_KEY
npx wrangler secret put STEAM_ID
```

`STEAM_ID` here is your 64-bit SteamID, for example `7656119...`.

## 5. Set the secrets for visitor statistics and Discord Presence

```powershell
npx wrangler secret put VISITOR_SALT
npx wrangler secret put DISCORD_USER_ID
```

`VISITOR_SALT` is used to hash the Cloudflare client IP with SHA-256 before it is stored in D1; the site never keeps the IP itself.

`VISITOR_COOKIE_SECRET` signs the first-party verification cookie; use a random string that differs from the other secrets. If it is not set, the code falls back to `TURNSTILE_SECRET`.

`DISCORD_USER_ID` is the Discord user ID that Lanyard watches; `/api/activity` uses it to proxy Discord Presence live.

The admin CMS requires `ADMIN_SESSION_SECRET`, `GITHUB_TOKEN`, and (when publishing notifications are enabled) `DISCORD_BLOG_WEBHOOK_URL` as Worker secrets. `ADMIN_PASSWORD` is an optional fallback while Passkey is the preferred account login. The mandatory Cloudflare Access + Worker-side JWT check requires `ACCESS_TEAM_DOMAIN` and either one shared `ACCESS_AUD` or route-specific `ACCESS_ADMIN_AUD` + `ACCESS_API_AUD` vars. Passkey setup requires applying migration `0006_admin_passkeys.sql`. See `ADMIN-CMS-SETUP.md` and `docs/ADMIN-AUTH-ARCHITECTURE.md`.

## 5b. Turnstile (bot protection)

`POST /api/visitors` is protected by Cloudflare Turnstile. The widget already exists (sitekey `0x4AAAAAAEubO6tRmWSwdMdT`), so only its secret key has to be stored:

```powershell
npx wrangler secret put TURNSTILE_SECRET
```

In Cloudflare Dashboard → Turnstile, confirm the widget lists `www.example.com` and `example.com`. Keep `localhost` and `127.0.0.1` in the local `.dev.vars` only — never in production.

`TURNSTILE_HOSTNAMES` in `wrangler.jsonc` is the server-side allow-list and must match those production hostnames exactly: an empty list fails closed rather than allowing everything through. Until `TURNSTILE_SECRET` is set, visitor analytics keep working unprotected and log a warning.

## 6. Check the build locally first

```powershell
npm run check
npm run lint
npm test
npm run build
```

Once that succeeds you can:

```powershell
npm run preview
```

## 7. First deployment

```powershell
npx wrangler deploy
```

Cloudflare prints the Worker URL, usually:

`https://fluentfolio.<your-subdomain>.workers.dev`

## 8. Verify the APIs

Replace `<DOMAIN>` with the real address:

```powershell
curl https://<DOMAIN>/api/health
curl https://<DOMAIN>/api/activity
curl https://<DOMAIN>/api/visitors
curl https://<DOMAIN>/api/steam
```

`/api/health` should return `status: ok`. If the Steam secrets are not configured it returns `configured: false`, which is expected.

## 9. Discord Presence (live proxy)

The Discord activity panel on the homepage gets its data through `/api/activity` (a Worker proxy for Lanyard's live Presence) and offers a browser WebSocket fallback. Just make sure the `DISCORD_USER_ID` secret is set and that Lanyard watches that account; there is nothing to update by hand. `POST /api/activity` is disabled (it returns 405).

## 10. Bind your own domain

Cloudflare Dashboard → Workers & Pages → your Worker → Settings / Domains & Routes → Add Custom Domain.

If the domain's DNS already lives on Cloudflare, add your domain there as the interface suggests. Test again after deploying:

```powershell
curl https://<DOMAIN>/api/health
```

## 11. Automatic deployment from GitHub (using Cloudflare Workers Builds)

Production deployments are driven by Cloudflare Workers Builds: on every push to the GitHub `main` branch, Cloudflare runs the build command `npm run build` and the deploy command `npx wrangler deploy`.

Do **not** put `npx wrangler deploy` into GitHub Actions again — the two deployment systems will fight each other. See `CLOUDFLARE-GITHUB-CICD.md` for details.

## 12. Day-to-day updates

Change the code → check locally:

```powershell
npm run build
```

Deploy to production:

```powershell
npx wrangler deploy
```

Pushing to `main` deploys automatically through Cloudflare Workers Builds, so this manual step is only needed for a deploy that deliberately bypasses that pipeline.

When D1 has a new migration:

```powershell
npx wrangler d1 migrations apply personal-site --remote
```

## 12b. Status-check history and external uptime monitoring (recommended)

Every time `/api/status` actually runs a probe it writes at most one `status_checks` row every 5 minutes (migration `0009_status_checks.sql`, no Cron Trigger), and `/status` shows the checks from the past 24 hours. The response itself is cached at the Cloudflare edge for 30 seconds; but the cached content holds only the shared probe results — `system.edge` (city, region, ISP, ...) is each visitor's own `request.cf` data, rebuilt per request _after_ the cache is read and **never** written into the cache, so other visitors in the same Cloudflare colo never see the first visitor's location. Apply the new migration to production D1 first, then deploy:

```powershell
npx wrangler d1 migrations apply personal-site --remote
```

Self-probing (the Worker running the probe itself) can only see "the site still answers requests" and the state of the external services; it **cannot detect that the whole Worker or the Cloudflare account is down**. In production, add a separate external uptime monitoring service (an independent provider outside Cloudflare, e.g. UptimeRobot, Better Stack) checking the following URLs every 1–5 minutes:

- `https://www.example.com/` (homepage HTML)
- `https://www.example.com/api/status` (HTTP 200 and JSON `ok: true`)

The external monitor should only issue passive GETs, without any cookie or admin credentials; `/api/status` is already cached for 30 seconds, making it a low-load endpoint. The monitoring service itself must live outside Cloudflare, otherwise a single-platform outage silences both sides at once.

### Verifying the edge cache after deploying

The copy that `src/lib/cached-json.ts` writes into `caches.default` uses `Cache-Control: public, max-age=<TTL>` (Workers Cache takes its lifetime from `Cache-Control`; storing it as `max-age=0` may be treated as immediately expired, so the cache never hits and never reports an error). When the response goes back to the browser: endpoints without per-request fields (`/api/activity`) get `public, max-age=0, s-maxage=<TTL>`; `/api/status` and `/api/visitors`, which have a `decorate` step and carry visitor location / cookie-derived fields, are marked `private, max-age=0` so other shared caches do not store personalised data (the Worker's own copy is still `public, max-age=<TTL>`). The response also carries `x-cache: HIT|MISS` for diagnostics (no personal data). After deploying, request the same endpoint repeatedly from the same Cloudflare colo:

```powershell
curl.exe -s -D - -o NUL https://www.example.com/api/status | Select-String 'x-cache|cache-control'
# Run it again within 30 seconds: the second response should show x-cache: HIT; a first request in another colo is still MISS
```

```cmd
curl.exe -s -D - -o NUL https://www.example.com/api/status | findstr /i "x-cache cache-control"
```

These checks only work on a custom domain (`www.example.com`): the Cache API does not work on `workers.dev` (`caches.default` is a no-op), so you will always see `MISS`. Before merging, also confirm that no Cloudflare Cache Rule sets "Cache everything" for `/api/*`, or that rule overrides the Worker's `Cache-Control` (including the `private` marker).

If the second request stays `MISS` for a long time, first check whether `Cache-Control`, `Set-Cookie` or a failed `Cache.put` is responsible (Worker logs carry a `[cached-json]` warning). Once it is stable you may keep or remove the `x-cache` header.

## 13. Publishing blog posts with Markdown

The blog already uses Astro Content Collections, so `src/lib/data.ts` no longer has to be edited.

To add a post:

```text
src/content/posts/blog/my-new-post.md
```

The minimum is:

```yaml
---
title: 'Post title'
description: 'Post summary'
date: 2026-09-05
category: 'Development'
tags:
  - Astro
author: 'Your Name'
draft: false
---
```

Write the body in plain Markdown:

```markdown
## Subheading

The article body goes here.

- First point
- Second point
```

The file name becomes the post slug:

```text
src/content/posts/blog/my-new-post.md
↓
https://<DOMAIN>/posts/blog/my-new-post
```

After changing or adding a post, build and deploy again:

```powershell
npm run build
npx wrangler deploy
```

### Drafts

For a post you do not want public yet:

```yaml
draft: true
```

`draft: true` keeps the post out of the blog list and produces no public article route.

### Updated date

When revising an old post you can add:

```yaml
updatedDate: 2026-09-06
```

### Recommended post structure

Long articles can use headings, lists, blockquotes, code blocks and images directly. Images can live in `public/` and be referenced from Markdown with:

```markdown
![description](/images/example.png)
```

Astro Content Collections validate the frontmatter, and the blog page sorts by `date` from newest to oldest.

## 14. Security headers: CSP Report-Only, HSTS and the observation period

### CSP Report-Only (#14)

HTML responses from the Worker carry an extra `Content-Security-Policy-Report-Only` header (`src/middleware.ts` + `src/lib/csp-core.ts`):

- This is an **observation** policy; it blocks nothing. The project has no `report-to` collector, so violations only appear in the browser DevTools Console and are never sent to the server.
- **No nonce**: every executable inline script has moved into `public/scripts/*.js` and is loaded as a same-origin file, so `script-src` is just `'self' https://challenges.cloudflare.com` (Turnstile). `type="application/json"` / `application/ld+json` data blocks are not executable scripts and are not governed by `script-src`.
- The already-enforced `frame-ancestors 'self'; object-src 'none'; base-uri 'self'` header **stays unchanged**; the Report-Only policy neither replaces nor tightens it.
- Do not turn Report-Only into an enforcing policy on your own. Observe it for at least one deployment cycle, confirm there are no unexpected violations, then handle the change separately.
- Astro 7's built-in `security.csp` is deliberately **not enabled**: it only emits an enforcing `<meta http-equiv="content-security-policy">` (no Report-Only mode), and a meta CSP ignores `frame-ancestors` and the reporting directives, which is the opposite of this phase's "observe first, do not enforce" requirement.

**Known limitations (important)**:

- Pages with `export const prerender = true` (homepage, `/privacy`, `/terms`, `/404`, and every article / chapter / wiki detail page) are returned directly by the ASSETS binding before `app.render`, so `src/middleware.ts` never runs and **they carry no Report-Only header**. This no longer leaves a `script-src` gap (those pages only load same-origin `/scripts/*.js`), but enforcing the policy would require shipping the full policy to those pages separately.
- `public/_headers` applies only to responses for static assets / prerendered HTML, and can carry a static (nonce-free) `Content-Security-Policy`. Because the policy no longer contains a nonce, enforcing it later means adding one line with the full policy to the `/*` block; that also applies to sub-resource responses such as CSS/JS, so confirm there are no side effects before implementing it.
- Swup replaces only `<main>`; the original inline scripts have all become external files. Inside `<main>`, `/scripts/toc.js`, `/scripts/reading-progress.js`, `/scripts/home-bootstrap.js` and `/scripts/status-panel.js` are re-executed on navigation by `reloadScripts: true`; outside `<main>`, `site-shell.js`, `theme-init.js`, `visit-beacon.js`, `lore-tooltip.js` and `markdown-enhance.js` load only once, each avoiding duplicate binding with `data-swup-ignore-script` or a global guard.
- So the next step is: observe Report-Only for at least one deployment cycle, confirm there are no unexpected violations, then open a separate change that turns the policy into an enforcing one (`Content-Security-Policy`) and adds the static policy for prerendered pages at the same time. Do not simply rename the existing Report-Only header.

### HSTS (configure in the Cloudflare Dashboard, not in code)

1. Cloudflare Dashboard → your zone → SSL/TLS → Edge Certificates.
2. Turn on **HTTP Strict Transport Security (HSTS)**.
3. Recommended values: start Max-Age at 6 months (`15552000` seconds) or longer; decide `Include subdomains` from your actual subdomains; leave `Preload` unchecked for now and only consider it once you are sure there are no mixed-content problems.
4. HSTS is returned by the edge, so the Worker should not set `Strict-Transport-Security` — this code deliberately does not, because duplicates or a wrong value only make debugging harder.

### Observation-period checklist

- [ ] Watch `Content-Security-Policy-Report-Only` violations in the browser DevTools Console for at least one deployment cycle.
- [ ] Confirm there are no unexpected `script-src` / `connect-src` / `img-src` violations (Turnstile, the Lanyard WebSocket, Discord / Steam / Ko-fi / Liberapay icons, R2 images).
- [ ] Confirm that prerendered pages really have no such header (that matches the limitation above and is not a deployment error), and that all of their `<script>` tags have a `src`.
- [ ] HSTS is enabled in the Cloudflare Dashboard and the date recorded; no HSTS header exists in the code.
- [ ] Once the observation period ends, open a separate change that enforces the policy and adds the static policy for prerendered pages; do not touch this policy during the observation period.

## 15. Static asset routing and Range requests (Safari background video)

`assets.run_worker_first` in `wrangler.jsonc` is a **routing table**, not "extra rules":

```jsonc
"run_worker_first": [
  "/*",
  "!/_astro/*",
  "!/background.mp4",
  "!/background.webm",
  "!/easter.mp3"
]
```

- `/*` routes every document page and API (including SSR pages such as `/posts`, `/about`, `/status`) through the Worker first, as before. Do **not** remove this line or shrink it to just `/admin*` + `/api/*`: that is exactly what PR #9 did, handing SSR pages to the asset layer and ending up with static 404s.
- Entries starting with `!` hand the matching static files back to the asset layer (negative rules win over `/*`). Only the build output `/_astro/*` and the three large media files are excluded today. Before adding an exclusion, confirm that prefix can never be an SSR route, or the asset layer will shadow that page.
- Why exclude them: when the Worker serves an asset, the adapter's `matchStaticAsset` re-fetches the file from `ASSETS` with the bare URL and drops the client's `Range` and `If-None-Match`. A video range request therefore returns `200` plus the full 7 MB instead of the `206 Partial Content` Safari's `<video>` needs, and loses the `304`. Handed to the asset layer, `Range`, `ETag`, `Cache-Control` and `Content-Type` all come straight from that layer and from `public/_headers`.
- These excluded paths do **not** run `src/middleware.ts`, so the security headers are supplied by the `/*` rule in `public/_headers`; they are only build output and media files, with no HTML documents among them.

Verify manually after deploying (swap in the production domain):

```bash
curl -s -o /dev/null -D - -H "Range: bytes=0-1023" https://www.example.com/background.mp4
curl -s -o /dev/null -D - -H "Range: bytes=0-1023" https://www.example.com/background.webm
```

Expect `HTTP/2 206`, `content-range: bytes 0-1023/<size>` and `accept-ranges: bytes`. Also check `/`, `/posts`, `/about`, `/status`, `/api/health`, `/admin/login` and one nonexistent path (which should be 404) one by one; finally open the homepage in Safari and confirm the background video plays.

## 16. Invisible watermark (build time, evidence rather than protection)

When Markdown is converted to HTML, `src/lib/watermark-plugin.mjs` appends to each paragraph of the `novel`, `dictionary` and `world` collections, after the closing punctuation, a run of zero-width characters encoding the first 32 bits of HMAC-SHA256(secret, `collection/id`) (U+200B = 0, U+200C = 1). The signature for a chapter is fixed and can be recomputed and compared.

- **Secret**: the build environment variable `WATERMARK_SECRET`; set it in Cloudflare Workers Builds' build variables and never commit it. Any long random string works (e.g. `openssl rand -base64 32`).
- **When unset**: the build does not fail, it prints one line `[watermark] WATERMARK_SECRET is not set; skipping invisible watermarks.` and every page renders as usual. CI does not have this variable, so watermarks are skipped there automatically.
- It does not modify the stored Markdown / CMS content; it only affects that render. `search-index.json`, RSS, OG and the sitemap read the frontmatter only, so they are never polluted.
- At most one run per paragraph; content of 3 paragraphs or more is only marked after the closing punctuation (never inserted mid-word, which would break search and word segmentation). To guarantee at least one run for content with fewer than 3 paragraphs, the signature is appended after the last character of that paragraph even when it has no terminal punctuation. `markdown-sanitize` is the last hast plugin and filters only tags and attributes, not text nodes, so the zero-width characters survive.
- **Decoding**: `WATERMARK_SECRET=... node scripts/decode-watermark.mjs < suspicious.txt` (or pipe the text in). It scans the ids in `src/content/{novel,dictionary,world}`, recomputes the signatures and lists the matching `collection/id`; when nothing matches it prints the script's own `未找到浮水印：輸入文字中沒有零寬字元簽章。` message.
- **Honest limitation**: zero-width characters are easy to strip by hand or with a tool, and a few editors / screen readers may display or read them aloud. They provide only _possible_ evidence of origin and must be combined with other evidence such as Git commit times and publication records; they cannot prove plagiarism on their own.
