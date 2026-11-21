<div align="center">

<h1>FluentFolio</h1>

**Fluent 風格的個人網站範本：部落格、連載小說、詞典、世界觀、即時動態與站點狀態，一次到位。**

![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.23.4-5FA04E?logo=nodedotjs&logoColor=white)
![Astro](https://img.shields.io/badge/Astro-7-BC52EE?logo=astro&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

**繁體中文** | [English](README.en.md)

</div>

- 🌓 **Fluent 風格介面**：深色／淺色主題、玻璃質感頂欄、頁面轉場動畫，遵循 [Fluent 動態與設計規範](docs/Fluent_UI_Design_Motion_Guidelines_for_Astro.md)
- ⚡ **Cloudflare 全家桶**：Astro SSR 跑在 Workers，資料放 D1，圖片放 R2，不需要自己維護伺服器
- ✍️ **內建後台**：Passkey 加 Cloudflare Access 保護，Markdown 即時預覽與檢查，發佈時直接 commit 到 GitHub
- 🌏 **中文優先**：繁體中文與英文介面一鍵切換，搜尋支援拼音與粵拼

> [!TIP]
> FluentFolio 是從一個真實運作中的個人網站去除個人內容後整理成的範本。fork 之後依序做這四件事就能變成你自己的網站：
>
> 1. 修改 [`src/lib/data.ts`](src/lib/data.ts)：名字、帳號、社交連結、About 頁的設備與遊戲清單。
> 2. 修改 [`src/i18n/ui.ts`](src/i18n/ui.ts)：標題文案，以及私隱政策與使用條款。
> 3. 替換 `public/` 與 `src/assets/` 裡的 logo、圖示、背景與音效（目前是自動生成的中性素材）。
> 4. 刪除 `src/content/` 的示範文章，寫你自己的。

## ✨ 功能特性

### 內容

- [x] **四種內容集合** - 隨筆（`blog`）、連載小說（`novel`）、詞典（`dictionary`）、世界觀（`world`），全部是 Markdown
- [x] **閱讀體驗** - 目錄、閱讀進度、上一章／下一章、閱讀時間，以及 `[[詞彙]]` 懸浮詞典提示
- [x] **站內搜尋** - Fuse.js 全站搜尋，支援拼音與粵拼，`/` 快捷鍵呼叫
- [x] **訂閱與 SEO** - 部落格與小說各自的 RSS、sitemap、robots.txt、Open Graph 圖片、JSON-LD
- [x] **草稿** - `draft: true` 的條目不會出現在網站、RSS 或搜尋中
- [x] **文章保護（選用）** - 複製防護、浮水印、爬蟲分級，逐篇用 `copyProtect` 與 `crawl` 設定

### 動態與營運

- [x] **即時動態** - 透過 Lanyard 顯示 Discord 狀態，並顯示 Steam 正在遊玩的遊戲
- [x] **站點狀態頁** - 網站、資料庫、動態來源的健康探測，附歷史紀錄
- [x] **訪客統計** - 使用 D1，IP 雜湊後才使用，以 Cloudflare Turnstile 防濫用
- [x] **安全標頭** - 以 middleware 輸出 CSP 與常見安全標頭

### 後台 CMS

- [x] **登入保護** - Cloudflare Access 加 Passkey，密碼只作為備援
- [x] **編輯器** - 左右分欄預覽、Markdown 檢查、圖片上傳到 R2、草稿存在 D1
- [x] **直接發佈** - 透過 GitHub API commit，Workers Builds 自動重新部署
- [x] **發佈通知** - 可選的 Discord Webhook

### 開發品質

- [x] **型別與測試** - TypeScript 嚴格檢查，300 多個單元測試
- [x] **CI** - GitHub Actions 只負責驗證，部署交給 Cloudflare Workers Builds
- [x] **內容驗證** - `npm run validate:md` 檢查 frontmatter、圖片、內部連結與條目之間的關聯

有想法歡迎提交 Pull Request。

## 🚀 快速開始

### 環境要求

- Node.js **22.23.4**（見 `.nvmrc`；Astro 7.4.2 不接受更舊的 22.x，也不支援 Node 24）
- npm
- 部署需要 [Cloudflare](https://dash.cloudflare.com) 帳號（免費方案即可起步）

### 本機開發

1. 點擊右上角 **Use this template** 或 Fork 本倉庫，再 clone 到本機。

   ```bash
   git clone https://github.com/your-name/fluentfolio.git
   cd fluentfolio
   ```

2. 切換 Node 版本並安裝依賴。

   ```bash
   nvm use 22.23.4
   npm ci
   ```

3. 建立本機設定檔。留空的項目會優雅降級：對應的面板會顯示「未設定」，不會讓網站壞掉。

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
> 本機祕密與變數放在 `.dev.vars`（已被 git 忽略），不要放進 `.env`，也不要提交。

### 部署到 Cloudflare

完整的逐步說明在 [DEPLOY-CLOUDFLARE.md](DEPLOY-CLOUDFLARE.md)，倉庫與 Workers Builds 的串接在 [CLOUDFLARE-GITHUB-CICD.md](CLOUDFLARE-GITHUB-CICD.md)。大致流程：

1. 建立資源：D1（`npx wrangler d1 create personal-site`）、KV（`npx wrangler kv namespace create SESSION`）、R2（`npx wrangler r2 bucket create blog-images`）。
2. 把 `wrangler.jsonc` 裡所有 `<YOUR_…>` 佔位值與 `example.com` 換成你自己的。
3. 套用資料庫 migration：`npx wrangler d1 migrations apply personal-site --remote`。
4. 用 `npx wrangler secret put` 設定祕密（見下方環境變數表）。
5. 在 Cloudflare 把倉庫連到 Workers Builds：建置指令 `npm run build`，部署指令 `npx wrangler deploy`。之後推送到 `main` 就會自動部署。

> [!IMPORTANT]
> `.github/workflows/ci.yml` 只做驗證，不要加部署步驟，否則會和 Workers Builds 互相打架。

### 環境變數

全部都是選填，沒設定時對應功能會停用。完整清單與說明見 [`.env.example`](.env.example)。

| 變數                                            | 用途                               |
| ----------------------------------------------- | ---------------------------------- |
| `DISCORD_USER_ID`                               | 首頁 Discord 動態面板顯示哪個帳號  |
| `STEAM_API_KEY`、`STEAM_ID`                     | Steam 正在遊玩與個人資料           |
| `ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`              | Cloudflare Access（保護 `/admin`） |
| `ADMIN_PASSWORD`、`ADMIN_SESSION_SECRET`        | 後台登入與工作階段                 |
| `ADMIN_WEBAUTHN_RP_ID`、`ADMIN_WEBAUTHN_ORIGIN` | Passkey 的網域設定                 |
| `GITHUB_TOKEN`、`GITHUB_REPO`、`GITHUB_BRANCH`  | 後台發佈文章時 commit 的目標       |
| `R2_PUBLIC_BASE_URL`                            | 後台上傳圖片的公開網址             |
| `TURNSTILE_SECRET`、`TURNSTILE_HOSTNAMES`       | 訪客統計的人機驗證                 |
| `VISITOR_SALT`、`VISITOR_COOKIE_SECRET`         | 訪客識別雜湊                       |
| `WATERMARK_SECRET`                              | 文章浮水印                         |
| `DISCORD_BLOG_WEBHOOK_URL`                      | 發佈新文章時的 Discord 通知        |

## 📖 配置說明

### 先改這幾個地方

| 想改什麼                         | 在哪裡改                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------- |
| 名字、帳號、標語、社交連結       | [`src/lib/data.ts`](src/lib/data.ts)                                         |
| About 頁的設備與遊戲             | [`src/lib/data.ts`](src/lib/data.ts) 的 `aboutSetup`、`aboutGames`           |
| 捐助按鈕（Ko-fi、Liberapay 等）  | [`src/lib/data.ts`](src/lib/data.ts) 的 `supportLinks`，預設為空             |
| 所有介面文字、私隱政策、使用條款 | [`src/i18n/ui.ts`](src/i18n/ui.ts)（`zh` 與 `en` 兩份）                      |
| 網域、資源 ID、Access 設定       | [`wrangler.jsonc`](wrangler.jsonc)                                           |
| 配色、圓角、陰影                 | [`src/styles/tokens.css`](src/styles/tokens.css)                             |
| Logo、favicon、PWA 圖示          | `public/logo.svg`、`public/favicon.svg`、`public/icons/`                     |
| 背景圖與背景影片                 | `src/assets/background.webp`、`public/background.mp4`、`.webm`               |
| 彩蛋音效                         | `public/easter.mp3`                                                          |
| 導覽列項目                       | [`src/layouts/BaseLayout.astro`](src/layouts/BaseLayout.astro) 的 `navItems` |

### 目錄結構

```text
├── src/
│   ├── content/          # 你的文章：blog、novel、dictionary、world
│   ├── content.config.ts # 各集合的 frontmatter 結構（單一事實來源）
│   ├── i18n/ui.ts        # 中英文介面文字與法律文本
│   ├── lib/              # data.ts（站點設定）、搜尋、SEO、CMS 等邏輯
│   ├── layouts/          # BaseLayout：頂欄、導覽、頁尾、全站腳本
│   ├── components/       # 搜尋、目錄、圖示等元件
│   ├── pages/            # 路由；api/ 為 Worker 端點，admin/ 為後台
│   └── styles/           # tokens.css 與各區塊樣式
├── public/               # 靜態資源與瀏覽器端腳本（public/scripts）
├── migrations/           # D1 資料庫 migration
├── scripts/              # 內容驗證、抓取內容、OG 檢查等腳本
├── tests/                # 單元測試與測試用固定資料
├── docs/                 # 架構、CMS、爬蟲政策等文件
└── wrangler.jsonc        # Cloudflare Workers 設定
```

### 時區與語言

- 介面語言為繁體中文與英文，文案都在 `src/i18n/ui.ts`。要新增語言，需要同步調整 `src/lib/i18n.ts` 與 `public/scripts/site-shell.js`。
- 全站時間固定以**香港標準時間（UTC+8）**顯示，實作在 [`src/lib/time.ts`](src/lib/time.ts)，背景說明見 [HKO-TIME.md](HKO-TIME.md)。需要其他時區請修改該檔案。

> [!WARNING]
> 範本內附的私隱政策與使用條款是依**香港**法律寫成的示範文本，內含 `contact@example.com`。上線前請換成你自己的內容，並依你所在地區的法規審視。
>
> 頁尾預設的內容授權為 CC BY-NC-ND 4.0，也請依你的意願修改（`license_prefix`、`license_suffix` 與 `BaseLayout.astro`）。

## ⚙️ 文章 Frontmatter

所有文章放在 `src/content/<集合>/` 底下，**檔名就是網址**：`src/content/blog/hello-world.md` 會成為 `/posts/blog/hello-world`。建議使用小寫英文與連字號。

隨筆（`blog`）：

```yaml
---
title: 文章標題 # 必填
date: 2026-11-01 # 必填
description: 一句話摘要 # 必填，用於列表、RSS 與 SEO
type: essay # 選填，預設 essay
category: 公告 # 選填，預設 General
tags: [FluentFolio, 入門] # 選填
author: Your Name # 選填
updatedDate: 2026-11-10 # 選填
featured: false # 選填，是否置頂推薦
draft: false # 選填，true 時不會公開
copyProtect: true # 選填，覆寫此篇的複製防護
---
```

連載小說（`novel`）：

```yaml
---
title: 第一章　開端 # 必填
chapter: 1 # 必填，正整數
date: 2026-11-04 # 必填
volume: 第一卷 # 選填，分卷名稱
order: 1 # 選填，決定閱讀順序
relatedLore: [luma] # 選填，相關的詞典條目 id
---
```

詞典（`dictionary`）與世界觀（`world`）：

```yaml
---
word: luma # 詞典必填；世界觀改用 title
partOfSpeech: 名詞 # 詞典必填
definition: 光；亮度。 # 詞典必填；世界觀改用 description
ipa: /ˈlu.ma/ # 選填
relatedWords: [sora] # 選填，其他詞條的 id（世界觀用 relatedEntries）
---
```

所有欄位以 [`src/content.config.ts`](src/content.config.ts) 為準。寫完後執行 `npm run validate:md` 檢查欄位、圖片、內部連結與關聯。

## 🧩 Markdown 擴展

- **詞典連結**：正文寫 `[[luma]]`，如果 `dictionary` 裡有 `luma.md`，就會變成可懸浮顯示定義的連結；找不到時退化成一般的醒目文字。
- **複製防護與浮水印**（選用）：見 [docs/COPY-PROTECTION.md](docs/COPY-PROTECTION.md)。
- **爬蟲分級**（選用）：見 [docs/CRAWLER-POLICY.md](docs/CRAWLER-POLICY.md)。

## 🔒 選用：把文章放在私有倉庫

預設情況下文章與程式碼在同一個倉庫。如果你想讓程式碼公開或交給別人協作，同時把未發佈的文章留在私有倉庫，可以改用「私有內容模式」：建置時由 `scripts/fetch-content.mjs` 以唯讀 token 取得內容，後台則 commit 到內容倉庫，內容更新時透過 Deploy Hook 自動重新部署。完整步驟與內容倉庫範本見 [docs/PRIVATE-CONTENT-REPO.md](docs/PRIVATE-CONTENT-REPO.md)。

## 🧞 指令

| 指令                                      | 作用                                         |
| ----------------------------------------- | -------------------------------------------- |
| `npm run dev`                             | 啟動本機開發伺服器                           |
| `npm run build`                           | 建置正式版本（建置前會執行 `fetch:content`） |
| `npm run preview`                         | 本機預覽建置結果                             |
| `npm run check`                           | `astro check`：型別與診斷                    |
| `npm run check:public`                    | 檢查 `public/scripts` 的瀏覽器端腳本型別     |
| `npm run check:inline-scripts`            | 確認建置結果沒有可執行的行內腳本（CSP 要求） |
| `npm run lint`                            | 檢查本倉庫文件的 Markdown 格式               |
| `npm run validate:md`                     | 驗證文章 frontmatter、圖片、連結與關聯       |
| `npm test`                                | 單元測試                                     |
| `npm run format` / `npm run format:check` | 以 Prettier 格式化／檢查格式                 |
| `npm run deploy`                          | 建置並執行 `wrangler deploy`（手動部署用）   |
| `npm run fetch:content`                   | 私有內容模式：把內容倉庫抓進 `src/content`   |

## 📚 文件

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：系統地圖
- [AGENTS.md](AGENTS.md)：內容與介面慣例、已知陷阱
- [ADMIN-CMS-SETUP.md](ADMIN-CMS-SETUP.md)：後台 CMS 設定
- [docs/ADMIN-AUTH-ARCHITECTURE.md](docs/ADMIN-AUTH-ARCHITECTURE.md)：後台登入架構
- [docs/CMS-CONTENT-EDITOR.md](docs/CMS-CONTENT-EDITOR.md)：編輯器功能
- [docs/CMS-HTTP-CONTRACT.md](docs/CMS-HTTP-CONTRACT.md)：後台 API 契約

## 🙏 致謝

- [Astro](https://astro.build) 與 [Cloudflare Workers](https://workers.cloudflare.com)
- [Fluent UI System Icons](https://github.com/microsoft/fluentui-system-icons)（MIT，已內附於 `public/icons/fluent/`）與 Microsoft Fluent 設計語言
- [Noto Sans TC](https://fonts.google.com/noto/specimen/Noto+Sans+TC)（SIL Open Font License 1.1，用於 OG 圖片）
- [swup](https://swup.js.org)、[Fuse.js](https://www.fusejs.io)、[pinyin-pro](https://github.com/zh-lx/pinyin-pro)、[to-jyutping](https://github.com/CanCLID/to-jyutping)、[SimpleWebAuthn](https://simplewebauthn.dev)、[DOMPurify](https://github.com/cure53/DOMPurify)、[marked](https://marked.js.org)、[Lanyard](https://github.com/Phineas/lanyard)
- README 的章節結構參考自 [Firefly](https://github.com/CuteLeaf/Firefly)

## 📝 授權

程式碼以 [MIT License](LICENSE) 授權。範例文章與你自己撰寫的內容，版權與授權由你自行決定。
