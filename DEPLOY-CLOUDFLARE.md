# Cloudflare 部署：一步一步

## 1. 準備

需要：Node.js 22+、Cloudflare 帳戶，以及本目錄。

```powershell
npm install
npx wrangler login
```

瀏覽器完成 Cloudflare 授權後，確認：

```powershell
npx wrangler whoami
```

## 2. 建立 D1

```powershell
npx wrangler d1 create personal-site
```

指令會回傳 `database_id`。把它填入 `wrangler.jsonc`：

```json
"database_id": "你的 UUID"
```

## 3. 套用 migration

正式 Cloudflare D1：

```powershell
npx wrangler d1 migrations apply personal-site --remote
```

檢查 migration 狀態：

```powershell
npx wrangler d1 migrations list personal-site --remote
```

## 4. 設定 Steam

去 Steam Web API 取得 API Key，再用 Wrangler secret 儲存。不要把 key 寫入 Git。

```powershell
npx wrangler secret put STEAM_API_KEY
npx wrangler secret put STEAM_ID
```

其中 `STEAM_ID` 是你的 64-bit SteamID，例如 `7656119...`。

## 5. 設定訪客統計與 Discord Presence 的 secrets

```powershell
npx wrangler secret put VISITOR_SALT
npx wrangler secret put DISCORD_USER_ID
```

`VISITOR_SALT` 用來將 Cloudflare client IP 做 SHA-256 雜湊後再存入 D1；網站不直接保存 IP。

`VISITOR_COOKIE_SECRET` 用來簽署第一方安全驗證 Cookie；建議使用一個與其他 secrets 不同的隨機字串。若未設定，程式會退回使用 `TURNSTILE_SECRET`。

`DISCORD_USER_ID` 是被 Lanyard 監測的 Discord 使用者 ID；`/api/activity` 用它即時代理 Discord Presence。

The admin CMS requires `ADMIN_SESSION_SECRET`, `GITHUB_TOKEN`, and (when publishing notifications are enabled) `DISCORD_BLOG_WEBHOOK_URL` as Worker secrets. `ADMIN_PASSWORD` is an optional fallback while Passkey is the preferred account login. The mandatory Cloudflare Access + Worker-side JWT check requires `ACCESS_TEAM_DOMAIN` and either one shared `ACCESS_AUD` or route-specific `ACCESS_ADMIN_AUD` + `ACCESS_API_AUD` vars. Passkey setup requires applying migration `0006_admin_passkeys.sql`. See `ADMIN-CMS-SETUP.md` and `docs/ADMIN-AUTH-ARCHITECTURE.md`.

## 5b. Turnstile (bot protection)

`POST /api/visitors` is protected by Cloudflare Turnstile. The widget already exists (sitekey `0x4AAAAAAEubO6tRmWSwdMdT`), so only its secret key has to be stored:

```powershell
npx wrangler secret put TURNSTILE_SECRET
```

In Cloudflare Dashboard → Turnstile, confirm the widget lists `www.example.com` and `example.com`. Keep `localhost` and `127.0.0.1` in the local `.dev.vars` only — never in production.

`TURNSTILE_HOSTNAMES` in `wrangler.jsonc` is the server-side allow-list and must match those production hostnames exactly: an empty list fails closed rather than allowing everything through. Until `TURNSTILE_SECRET` is set, visitor analytics keep working unprotected and log a warning.

## 6. 先本地檢查 build

```powershell
npm run check
npm run lint
npm test
npm run build
```

成功後可以：

```powershell
npm run preview
```

## 7. 第一次部署

```powershell
npx wrangler deploy
```

Cloudflare 會輸出 Worker URL，通常是：

`https://fluentfolio.<your-subdomain>.workers.dev`

## 8. 確認 API

把 `<DOMAIN>` 換成實際網址：

```powershell
curl https://<DOMAIN>/api/health
curl https://<DOMAIN>/api/activity
curl https://<DOMAIN>/api/visitors
curl https://<DOMAIN>/api/steam
```

`/api/health` 應該回傳 `status: ok`。Steam 如果沒有設定 secrets，會回傳 `configured: false`，這是預期行為。

## 9. Discord Presence（即時代理）

首頁的 Discord 活動面板透過 `/api/activity`（由 Worker 代理 Lanyard 的即時 Presence）取得資料，並提供瀏覽器 WebSocket 備援。確認 `DISCORD_USER_ID` secret 已設定、且該帳戶被 Lanyard 監測即可，不需要再手動更新。`POST /api/activity` 已停用（回傳 405）。

## 10. 綁定自己的網域

Cloudflare Dashboard → Workers & Pages → 你的 Worker → Settings / Domains & Routes → Add Custom Domain。

若網域 DNS 已在 Cloudflare，照介面加入你的網域即可。部署後再次測試：

```powershell
curl https://你的網域/api/health
```

## 11. GitHub 自動部署（使用 Cloudflare Workers Builds）

正式部署由 Cloudflare Workers Builds 驅動：GitHub `main` branch 每次 push，Cloudflare 執行建置指令 `npm run build`、部署指令 `npx wrangler deploy`。

**不要**再把 `npx wrangler deploy` 放入 GitHub Actions——兩個部署系統會互相衝突。詳見 `CLOUDFLARE-GITHUB-CICD.md`。

## 12. 日常更新

修改程式 → 本地檢查：

```powershell
npm run build
```

正式部署：

```powershell
npx wrangler deploy
```

Pushing to `main` deploys automatically through Cloudflare Workers Builds, so this manual step is only needed for a deploy that deliberately bypasses that pipeline.

D1 有新 migration 時：

```powershell
npx wrangler d1 migrations apply personal-site --remote
```

## 12b. 狀態檢查歷史與外部 uptime 監控（建議）

`/api/status` 每次真正執行 probe 時，最多每 5 分鐘寫入一筆 `status_checks`（migration `0009_status_checks.sql`，沒有 Cron Trigger），`/status` 會顯示過去 24 小時的檢查紀錄。回應本身在 Cloudflare 邊緣快取 30 秒；但快取內容只有共享的 probe 結果——`system.edge`（城市、地區、ISP 等）是每位訪客的 `request.cf` 資料，會在讀取快取之後用當前請求逐次重建，**不會**寫進快取，避免同一 Cloudflare colo 的其他訪客看到第一位訪客的位置。先在正式 D1 套用新的 migration，再部署：

```powershell
npx wrangler d1 migrations apply personal-site --remote
```

自我探測（Worker 自己執行 probe）只能看到「網站仍然處理到請求」與外部服務的狀態，**無法發現整個 Worker 或 Cloudflare 帳戶層面已經故障**。正式環境建議另外加一個外部 uptime 監控服務（Cloudflare 以外的獨立監控商，例如 UptimeRobot、Better Stack 等），對以下網址做 1–5 分鐘一次的檢查：

- `https://www.example.com/`（首頁 HTML）
- `https://www.example.com/api/status`（HTTP 200 且 JSON `ok: true`）

外部監控應只做被動 GET，不要帶任何 Cookie 或管理員憑證；`/api/status` 的回應已快取 30 秒，屬於低負載端點。監控服務本身要在 Cloudflare 以外，否則同一平台故障時兩邊會一起靜音。

### 部署後驗證邊緣快取

`src/lib/cached-json.ts` 寫入 `caches.default` 的副本使用 `Cache-Control: public, max-age=<TTL>`（Workers Cache 由 `Cache-Control` 決定存活時間；存成 `max-age=0` 可能被視為即時過期，令快取永遠不命中而不報錯）。回給瀏覽器時：不含 per-request 欄位的端點（`/api/activity`）是 `public, max-age=0, s-maxage=<TTL>`；有 `decorate` 的 `/api/status` 與 `/api/visitors` 因為含訪客位置／cookie 衍生欄位，對外標成 `private, max-age=0`，避免其他共享快取保存個人化資料（Worker 自己儲存的副本仍是 `public, max-age=<TTL>`）。回應同時帶 `x-cache: HIT|MISS` 作診斷（不含個人資料）。部署後在同一 Cloudflare colo 連續請求同一端點：

```powershell
curl.exe -s -D - -o NUL https://www.example.com/api/status | Select-String 'x-cache|cache-control'
# 30 秒內再跑一次：第二次應顯示 x-cache: HIT；不同 colo 首次仍是 MISS
```

```cmd
curl.exe -s -D - -o NUL https://www.example.com/api/status | findstr /i "x-cache cache-control"
```

這些驗證只在自訂網域（`www.example.com`）有效：`workers.dev` 上 Cache API 不運作（`caches.default` 為 no-op），會永遠看到 `MISS`。合併前亦請確認 Cloudflare Cache Rules 沒有對 `/api/*` 設定「Cache everything」，否則規則會蓋過 Worker 的 `Cache-Control`（包括 `private` 標記）。

若第二次長期是 `MISS`，先檢查是否被 `Cache-Control`、`Set-Cookie` 或 `Cache.put` 失敗影響（Worker 日誌有 `[cached-json]` 警告）。確認穩定後可保留或移除 `x-cache` 標頭。

## 13. 使用 Markdown 發布 Blog

Blog 已經改成 Astro Content Collections，不需要再修改 `src/lib/data.ts`。

新增文章：

```text
src/content/blog/my-new-post.md
```

最少需要：

```yaml
---
title: '文章標題'
description: '文章摘要'
pubDate: 2026-09-05
category: 'Development'
tags:
  - Astro
author: 'Your Name'
draft: false
---
```

正文直接使用 Markdown：

```markdown
## 小標題

這裡就是文章內容。

- 第一點
- 第二點
```

檔名會成為文章 slug：

```text
src/content/blog/my-new-post.md
↓
https://你的網域/blog/my-new-post
```

修改或新增文章後重新 build 並部署：

```powershell
npm run build
npx wrangler deploy
```

### 草稿

暫時不想公開的文章可以：

```yaml
draft: true
```

`draft: true` 不會出現在 Blog 列表，也不會產生公開文章路由。

### 更新日期

修改舊文章時可以加入：

```yaml
updatedDate: 2026-09-06
```

### 推薦的文章結構

大型文章可直接使用標題、列表、引用、程式碼區塊與圖片。圖片可以放在 `public/`，然後在 Markdown 使用：

```markdown
![描述](/images/example.png)
```

Markdown 內容由 Astro Content Collections 驗證 frontmatter，Blog 頁面會按 `pubDate` 由新到舊排序。

## 14. 安全標頭：CSP Report-Only、HSTS 與觀察期

### CSP Report-Only（#14）

Worker 回應的 HTML 會多一個 `Content-Security-Policy-Report-Only` 標頭（`src/middleware.ts` + `src/lib/csp-core.ts`）：

- 這是**觀察用**政策，不會封鎖任何請求。本專案沒有 `report-to` 收集端點，違規只會出現在瀏覽器 DevTools Console，不會送到伺服器。
- **不含 nonce**：所有可執行的 inline script 都已搬到 `public/scripts/*.js`，以同源檔案載入，所以 `script-src` 就是 `'self' https://challenges.cloudflare.com`（Turnstile）。`type="application/json"`／`application/ld+json` 的資料區塊不是可執行腳本，不受 `script-src` 約束。
- 原本已強制執行的 `frame-ancestors 'self'; object-src 'none'; base-uri 'self'` 標頭**保持不變**；Report-Only 政策不會取代或收緊它。
- 不要自行把 Report-Only 改成強制。先觀察至少一個部署週期，確認沒有預期外違規，再另開變更處理。
- 刻意**不啟用** Astro 7 內建的 `security.csp`：它只會輸出已強制的 `<meta http-equiv="content-security-policy">`（沒有 Report-Only 模式），而 meta CSP 會忽略 `frame-ancestors` 與回報指令，與本階段「先觀察、不強制」的要求相反。

**已知限制（重要）**：

- `export const prerender = true` 的頁面（首頁、`/privacy`、`/terms`、`/404`，以及所有文章／章節／wiki 詳情頁）由 ASSETS binding 在 `app.render` 之前直接回傳，`src/middleware.ts` 根本不會執行，所以**不會有這個 Report-Only 標頭**。這不再造成 `script-src` 缺口（頁面只載同源 `/scripts/*.js`），但若要強制執行，必須另外把完整政策送到這些頁面。
- `public/_headers` 只套用到靜態資產／prerendered HTML 的回應，可以承載靜態（無 nonce）的 `Content-Security-Policy`。因為政策已不含 nonce，之後強制執行時可以在 `/*` 區塊加一行完整政策；這會同時套用到 CSS/JS 等子資源回應，實作前要先確認沒有副作用。
- Swup 只替換 `<main>`；原本的 inline script 已全部改成外部檔。`<main>` 內的 `/scripts/toc.js`、`/scripts/reading-progress.js`、`/scripts/home-bootstrap.js`、`/scripts/status-panel.js` 由 `reloadScripts: true` 在換頁時重新執行；`<main>` 外的 `site-shell.js`、`theme-init.js`、`visit-beacon.js`、`lore-tooltip.js`、`markdown-enhance.js` 只載入一次，各自以 `data-swup-ignore-script` 或全域 guard 避免重複綁定。
- 因此下一步是：觀察 Report-Only 至少一個部署週期、確認沒有預期外違規，然後另開變更把政策改成強制執行（`Content-Security-Policy`），並同時補上 prerendered 頁面的靜態政策。不要直接把現有 Report-Only 標頭改名了事。

### HSTS（在 Cloudflare Dashboard 設定，不要寫進程式）

1. Cloudflare Dashboard → 你的 zone → SSL/TLS → Edge Certificates。
2. 開啟 **HTTP Strict Transport Security (HSTS)**。
3. 建議值：Max-Age 先設 6 個月（`15552000` 秒）或更長；`Include subdomains` 視實際子網域決定；`Preload` 先不要勾，確認沒有混合內容問題再考慮。
4. HSTS 由 edge 回傳，Worker 不應設定 `Strict-Transport-Security`——本程式碼刻意不設定它，重複或錯誤值反而難除錯。

### 觀察期檢查清單

- [ ] 以瀏覽器 DevTools Console 觀察 `Content-Security-Policy-Report-Only` 違規至少一個部署週期。
- [ ] 確認沒有預期外的 `script-src` / `connect-src` / `img-src` 違規（Turnstile、Lanyard WebSocket、Discord／Steam／Ko-fi／Liberapay 圖示、R2 圖片）。
- [ ] 確認 prerendered 頁面確實沒有此標頭（符合上述限制，不是部署錯誤）；同時確認它們的所有 `<script>` 都有 `src`。
- [ ] HSTS 已在 Cloudflare Dashboard 啟用並記錄日期；程式碼中沒有任何 HSTS 標頭。
- [ ] 觀察期結束後，另開變更把政策改成強制執行，並補上 prerendered 頁面的靜態政策；不要在觀察期內改動本政策。

## 15. 靜態資產路由與 Range（Safari 背景影片）

`wrangler.jsonc` 的 `assets.run_worker_first` 是一個**路由表**，不是「額外規則」：

```jsonc
"run_worker_first": [
  "/*",
  "!/_astro/*",
  "!/background.mp4",
  "!/background.webm",
  "!/easter.mp3"
]
```

- `/*` 讓所有文件頁與 API（包括 `/posts`、`/about`、`/status` 等 SSR 頁）照舊先經 Worker。**不要**把這一行拿掉或縮成只有 `/admin*` + `/api/*`：PR #9 就是這樣把 SSR 頁交給資產層，結果變成靜態 404。
- `!` 開頭的條目把符合的靜態檔案交回資產層（negative 規則優先於 `/*`）。目前只排除 build 產物 `/_astro/*` 與三個大型媒體檔。新增排除前必須確認該前綴永遠不會是 SSR 路由，否則該頁會被資產層遮蔽。
- 為何要排除：Worker 處理資產時，adapter 的 `matchStaticAsset` 會用裸 URL 重新向 `ASSETS` 取檔，丟掉客戶端的 `Range` 與 `If-None-Match`。影片的 range 請求因此回 `200` + 完整 7 MB，而不是 Safari `<video>` 需要的 `206 Partial Content`，也失去 `304`。交給資產層後 `Range`、`ETag`、`Cache-Control`、`Content-Type` 都由資產層與 `public/_headers` 直接提供。
- 這些被排除的路徑**不會**執行 `src/middleware.ts`，所以安全性標頭由 `public/_headers` 的 `/*` 規則補上；它們只是 build 產物與媒體檔，不含 HTML 文件。

部署後手動驗證（把網域換成正式站）：

```bash
curl -s -o /dev/null -D - -H "Range: bytes=0-1023" https://www.example.com/background.mp4
curl -s -o /dev/null -D - -H "Range: bytes=0-1023" https://www.example.com/background.webm
```

預期 `HTTP/2 206`、`content-range: bytes 0-1023/<size>`、`accept-ranges: bytes`。另外逐一確認 `/`、`/posts`、`/about`、`/status`、`/api/health`、`/admin/login` 與一個不存在路徑（應為 404）都正常；最後用 Safari 開首頁，確認背景影片可播放。

## 16. 不可見浮水印（建置期，證據而非防護）

`src/lib/watermark-plugin.mjs` 在 Markdown 轉成 HTML 時，對 `novel`、`dictionary`、`world` 三個集合的每個段落結尾標點之後，附加一組由 HMAC-SHA256(secret, `collection/id`) 前 32 bit 編碼的零寬字元（U+200B = 0、U+200C = 1）。同一章節的簽章固定，可重算比對。

- **密鑰**：建置環境變數 `WATERMARK_SECRET`，請在 Cloudflare Workers Builds 的 build variables 設定，永不提交。長隨機字串即可（例如 `openssl rand -base64 32`）。
- **未設定時**：建置不會失敗，只印一行 `[watermark] WATERMARK_SECRET is not set; skipping invisible watermarks.`，所有頁面照常輸出。CI 沒有這個變數，所以在 CI 會自然略過。
- 不修改儲存的 Markdown／CMS 內容；只影響該次渲染。`search-index.json`、RSS、OG、sitemap 都只讀 frontmatter，因此不會被污染。
- 每段落最多一組；3 段以上的內容只加在段落結尾標點之後（不會插入詞語中間，避免破壞尋找與斷詞）。少於 3 段的內容為確保至少一組，簽章會接在該段最後一個字之後，即使該段沒有終端標點。`markdown-sanitize` 是最後一個 hast 外掛，只過濾標籤與屬性，不會清掉文字節點，所以零寬字元會保留。
- **解碼**：`WATERMARK_SECRET=... node scripts/decode-watermark.mjs < suspicious.txt`（或把文字 pipe 進去）。它會掃描 `src/content/{novel,dictionary,world}` 的 id、重算簽章並列出符合的 `collection/id`；沒有符合時明說「未找到」。
- **誠實限制**：零寬字元很容易被手動或工具清除，少數編輯器／螢幕閱讀器也可能顯示或朗讀它們。它只能提供「可能的」來源證據，必須搭配 Git 提交時間、發布紀錄等其他證據；不能單獨證明抄襲。
