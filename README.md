<div align="center">

<h1>FluentFolio</h1>

**A Fluent-style personal website template: blog, serialized fiction, dictionary, worldbuilding, live presence and site status, all in one.**

![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.23.4-5FA04E?logo=nodedotjs&logoColor=white)
![Astro](https://img.shields.io/badge/Astro-7-BC52EE?logo=astro&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

</div>

- 🌓 **Fluent look and feel**: dark/light themes, a glass topbar and page transitions, following the [Fluent motion and design guidelines](docs/Fluent_UI_Design_Motion_Guidelines_for_Astro.md)
- ⚡ **All on Cloudflare**: Astro SSR runs on Workers, data lives in D1, images in R2 — no server of your own to maintain
- ✍️ **Built-in admin**: Passkey plus Cloudflare Access, live Markdown preview and linting, publishing commits straight to GitHub
- 🌏 **Chinese first**: one-click switch between the Traditional Chinese and English UI, search with pinyin and jyutping

> [!TIP]
> FluentFolio is a template distilled from a real, running personal site with the personal content stripped out. It is a **theme**, not a starting point to fork and rewrite: your own material lives in a separate layer, and upgrading means merging the theme.
>
> 1. Edit [`site.config.json`](site.config.json): title, URL, author, navigation, feeds, licence, social links, and the About page's setup and games.
> 2. Put the logo, favicon, icons, background video and audio into `public/brand/` (they are neutral placeholders today).
> 3. Keep posts together with that personal configuration and brand media in a **separate private repository**, and overlay them at build time with `npm run fetch:content`.
> 4. Only touch [`src/i18n/ui.json`](src/i18n/ui.json) when you need to change the copy.
>
> The full three-layer model and the merge steps are in [`docs/UPGRADING.md`](docs/UPGRADING.md).

## ✨ Features

### Content

- [x] **Four collections** - essays (`blog`), serialized fiction (`novel`), `dictionary` and `world`, all Markdown
- [x] **Reading experience** - table of contents with numbered sections, reading progress, previous/next chapter, reading time, click-to-zoom image lightbox, and `[[term]]` hover glossary
- [x] **Site search** - Fuse.js full-site search with pinyin and jyutping, opened with the `/` shortcut
- [x] **Feeds and SEO** - separate RSS and Atom feeds for blog and novel, sitemap, robots.txt, Open Graph images, JSON-LD
- [x] **Drafts** - entries with `draft: true` never appear on the site, in the feeds or in search
- [x] **Content protection (optional)** - copy protection, watermark and crawler tiers, configured per entry through `copyProtect` and `crawl`

### Presence and operations

- [x] **Live presence** - Discord status through Lanyard, plus the Steam game currently being played
- [x] **Status page** - health probes for the site, the database and the presence sources, with history
- [x] **Visitor statistics** - D1, with IPs hashed before use and Cloudflare Turnstile against abuse
- [x] **Security headers** - CSP and the common security headers emitted by middleware

### Admin CMS

- [x] **Login protection** - Cloudflare Access plus Passkey, with the password as a fallback only
- [x] **Editor** - split-pane preview, Markdown linting, image upload to R2, drafts stored in D1
- [x] **Direct publishing** - commits through the GitHub API, Workers Builds redeploys automatically
- [x] **Publish notifications** - optional Discord webhook

### Development quality

- [x] **Types and tests** - strict TypeScript checking, 300+ unit tests
- [x] **CI** - GitHub Actions only validates; Cloudflare Workers Builds deploys
- [x] **Content validation** - `npm run validate:md` checks frontmatter, images, internal links and the references between entries

Ideas are welcome as pull requests.

## 🚀 Getting Started

### Requirements

- Node.js **22.23.4** (see `.nvmrc`; Astro 7.4.2 rejects older 22.x and does not support Node 24)
- npm
- A [Cloudflare](https://dash.cloudflare.com) account for deployment (the free plan is enough to start)

### Local development

1. Click **Use this template** in the top right or fork the repository, then clone it.

   ```bash
   git clone https://github.com/your-name/fluentfolio.git
   cd fluentfolio
   ```

2. Switch to the right Node version and install dependencies.

   ```bash
   nvm use 22.23.4
   npm ci
   ```

3. Create the local configuration file. Anything left empty degrades gracefully: the matching panel shows "not configured" instead of breaking the site.

   ```bash
   cp .env.example .dev.vars
   ```

4. Initialise the local D1 database, then start.

   ```bash
   npx wrangler d1 migrations apply personal-site --local
   npm run dev
   ```

   Open <http://localhost:4321>.

> [!NOTE]
> Local secrets and variables go in `.dev.vars` (git-ignored). Do not put them in `.env`, and never commit them.

### Deploy to Cloudflare

The step-by-step guide is in [DEPLOY-CLOUDFLARE.md](DEPLOY-CLOUDFLARE.md), and the repository / Workers Builds wiring is in [CLOUDFLARE-GITHUB-CICD.md](CLOUDFLARE-GITHUB-CICD.md). Roughly:

1. Create the resources: D1 (`npx wrangler d1 create personal-site`), KV (`npx wrangler kv namespace create SESSION`) and R2 (`npx wrangler r2 bucket create blog-images`).
2. Replace every `<YOUR_…>` placeholder and every `example.com` in `wrangler.jsonc` with your own values.
3. Apply the database migrations: `npx wrangler d1 migrations apply personal-site --remote`.
4. Set the secrets with `npx wrangler secret put` (see the environment variable table below).
5. In Cloudflare, connect the repository to Workers Builds: build command `npm run build`, deploy command `npx wrangler deploy`. From then on, a push to `main` deploys automatically.

> [!IMPORTANT]
> `.github/workflows/ci.yml` only validates. Do not add a deploy step, or it will fight with Workers Builds.

### Environment variables

All of them are optional; when a value is missing, the matching feature is disabled. See [`.env.example`](.env.example) for the full list and explanations.

| Variable                                        | Purpose                                           |
| ----------------------------------------------- | ------------------------------------------------- |
| `DISCORD_USER_ID`                               | Which account the homepage Discord panel shows    |
| `STEAM_API_KEY`, `STEAM_ID`                     | Steam now-playing and profile                     |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`              | Cloudflare Access (protects `/admin`)             |
| `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`        | Admin login and session                           |
| `ADMIN_WEBAUTHN_RP_ID`, `ADMIN_WEBAUTHN_ORIGIN` | Passkey domain settings                           |
| `GITHUB_TOKEN`, `GITHUB_REPO`, `GITHUB_BRANCH`  | Where the admin commits posts when publishing     |
| `R2_PUBLIC_BASE_URL`                            | Public URL for images uploaded from the admin     |
| `TURNSTILE_SECRET`, `TURNSTILE_HOSTNAMES`       | Human verification for visitor statistics         |
| `VISITOR_SALT`, `VISITOR_COOKIE_SECRET`         | Visitor identity hashing                          |
| `WATERMARK_SECRET`                              | Article watermark                                 |
| `DISCORD_BLOG_WEBHOOK_URL`                      | Discord notification when a new post is published |

## 📖 Configuration

### What to edit where

| To change                                 | Where to edit                                                              |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| Site name, title suffix, navigation items | [`site.config.json`](site.config.json)                                     |
| Name, handles, tagline, social links      | [`site.config.json`](site.config.json)                                     |
| About page setup and games                | `about.setup`, `about.games` in [`site.config.json`](site.config.json)     |
| Donation buttons (Ko-fi, Liberapay, ...)  | `supportLinks` in [`site.config.json`](site.config.json), empty by default |
| All UI strings, privacy policy, terms     | [`src/i18n/ui.json`](src/i18n/ui.json) (the `zh` and `en` copies)          |
| Domain, resource IDs, Access settings     | [`wrangler.jsonc`](wrangler.jsonc)                                         |
| Colours, corner radii, shadows            | [`src/styles/tokens.css`](src/styles/tokens.css)                           |
| Logo, favicon, PWA icons                  | `public/brand/logo.svg`, `public/brand/favicon.svg`, `public/brand/icons/` |
| Background image and background video     | `src/assets/background.webp`, `public/brand/background.mp4`, `.webm`       |
| Easter egg sound                          | `public/brand/easter.mp3`                                                  |

Every site-specific value lives in one file, [`site.config.json`](site.config.json); [`src/site.config.ts`](src/site.config.ts) is its typed loader and [`src/lib/data.ts`](src/lib/data.ts) is a compatibility re-export. UI copy lives in [`src/i18n/ui.json`](src/i18n/ui.json), with [`src/i18n/ui.ts`](src/i18n/ui.ts) as the typed accessor.

To keep theme upgrades painless, read [`docs/UPGRADING.md`](docs/UPGRADING.md): the site configuration, the content and the theme are three separate layers, so only the site layer conflicts during an upgrade.

### Directory structure

```text
├── src/
│   ├── content/          # Your writing: blog, novel, dictionary, world
│   ├── content.config.ts # Frontmatter schema per collection (single source of truth)
│   ├── site.config.ts    # Typed loader for site.config.json
│   ├── i18n/             # ui.json (UI copy) and ui.ts (typed accessor)
│   ├── lib/              # Search, SEO, CMS, time and auth logic
│   ├── layouts/          # BaseLayout: topbar, nav, footer, global scripts
│   ├── components/       # Search, TOC, reading progress, icons
│   ├── pages/            # Routes; api/ are Worker endpoints, admin/ is the CMS
│   └── styles/           # tokens.css and per-area styles
├── public/               # Static assets and browser scripts (public/scripts)
├── migrations/           # D1 database migrations
├── scripts/              # Content validation, content fetching, OG checks
├── tests/                # Unit tests and fixtures
├── docs/                 # Architecture, CMS, crawler policy (English)
├── site.config.json      # Site identity, nav, feeds, licence, branding paths
└── wrangler.jsonc        # Cloudflare Workers configuration
```

### Timezone and language

- The UI ships in Traditional Chinese and English, and every string is in `src/i18n/ui.json` (read through `src/i18n/ui.ts`). Adding a language also requires changes in `src/lib/i18n.ts` and `public/scripts/site-shell.js`.
- All site times are displayed in **Hong Kong Time (UTC+8)**, implemented in [`src/lib/time.ts`](src/lib/time.ts); the background is explained in [docs/TIMEZONE.md](docs/TIMEZONE.md). Edit that file for another timezone.

> [!WARNING]
> The privacy policy and terms bundled with the template are sample texts written under **Hong Kong** law and contain `contact@example.com`. Replace them with your own content before going live, and review them against the regulations where you are.
>
> The default content licence in the footer is CC BY-NC-ND 4.0; change it to what you want (`license_prefix`, `license_suffix` and `BaseLayout.astro`).

## ⚙️ Post Frontmatter

All posts live under `src/content/<collection>/`, and **the file name is the URL**: `src/content/blog/hello-world.md` becomes `/posts/blog/hello-world`. Lowercase English with hyphens is recommended.

Essay (`blog`):

```yaml
---
title: Post title # required
date: 2026-11-01 # required
description: One-line summary # required, used in lists, RSS and SEO
type: essay # optional, defaults to essay
category: Announcements # optional, defaults to General
tags: [FluentFolio, Intro] # optional
author: Your Name # optional
updatedDate: 2026-11-10 # optional
featured: false # optional, pin as recommended
draft: false # optional, true keeps it private
copyProtect: true # optional, overrides copy protection for this post
---
```

Serialized fiction (`novel`):

```yaml
---
title: Chapter 1　The Beginning # required
chapter: 1 # required, positive integer
date: 2026-11-04 # required
volume: Volume 1 # optional, volume name
order: 1 # optional, decides the reading order
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

[`src/content.config.ts`](src/content.config.ts) is authoritative for every field. After writing, run `npm run validate:md` to check fields, images, internal links and references.

## 🧩 Markdown Extensions

- **Dictionary links**: write `[[luma]]` in the body; if `dictionary` contains `luma.md` it becomes a link with a hover definition, and when there is no match it degrades to plain emphasis.
- **Copy protection and watermark** (optional): see [docs/COPY-PROTECTION.md](docs/COPY-PROTECTION.md).
- **Crawler tiers** (optional): see [docs/CRAWLER-POLICY.md](docs/CRAWLER-POLICY.md).

## 🔒 Optional: Keep Content in a Private Repository

By default the posts and the code share one repository. If you want to publish the code or hand it to collaborators while unpublished writing stays private, switch to private content mode: at build time `scripts/fetch-content.mjs` fetches the content with a read-only token, the admin commits to the content repository, and content updates redeploy through a Deploy Hook. The content repository is also the site's private overlay — `site.config.json`, `i18n/ui.json` and `assets/brand/*` are copied over the theme defaults before the build. Full steps and the content repository template: [docs/PRIVATE-CONTENT-REPO.md](docs/PRIVATE-CONTENT-REPO.md).

## 🧞 Commands

| Command                                   | Action                                                  |
| ----------------------------------------- | ------------------------------------------------------- |
| `npm run dev`                             | Start the local development server                      |
| `npm run build`                           | Production build (runs `fetch:content` first)           |
| `npm run preview`                         | Preview the build result locally                        |
| `npm run check`                           | `astro check`: types and diagnostics                    |
| `npm run check:public`                    | Type-check the browser scripts in `public/scripts`      |
| `npm run check:inline-scripts`            | Ensure the build has no executable inline scripts (CSP) |
| `npm run lint`                            | Lint this repository's Markdown                         |
| `npm run validate:md`                     | Validate post frontmatter, images, links and references |
| `npm test`                                | Unit tests                                              |
| `npm run format` / `npm run format:check` | Format / check formatting with Prettier                 |
| `npm run deploy`                          | Build and run `wrangler deploy` (manual deploys)        |
| `npm run fetch:content`                   | Private content mode: fetch the content repository      |

## 📚 Docs

All documentation under `docs/` is written in English.

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): system map
- [AGENTS.md](AGENTS.md): content and UI conventions, known pitfalls
- [ADMIN-CMS-SETUP.md](ADMIN-CMS-SETUP.md): admin CMS setup
- [docs/ADMIN-AUTH-ARCHITECTURE.md](docs/ADMIN-AUTH-ARCHITECTURE.md): admin login architecture
- [docs/CMS-CONTENT-EDITOR.md](docs/CMS-CONTENT-EDITOR.md): editor features
- [docs/CMS-HTTP-CONTRACT.md](docs/CMS-HTTP-CONTRACT.md): admin API contract

## 🙏 Acknowledgements

- [Astro](https://astro.build) and [Cloudflare Workers](https://workers.cloudflare.com)
- [Fluent UI System Icons](https://github.com/microsoft/fluentui-system-icons) (MIT, bundled in `public/icons/fluent/`) and the Microsoft Fluent design language
- [Noto Sans TC](https://fonts.google.com/noto/specimen/Noto+Sans+TC) (SIL Open Font License 1.1, used for OG images)
- [swup](https://swup.js.org), [Fuse.js](https://www.fusejs.io), [pinyin-pro](https://github.com/zh-lx/pinyin-pro), [to-jyutping](https://github.com/CanCLID/to-jyutping), [SimpleWebAuthn](https://simplewebauthn.dev), [DOMPurify](https://github.com/cure53/DOMPurify), [marked](https://marked.js.org), [Lanyard](https://github.com/Phineas/lanyard)
- The README section structure is modelled on [Firefly](https://github.com/CuteLeaf/Firefly)

## 📝 License

The code is released under the [MIT License](LICENSE). Copyright and licensing of the sample posts and of your own writing are yours to decide.
