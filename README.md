<div align="center">

<h1>FluentFolio</h1>

**A Fluent-style personal website template: blog, serialized fiction, dictionary, worldbuilding, live presence and site status, all in one.**

**一套 Fluent 風格的個人網站模板：網誌、連載小說、詞典、世界觀、即時狀態與網站狀態，全部集中在一個地方。**

[English](#english) · [繁體中文](#zh-hant)

![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.23.4-5FA04E?logo=nodedotjs&logoColor=white)
![Astro](https://img.shields.io/badge/Astro-7-BC52EE?logo=astro&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

</div>

<a id="english"></a>

## English

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

### ✨ Features

#### Content

- [x] **Four collections** - essays (`blog`), serialized fiction (`novel`), `dictionary` and `world`, all Markdown
- [x] **Reading experience** - table of contents with numbered sections, reading progress, previous/next chapter, reading time, click-to-zoom image lightbox, and `[[term]]` hover glossary
- [x] **Site search** - Fuse.js full-site search with pinyin and jyutping, opened with the `/` shortcut
- [x] **Feeds and SEO** - separate RSS and Atom feeds for blog and novel, sitemap, robots.txt, Open Graph images, JSON-LD
- [x] **Drafts** - entries with `draft: true` never appear on the site, in the feeds or in search
- [x] **Content protection (optional)** - copy protection, watermark and crawler tiers, configured per entry through `copyProtect` and `crawl`

#### Presence and operations

- [x] **Live presence** - Discord status through Lanyard, plus the Steam game currently being played
- [x] **Status page** - health probes for the site, the database and the presence sources, with history
- [x] **Visitor statistics** - D1, with IPs hashed before use and Cloudflare Turnstile against abuse
- [x] **Security headers** - CSP and the common security headers emitted by middleware

#### Admin CMS

- [x] **Login protection** - Cloudflare Access plus Passkey, with the password as a fallback only
- [x] **Editor** - split-pane preview, Markdown linting, image upload to R2, drafts stored in D1
- [x] **Direct publishing** - commits through the GitHub API, Workers Builds redeploys automatically
- [x] **Publish notifications** - optional Discord webhook

#### Development quality

- [x] **Types and tests** - strict TypeScript checking, 300+ unit tests
- [x] **CI** - GitHub Actions only validates; Cloudflare Workers Builds deploys
- [x] **Content validation** - `npm run validate:md` checks frontmatter, images, internal links and the references between entries

Ideas are welcome as pull requests.

### 🚀 Getting Started

#### Requirements

- Node.js **22.23.4** (see `.nvmrc`; Astro 7.4.2 rejects older 22.x and does not support Node 24)
- npm
- A [Cloudflare](https://dash.cloudflare.com) account for deployment (the free plan is enough to start)

#### Local development

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

#### Deploy to Cloudflare

The step-by-step guide is in [DEPLOY-CLOUDFLARE.md](DEPLOY-CLOUDFLARE.md), and the repository / Workers Builds wiring is in [CLOUDFLARE-GITHUB-CICD.md](CLOUDFLARE-GITHUB-CICD.md). Roughly:

1. Create the resources: D1 (`npx wrangler d1 create personal-site`), KV (`npx wrangler kv namespace create SESSION`) and R2 (`npx wrangler r2 bucket create blog-images`).
2. Replace every `<YOUR_…>` placeholder and every `example.com` in `wrangler.jsonc` with your own values.
3. Apply the database migrations: `npx wrangler d1 migrations apply personal-site --remote`.
4. Set the secrets with `npx wrangler secret put` (see the environment variable table below).
5. In Cloudflare, connect the repository to Workers Builds: build command `npm run build`, deploy command `npx wrangler deploy`. From then on, a push to `main` deploys automatically.

> [!IMPORTANT]
> `.github/workflows/ci.yml` only validates. Do not add a deploy step, or it will fight with Workers Builds.

#### Environment variables

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

### 📖 Configuration

#### What to edit where

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

#### Directory structure

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

#### Timezone and language

- The UI ships in Traditional Chinese and English, and every string is in `src/i18n/ui.json` (read through `src/i18n/ui.ts`). Adding a language also requires changes in `src/lib/i18n.ts` and `public/scripts/site-shell.js`.
- All site times are displayed in **Hong Kong Time (UTC+8)**, implemented in [`src/lib/time.ts`](src/lib/time.ts); the background is explained in [docs/TIMEZONE.md](docs/TIMEZONE.md). Edit that file for another timezone.

> [!WARNING]
> The privacy policy and terms bundled with the template are sample texts written under **Hong Kong** law and contain `contact@example.com`. Replace them with your own content before going live, and review them against the regulations where you are.
>
> The default content licence in the footer is CC BY-NC-ND 4.0; change it to what you want (`license_prefix`, `license_suffix` and `BaseLayout.astro`).

### ⚙️ Post Frontmatter

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

### 🧩 Markdown Extensions

- **Dictionary links**: write `[[luma]]` in the body; if `dictionary` contains `luma.md` it becomes a link with a hover definition, and when there is no match it degrades to plain emphasis.
- **Copy protection and watermark** (optional): see [docs/COPY-PROTECTION.md](docs/COPY-PROTECTION.md).
- **Crawler tiers** (optional): see [docs/CRAWLER-POLICY.md](docs/CRAWLER-POLICY.md).

### 🔒 Optional: Keep Content in a Private Repository

By default the posts and the code share one repository. If you want to publish the code or hand it to collaborators while unpublished writing stays private, switch to private content mode: at build time `scripts/fetch-content.mjs` fetches the content with a read-only token, the admin commits to the content repository, and content updates redeploy through a Deploy Hook. The content repository is also the site's private overlay — `site.config.json`, `i18n/ui.json` and `assets/brand/*` are copied over the theme defaults before the build. Full steps and the content repository template: [docs/PRIVATE-CONTENT-REPO.md](docs/PRIVATE-CONTENT-REPO.md).

### 🧞 Commands

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

### 📚 Docs

All documentation under `docs/` is written in English.

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): system map
- [AGENTS.md](AGENTS.md): content and UI conventions, known pitfalls
- [ADMIN-CMS-SETUP.md](ADMIN-CMS-SETUP.md): admin CMS setup
- [docs/ADMIN-AUTH-ARCHITECTURE.md](docs/ADMIN-AUTH-ARCHITECTURE.md): admin login architecture
- [docs/CMS-CONTENT-EDITOR.md](docs/CMS-CONTENT-EDITOR.md): editor features
- [docs/CMS-HTTP-CONTRACT.md](docs/CMS-HTTP-CONTRACT.md): admin API contract

### 🙏 Acknowledgements

- [Astro](https://astro.build) and [Cloudflare Workers](https://workers.cloudflare.com)
- [Fluent UI System Icons](https://github.com/microsoft/fluentui-system-icons) (MIT, bundled in `public/icons/fluent/`) and the Microsoft Fluent design language
- [Noto Sans TC](https://fonts.google.com/noto/specimen/Noto+Sans+TC) (SIL Open Font License 1.1, used for OG images)
- [swup](https://swup.js.org), [Fuse.js](https://www.fusejs.io), [pinyin-pro](https://github.com/zh-lx/pinyin-pro), [to-jyutping](https://github.com/CanCLID/to-jyutping), [SimpleWebAuthn](https://simplewebauthn.dev), [DOMPurify](https://github.com/cure53/DOMPurify), [marked](https://marked.js.org), [Lanyard](https://github.com/Phineas/lanyard)
- The README section structure is modelled on [Firefly](https://github.com/CuteLeaf/Firefly)

### 📝 License

The code is released under the [MIT License](LICENSE). Copyright and licensing of the sample posts and of your own writing are yours to decide.

---

<a id="zh-hant"></a>

## 繁體中文

- 🌓 **Fluent 風格**：深色／淺色主題、玻璃質感頂欄與頁面轉場，依循 [Fluent 動態與設計指南](docs/Fluent_UI_Design_Motion_Guidelines_for_Astro.md)
- ⚡ **全在 Cloudflare 上**：Astro SSR 跑在 Workers，資料放 D1，圖片放 R2，不需要自己維護伺服器
- ✍️ **內建管理後台**：Passkey 加 Cloudflare Access、即時 Markdown 預覽與語法檢查、發佈時直接提交到 GitHub
- 🌏 **中文優先**：繁體中文與英文介面一鍵切換，搜尋支援普通話拼音與粵語 Jyutping

> [!TIP]
> FluentFolio 是從一個真實運作中的個人網站整理出來的模板，已抽走個人內容。它是一套**主題**，不是拿來 fork 後大改的起點：你自己的東西放在獨立的一層，升級時就是合併主題。
>
> 1. 編輯 [`site.config.json`](site.config.json)：標題、網址、作者、導覽、Feed、授權、社交連結，以及「關於」頁的設備與遊戲。
> 2. 把 logo、favicon、圖示、背景影片與音效放進 `public/brand/`（目前都是中性佔位檔）。
> 3. 把文章、這份個人設定與品牌素材一起放在**另一個私人儲存庫**，建置時用 `npm run fetch:content` 覆蓋進來。
> 4. 只有需要改文案時才動 [`src/i18n/ui.json`](src/i18n/ui.json)。
>
> 完整的三層模型與合併步驟見 [`docs/UPGRADING.md`](docs/UPGRADING.md)。

### ✨ 功能

#### 內容

- [x] **四個內容集合**：隨筆（`blog`）、連載小說（`novel`）、`dictionary`、`world`，全部是 Markdown
- [x] **閱讀體驗**：目錄自動編號、閱讀進度、上一章／下一章、預估閱讀時間、點擊放大的圖片燈箱，以及 `[[詞條]]` 懸停釋義
- [x] **站內搜尋**：Fuse.js 全站搜尋，支援拼音與 Jyutping，按 `/` 開啟
- [x] **Feed 與 SEO**：網誌與小說各自提供 RSS 與 Atom、sitemap、robots.txt、Open Graph 圖片、JSON-LD
- [x] **草稿**：`draft: true` 的內容不會出現在網站、Feed 或搜尋結果
- [x] **內容保護（可選）**：防複製、浮水印與爬蟲分級，透過 `copyProtect` 與 `crawl` 逐篇設定

#### 狀態與營運

- [x] **即時狀態**：透過 Lanyard 顯示 Discord 狀態，以及正在玩的 Steam 遊戲
- [x] **狀態頁**：網站、資料庫與狀態來源的健康檢查，附歷史紀錄
- [x] **訪客統計**：資料存 D1，IP 先雜湊再使用，並以 Cloudflare Turnstile 防止濫用
- [x] **安全標頭**：中介層統一發出 CSP 與常見安全標頭

#### 管理後台

- [x] **登入保護**：Cloudflare Access 加 Passkey，密碼只作後備
- [x] **編輯器**：左右分割預覽、Markdown 語法檢查、圖片上傳到 R2、草稿存 D1
- [x] **直接發佈**：透過 GitHub API 提交，Workers Builds 自動重新部署
- [x] **發佈通知**：可選的 Discord Webhook

#### 開發品質

- [x] **型別與測試**：嚴格 TypeScript 檢查，300+ 個單元測試
- [x] **CI**：GitHub Actions 只做驗證；部署交給 Cloudflare Workers Builds
- [x] **內容驗證**：`npm run validate:md` 檢查 frontmatter、圖片、內部連結與條目之間的引用

歡迎以 Pull Request 提供想法。

### 🚀 開始使用

#### 環境需求

- Node.js **22.23.4**（見 `.nvmrc`；Astro 7.4.2 不接受較舊的 22.x，也不支援 Node 24）
- npm
- 一個 [Cloudflare](https://dash.cloudflare.com) 帳號作部署之用（免費方案已足夠起步）

#### 本機開發

1. 按右上角 **Use this template** 或 fork 這個儲存庫，然後 clone。

   ```bash
   git clone https://github.com/your-name/fluentfolio.git
   cd fluentfolio
   ```

2. 切換到正確的 Node 版本並安裝依賴。

   ```bash
   nvm use 22.23.4
   npm ci
   ```

3. 建立本機設定檔。留空的值會優雅降級：對應面板顯示「未設定」，而不是讓網站壞掉。

   ```bash
   cp .env.example .dev.vars
   ```

4. 初始化本機 D1 資料庫，然後啟動。

   ```bash
   npx wrangler d1 migrations apply personal-site --local
   npm run dev
   ```

   開啟 <http://localhost:4321>。

> [!NOTE]
> 本機的密鑰與變數放在 `.dev.vars`（已列入 git ignore）。不要放進 `.env`，也不要提交到儲存庫。

#### 部署到 Cloudflare

逐步說明見 [DEPLOY-CLOUDFLARE.md](DEPLOY-CLOUDFLARE.md)，儲存庫與 Workers Builds 的接線見 [CLOUDFLARE-GITHUB-CICD.md](CLOUDFLARE-GITHUB-CICD.md)。大致流程：

1. 建立資源：D1（`npx wrangler d1 create personal-site`）、KV（`npx wrangler kv namespace create SESSION`）與 R2（`npx wrangler r2 bucket create blog-images`）。
2. 把 `wrangler.jsonc` 內所有 `<YOUR_…>` 佔位符與 `example.com` 換成你自己的值。
3. 套用資料庫遷移：`npx wrangler d1 migrations apply personal-site --remote`。
4. 用 `npx wrangler secret put` 設定密鑰（見下方的環境變數表）。
5. 在 Cloudflare 把儲存庫連到 Workers Builds：建置命令 `npm run build`，部署命令 `npx wrangler deploy`。之後每次 push 到 `main` 都會自動部署。

> [!IMPORTANT]
> `.github/workflows/ci.yml` 只做驗證。不要加入部署步驟，否則會與 Workers Builds 互相衝突。

#### 環境變數

全部都是可選的；缺少某個值時，對應功能會停用。完整清單與說明見 [`.env.example`](.env.example)。

| 變數                                            | 用途                               |
| ----------------------------------------------- | ---------------------------------- |
| `DISCORD_USER_ID`                               | 首頁 Discord 面板顯示哪個帳號      |
| `STEAM_API_KEY`, `STEAM_ID`                     | Steam 正在玩與個人檔案             |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`              | Cloudflare Access（保護 `/admin`） |
| `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`        | 管理員登入與工作階段               |
| `ADMIN_WEBAUTHN_RP_ID`, `ADMIN_WEBAUTHN_ORIGIN` | Passkey 網域設定                   |
| `GITHUB_TOKEN`, `GITHUB_REPO`, `GITHUB_BRANCH`  | 發佈時管理後台提交到哪個儲存庫     |
| `R2_PUBLIC_BASE_URL`                            | 管理後台上傳圖片的公開網址         |
| `TURNSTILE_SECRET`, `TURNSTILE_HOSTNAMES`       | 訪客統計的人機驗證                 |
| `VISITOR_SALT`, `VISITOR_COOKIE_SECRET`         | 訪客身分雜湊                       |
| `WATERMARK_SECRET`                              | 文章浮水印                         |
| `DISCORD_BLOG_WEBHOOK_URL`                      | 新文章發佈時的 Discord 通知        |

### 📖 設定

#### 哪裡改什麼

| 想改的東西                      | 改哪裡                                                                     |
| ------------------------------- | -------------------------------------------------------------------------- |
| 網站名稱、標題後綴、導覽項目    | [`site.config.json`](site.config.json)                                     |
| 名字、帳號、標語、社交連結      | [`site.config.json`](site.config.json)                                     |
| 「關於」頁的設備與遊戲          | [`site.config.json`](site.config.json) 的 `about.setup`、`about.games`     |
| 贊助按鈕（Ko-fi、Liberapay 等） | [`site.config.json`](site.config.json) 的 `supportLinks`，預設為空         |
| 所有介面文案、隱私政策、條款    | [`src/i18n/ui.json`](src/i18n/ui.json)（`zh` 與 `en` 兩份）                |
| 網域、資源 ID、Access 設定      | [`wrangler.jsonc`](wrangler.jsonc)                                         |
| 顏色、圓角、陰影                | [`src/styles/tokens.css`](src/styles/tokens.css)                           |
| Logo、favicon、PWA 圖示         | `public/brand/logo.svg`、`public/brand/favicon.svg`、`public/brand/icons/` |
| 背景圖與背景影片                | `src/assets/background.webp`、`public/brand/background.mp4`、`.webm`       |
| 彩蛋音效                        | `public/brand/easter.mp3`                                                  |

每個網站專屬的值都集中在一個檔案：[`site.config.json`](site.config.json)；[`src/site.config.ts`](src/site.config.ts) 是它的型別化載入器，[`src/lib/data.ts`](src/lib/data.ts) 則是相容用的再匯出。介面文案放在 [`src/i18n/ui.json`](src/i18n/ui.json)，由 [`src/i18n/ui.ts`](src/i18n/ui.ts) 提供型別化存取。

想讓主題升級無痛，請讀 [`docs/UPGRADING.md`](docs/UPGRADING.md)：網站設定、內容與主題是三層，升級時只有網站層會衝突。

#### 目錄結構

```text
├── src/
│   ├── content/          # 你的文章：blog、novel、dictionary、world
│   ├── content.config.ts # 各集合的 frontmatter schema（單一真實來源）
│   ├── site.config.ts    # site.config.json 的型別化載入器
│   ├── i18n/             # ui.json（介面文案）與 ui.ts（型別化存取）
│   ├── lib/              # 搜尋、SEO、CMS、時間與驗證邏輯
│   ├── layouts/          # BaseLayout：頂欄、導覽、頁尾、全域腳本
│   ├── components/       # 搜尋、目錄、閱讀進度、圖示
│   ├── pages/            # 路由；api/ 是 Worker 端點，admin/ 是管理後台
│   └── styles/           # tokens.css 與各區樣式
├── public/               # 靜態素材與瀏覽器腳本（public/scripts）
├── migrations/           # D1 資料庫遷移
├── scripts/              # 內容驗證、內容抓取、OG 檢查
├── tests/                # 單元測試與 fixture
├── docs/                 # 架構、CMS、爬蟲政策（英文）
├── site.config.json      # 網站身分、導覽、Feed、授權、品牌素材路徑
└── wrangler.jsonc        # Cloudflare Workers 設定
```

#### 時區與語言

- 介面提供繁體中文與英文，所有字串都在 `src/i18n/ui.json`（經 `src/i18n/ui.ts` 讀取）。新增語言還需要改 `src/lib/i18n.ts` 與 `public/scripts/site-shell.js`。
- 網站時間一律以**香港時間（UTC+8）**顯示，實作在 [`src/lib/time.ts`](src/lib/time.ts)；背景說明見 [docs/TIMEZONE.md](docs/TIMEZONE.md)。要換時區就改那個檔案。

> [!WARNING]
> 模板附帶的隱私政策與條款是以**香港**法律為背景的範例文字，內含 `contact@example.com`。上線前請換成你自己的內容，並依你所在地的法規重新檢視。
>
> 頁尾預設的內容授權是 CC BY-NC-ND 4.0；要改就改 `license_prefix`、`license_suffix` 與 `BaseLayout.astro`。

### ⚙️ 文章 Frontmatter

所有文章都在 `src/content/<collection>/` 之下，**檔案名稱就是網址**：`src/content/blog/hello-world.md` 會變成 `/posts/blog/hello-world`。建議使用小寫英文加連字號。

隨筆（`blog`）：

```yaml
---
title: Post title # 必填
date: 2026-11-01 # 必填
description: One-line summary # 必填，用於列表、RSS 與 SEO
type: essay # 可選，預設 essay
category: Announcements # 可選，預設 General
tags: [FluentFolio, Intro] # 可選
author: Your Name # 可選
updatedDate: 2026-11-10 # 可選
featured: false # 可選，標記為推薦
draft: false # 可選，true 表示不公開
copyProtect: true # 可選，覆寫這篇的防複製設定
---
```

連載小說（`novel`）：

```yaml
---
title: Chapter 1　The Beginning # 必填
chapter: 1 # 必填，正整數
date: 2026-11-04 # 必填
volume: Volume 1 # 可選，卷名
order: 1 # 可選，決定閱讀次序
relatedLore: [luma] # 可選，相關詞典條目 id
---
```

詞典（`dictionary`）與世界觀（`world`）：

```yaml
---
word: luma # dictionary 必填；world 用 title
partOfSpeech: noun # dictionary 必填
definition: Light; brightness. # dictionary 必填；world 用 description
ipa: /ˈlu.ma/ # 可選
relatedWords: [sora] # 可選，其他條目的 id（world 用 relatedEntries）
---
```

每個欄位的權威定義在 [`src/content.config.ts`](src/content.config.ts)。寫完後執行 `npm run validate:md`，檢查欄位、圖片、內部連結與引用。

### 🧩 Markdown 擴充

- **詞典連結**：在正文寫 `[[luma]]`；若 `dictionary` 內有 `luma.md`，會變成附懸停釋義的連結，找不到對應條目時退化為普通強調。
- **防複製與浮水印**（可選）：見 [docs/COPY-PROTECTION.md](docs/COPY-PROTECTION.md)。
- **爬蟲分級**（可選）：見 [docs/CRAWLER-POLICY.md](docs/CRAWLER-POLICY.md)。

### 🔒 可選：把內容放在私人儲存庫

預設文章與程式碼在同一個儲存庫。如果你想公開程式碼或交給協作者，同時讓未發佈的作品保持私人，可以改用私人內容模式：建置時由 `scripts/fetch-content.mjs` 以唯讀權杖抓取內容，管理後台提交到內容儲存庫，內容更新再透過 Deploy Hook 重新部署。內容儲存庫同時是網站的私人覆蓋層——建置前會把 `site.config.json`、`i18n/ui.json` 與 `assets/brand/*` 覆蓋到主題預設值之上。完整步驟與內容儲存庫模板見 [docs/PRIVATE-CONTENT-REPO.md](docs/PRIVATE-CONTENT-REPO.md)。

### 🧞 指令

| 指令                                      | 作用                                          |
| ----------------------------------------- | --------------------------------------------- |
| `npm run dev`                             | 啟動本機開發伺服器                            |
| `npm run build`                           | 正式建置（會先執行 `fetch:content`）          |
| `npm run preview`                         | 在本機預覽建置結果                            |
| `npm run check`                           | `astro check`：型別與診斷                     |
| `npm run check:public`                    | 檢查 `public/scripts` 內的瀏覽器腳本型別      |
| `npm run check:inline-scripts`            | 確認建置結果沒有可執行的 inline script（CSP） |
| `npm run lint`                            | 檢查本儲存庫的 Markdown                       |
| `npm run validate:md`                     | 驗證文章 frontmatter、圖片、連結與引用        |
| `npm test`                                | 單元測試                                      |
| `npm run format` / `npm run format:check` | 以 Prettier 格式化／檢查格式                  |
| `npm run deploy`                          | 建置並執行 `wrangler deploy`（手動部署）      |
| `npm run fetch:content`                   | 私人內容模式：抓取內容儲存庫                  |

### 📚 文件

`docs/` 下的文件全部以英文撰寫。

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：系統全貌
- [AGENTS.md](AGENTS.md)：內容與介面慣例、已知陷阱
- [ADMIN-CMS-SETUP.md](ADMIN-CMS-SETUP.md)：管理後台設定
- [docs/ADMIN-AUTH-ARCHITECTURE.md](docs/ADMIN-AUTH-ARCHITECTURE.md)：管理員登入架構
- [docs/CMS-CONTENT-EDITOR.md](docs/CMS-CONTENT-EDITOR.md)：編輯器功能
- [docs/CMS-HTTP-CONTRACT.md](docs/CMS-HTTP-CONTRACT.md)：管理 API 契約

### 🙏 致謝

- [Astro](https://astro.build) 與 [Cloudflare Workers](https://workers.cloudflare.com)
- [Fluent UI System Icons](https://github.com/microsoft/fluentui-system-icons)（MIT，內附於 `public/icons/fluent/`）與 Microsoft Fluent 設計語言
- [Noto Sans TC](https://fonts.google.com/noto/specimen/Noto+Sans+TC)（SIL Open Font License 1.1，用於 OG 圖片）
- [swup](https://swup.js.org)、[Fuse.js](https://www.fusejs.io)、[pinyin-pro](https://github.com/zh-lx/pinyin-pro)、[to-jyutping](https://github.com/CanCLID/to-jyutping)、[SimpleWebAuthn](https://simplewebauthn.dev)、[DOMPurify](https://github.com/cure53/DOMPurify)、[marked](https://marked.js.org)、[Lanyard](https://github.com/Phineas/lanyard)
- README 的章節結構參考 [Firefly](https://github.com/CuteLeaf/Firefly)

### 📝 授權

程式碼以 [MIT License](LICENSE) 釋出。範例文章與你自己作品的著作權與授權方式由你決定。
