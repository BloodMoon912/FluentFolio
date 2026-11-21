<div align="center">

<h1>FluentFolio</h1>

**A Fluent-style personal website template: blog, serialized fiction, dictionary, worldbuilding, live presence and site status, all in one.**

![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.23.4-5FA04E?logo=nodedotjs&logoColor=white)
![Astro](https://img.shields.io/badge/Astro-7-BC52EE?logo=astro&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

[繁體中文](README.md) | **English**

</div>

- 🌓 **Fluent look and feel**: dark/light themes, glass topbar and page transitions, following the [Fluent motion guidelines](docs/Fluent_UI_Design_Motion_Guidelines_for_Astro.md)
- ⚡ **All on Cloudflare**: Astro SSR on Workers, D1 for data, R2 for images, no server to maintain
- ✍️ **Built-in admin**: Passkey plus Cloudflare Access, live Markdown preview and linting, publishing commits straight to GitHub
- 🌏 **Chinese first**: Traditional Chinese and English UI, search with pinyin and jyutping

> [!TIP]
> FluentFolio is a real, running personal site with all personal content removed. After forking, do these four things:
>
> 1. Edit [`src/lib/data.ts`](src/lib/data.ts): name, handles, social links, About-page setup and games.
> 2. Edit [`src/i18n/ui.ts`](src/i18n/ui.ts): titles and copy, plus the privacy policy and terms.
> 3. Replace the logo, icons, background and sound in `public/` and `src/assets/` (they are generated neutral placeholders).
> 4. Delete the sample posts in `src/content/` and write your own.

## ✨ Features

### Content

- [x] **Four collections** - essays (`blog`), serialized fiction (`novel`), `dictionary` and `world`, all Markdown
- [x] **Reading experience** - table of contents, progress, prev/next chapter, reading time, and `[[term]]` hover glossary
- [x] **Site search** - Fuse.js with pinyin and jyutping, `/` to open
- [x] **Feeds and SEO** - separate RSS for blog and novel, sitemap, robots.txt, Open Graph images, JSON-LD
- [x] **Drafts** - `draft: true` entries never appear on the site, in RSS or in search
- [x] **Content protection (optional)** - copy protection, watermark and crawler tiers, per entry via `copyProtect` and `crawl`

### Presence and operations

- [x] **Live presence** - Discord status via Lanyard, plus the Steam game being played
- [x] **Status page** - health probes for site, database and presence sources, with history
- [x] **Visitor stats** - D1, hashed IPs, Cloudflare Turnstile against abuse
- [x] **Security headers** - CSP and common headers from middleware

### Admin CMS

- [x] **Login protection** - Cloudflare Access plus Passkey, password as fallback only
- [x] **Editor** - split preview, Markdown lint, image upload to R2, drafts in D1
- [x] **Direct publishing** - commits through the GitHub API, Workers Builds redeploys
- [x] **Publish notifications** - optional Discord webhook

### Quality

- [x] **Types and tests** - strict TypeScript, 300+ unit tests
- [x] **CI** - GitHub Actions only validates; Cloudflare Workers Builds deploys
- [x] **Content validation** - `npm run validate:md` checks frontmatter, images, internal links and cross-references

Pull requests are welcome.

## 🚀 Getting Started

### Requirements

- Node.js **22.23.4** (see `.nvmrc`; Astro 7.4.2 rejects older 22.x and does not support Node 24)
- npm
- A [Cloudflare](https://dash.cloudflare.com) account for deployment (free plan is enough to start)

### Local development

1. Click **Use this template** or fork the repo, then clone it.

   ```bash
   git clone https://github.com/your-name/fluentfolio.git
   cd fluentfolio
   ```

2. Switch Node and install dependencies.

   ```bash
   nvm use 22.23.4
   npm ci
   ```

3. Create the local config. Anything left empty degrades gracefully: the matching panel shows "not configured" instead of breaking the site.

   ```bash
   cp .env.example .dev.vars
   ```

4. Initialise the local D1 database and start.

   ```bash
   npx wrangler d1 migrations apply personal-site --local
   npm run dev
   ```

   Open <http://localhost:4321>.

> [!NOTE]
> Local secrets and variables go in `.dev.vars` (git-ignored). Do not put them in `.env` and never commit them.

### Deploy to Cloudflare

Step by step: [DEPLOY-CLOUDFLARE.md](DEPLOY-CLOUDFLARE.md). Repo and Workers Builds wiring: [CLOUDFLARE-GITHUB-CICD.md](CLOUDFLARE-GITHUB-CICD.md). In short:

1. Create resources: D1 (`npx wrangler d1 create personal-site`), KV (`npx wrangler kv namespace create SESSION`), R2 (`npx wrangler r2 bucket create blog-images`).
2. Replace every `<YOUR_…>` placeholder and `example.com` in `wrangler.jsonc` with your own values.
3. Apply migrations: `npx wrangler d1 migrations apply personal-site --remote`.
4. Set secrets with `npx wrangler secret put` (see the table below).
5. Connect the repo to Workers Builds in Cloudflare: build command `npm run build`, deploy command `npx wrangler deploy`. Pushes to `main` then deploy automatically.

> [!IMPORTANT]
> `.github/workflows/ci.yml` only validates. Do not add a deploy step, or it will fight with Workers Builds.

### Environment variables

All optional; a missing value disables the matching feature. See [`.env.example`](.env.example) for the full list.

| Variable                                        | Purpose                                     |
| ----------------------------------------------- | ------------------------------------------- |
| `DISCORD_USER_ID`                               | Account shown in the homepage Discord panel |
| `STEAM_API_KEY`, `STEAM_ID`                     | Steam now-playing and profile               |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`              | Cloudflare Access (protects `/admin`)       |
| `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`        | Admin login and session                     |
| `ADMIN_WEBAUTHN_RP_ID`, `ADMIN_WEBAUTHN_ORIGIN` | Passkey domain settings                     |
| `GITHUB_TOKEN`, `GITHUB_REPO`, `GITHUB_BRANCH`  | Where the admin commits published posts     |
| `R2_PUBLIC_BASE_URL`                            | Public URL for admin image uploads          |
| `TURNSTILE_SECRET`, `TURNSTILE_HOSTNAMES`       | Human verification for visitor stats        |
| `VISITOR_SALT`, `VISITOR_COOKIE_SECRET`         | Visitor identity hashing                    |
| `WATERMARK_SECRET`                              | Article watermark                           |
| `DISCORD_BLOG_WEBHOOK_URL`                      | Discord notification on new posts           |

## 📖 Configuration

### What to edit where

| To change                                | Edit                                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| Name, handles, tagline, social links     | [`src/lib/data.ts`](src/lib/data.ts)                                         |
| About-page setup and games               | `aboutSetup`, `aboutGames` in [`src/lib/data.ts`](src/lib/data.ts)           |
| Donation buttons (Ko-fi, Liberapay, ...) | `supportLinks` in [`src/lib/data.ts`](src/lib/data.ts), empty by default     |
| All UI text, privacy policy, terms       | [`src/i18n/ui.ts`](src/i18n/ui.ts) (`zh` and `en` copies)                    |
| Domains, resource IDs, Access settings   | [`wrangler.jsonc`](wrangler.jsonc)                                           |
| Colors, radius, shadows                  | [`src/styles/tokens.css`](src/styles/tokens.css)                             |
| Logo, favicon, PWA icons                 | `public/logo.svg`, `public/favicon.svg`, `public/icons/`                     |
| Background image and video               | `src/assets/background.webp`, `public/background.mp4`, `.webm`               |
| Easter-egg sound                         | `public/easter.mp3`                                                          |
| Nav items                                | `navItems` in [`src/layouts/BaseLayout.astro`](src/layouts/BaseLayout.astro) |

### Directory structure

```text
├── src/
│   ├── content/          # Your writing: blog, novel, dictionary, world
│   ├── content.config.ts # Frontmatter schema per collection (single source of truth)
│   ├── i18n/ui.ts        # UI strings and legal text, zh and en
│   ├── lib/              # data.ts (site config), search, SEO, CMS logic
│   ├── layouts/          # BaseLayout: topbar, nav, footer, global scripts
│   ├── components/       # Search, TOC, icons
│   ├── pages/            # Routes; api/ are Worker endpoints, admin/ is the CMS
│   └── styles/           # tokens.css and per-area styles
├── public/               # Static assets and browser scripts (public/scripts)
├── migrations/           # D1 migrations
├── scripts/              # Content validation, content fetching, OG checks
├── tests/                # Unit tests and fixtures
├── docs/                 # Architecture, CMS, crawler policy
└── wrangler.jsonc        # Cloudflare Workers config
```

### Timezone and language

- The UI ships in Traditional Chinese and English; all strings are in `src/i18n/ui.ts`. Adding a language also needs changes in `src/lib/i18n.ts` and `public/scripts/site-shell.js`.
- All times are shown in **Hong Kong Time (UTC+8)**, implemented in [`src/lib/time.ts`](src/lib/time.ts); background in [HKO-TIME.md](HKO-TIME.md). Edit that file for another timezone.

> [!WARNING]
> The bundled privacy policy and terms are sample texts written under **Hong Kong** law and contain `contact@example.com`. Replace them before going live and review them against your own jurisdiction.
>
> The footer license defaults to CC BY-NC-ND 4.0. Change it to taste (`license_prefix`, `license_suffix` and `BaseLayout.astro`).

## ⚙️ Post Frontmatter

Posts live in `src/content/<collection>/`, and **the file name is the URL**: `src/content/blog/hello-world.md` becomes `/posts/blog/hello-world`. Use lowercase English and hyphens.

Essay (`blog`):

```yaml
---
title: Post title # required
date: 2026-11-01 # required
description: One-line summary # required, used in lists, RSS and SEO
type: essay # optional, default essay
category: Announcements # optional, default General
tags: [FluentFolio, Intro] # optional
author: Your Name # optional
updatedDate: 2026-11-10 # optional
featured: false # optional, pin as recommended
draft: false # optional, true keeps it private
copyProtect: true # optional, override copy protection for this post
---
```

Serialized fiction (`novel`):

```yaml
---
title: Chapter 1 # required
chapter: 1 # required, positive integer
date: 2026-11-04 # required
volume: Volume 1 # optional
order: 1 # optional, reading order
relatedLore: [luma] # optional, related dictionary entry ids
---
```

Dictionary (`dictionary`) and world (`world`):

```yaml
---
word: luma # required for dictionary; world uses title
partOfSpeech: noun # required for dictionary
definition: Light; brightness. # required for dictionary; world uses description
ipa: /ˈlu.ma/ # optional
relatedWords: [sora] # optional, ids of other entries (world uses relatedEntries)
---
```

[`src/content.config.ts`](src/content.config.ts) is authoritative. After writing, run `npm run validate:md` to check fields, images, internal links and references.

## 🧩 Markdown Extensions

- **Dictionary links**: write `[[luma]]` in the body; if `dictionary` has `luma.md` it becomes a link with a hover definition, otherwise it falls back to plain emphasis.
- **Copy protection and watermark** (optional): see [docs/COPY-PROTECTION.md](docs/COPY-PROTECTION.md).
- **Crawler tiers** (optional): see [docs/CRAWLER-POLICY.md](docs/CRAWLER-POLICY.md).

## 🔒 Optional: Keep Content in a Private Repo

By default posts and code share one repository. If you want public code (or outside collaborators) while unpublished writing stays private, use private content mode: at build time `scripts/fetch-content.mjs` fetches the content with a read-only token, the admin commits to the content repo, and a deploy hook rebuilds the site on updates. Full steps and a content-repo template: [docs/PRIVATE-CONTENT-REPO.md](docs/PRIVATE-CONTENT-REPO.md).

## 🧞 Commands

| Command                                   | Action                                                  |
| ----------------------------------------- | ------------------------------------------------------- |
| `npm run dev`                             | Start the local dev server                              |
| `npm run build`                           | Production build (runs `fetch:content` first)           |
| `npm run preview`                         | Preview the build locally                               |
| `npm run check`                           | `astro check`: types and diagnostics                    |
| `npm run check:public`                    | Type-check browser scripts in `public/scripts`          |
| `npm run check:inline-scripts`            | Ensure the build has no executable inline scripts (CSP) |
| `npm run lint`                            | Lint this repo's Markdown docs                          |
| `npm run validate:md`                     | Validate post frontmatter, images, links, references    |
| `npm test`                                | Unit tests                                              |
| `npm run format` / `npm run format:check` | Format / check with Prettier                            |
| `npm run deploy`                          | Build and `wrangler deploy` (manual deploys)            |
| `npm run fetch:content`                   | Private content mode: fetch the content repo            |

## 📚 Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): system map
- [AGENTS.md](AGENTS.md): conventions and known pitfalls
- [ADMIN-CMS-SETUP.md](ADMIN-CMS-SETUP.md): admin CMS setup
- [docs/ADMIN-AUTH-ARCHITECTURE.md](docs/ADMIN-AUTH-ARCHITECTURE.md): admin auth design
- [docs/CMS-CONTENT-EDITOR.md](docs/CMS-CONTENT-EDITOR.md): editor features
- [docs/CMS-HTTP-CONTRACT.md](docs/CMS-HTTP-CONTRACT.md): admin API contract

## 🙏 Acknowledgements

- [Astro](https://astro.build) and [Cloudflare Workers](https://workers.cloudflare.com)
- [Fluent UI System Icons](https://github.com/microsoft/fluentui-system-icons) (MIT, bundled in `public/icons/fluent/`) and the Microsoft Fluent design language
- [Noto Sans TC](https://fonts.google.com/noto/specimen/Noto+Sans+TC) (SIL Open Font License 1.1, used for OG images)
- [swup](https://swup.js.org), [Fuse.js](https://www.fusejs.io), [pinyin-pro](https://github.com/zh-lx/pinyin-pro), [to-jyutping](https://github.com/CanCLID/to-jyutping), [SimpleWebAuthn](https://simplewebauthn.dev), [DOMPurify](https://github.com/cure53/DOMPurify), [marked](https://marked.js.org), [Lanyard](https://github.com/Phineas/lanyard)
- The README structure is modelled on [Firefly](https://github.com/CuteLeaf/Firefly)

## 📝 License

Code is released under the [MIT License](LICENSE). Copyright and licensing of the sample posts and of your own writing are yours to decide.
