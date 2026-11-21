# 抄竊防護與授權（COPY-PROTECTION）

本文件記錄本站處理「內容被複製、轉載或大量抓取」的**分層**做法與操作步驟，供日後維護與交接使用。對外承諾一律以 [`src/pages/terms.astro`](../src/pages/terms.astro)（`/terms`）與各頁面自帶的授權標示為準；本文件不構成額外承諾。

這些措施互相補位，但**不構成任何保證**：它們只能提高抄竊的成本、留下可追溯的線索、讓授權與追究有依據。它們不能讓內容「無法複製」或「完全受保護」——任何送到瀏覽器的文字，技術上都可以被保存；任何公開頁面，也都可以被人工重打一遍。實際可用的能力以 Cloudflare 方案與當下後台為準，本文件引用的方案限制皆取自官方文件並標明查閱日期，未能證實的一律標為「待確認」。

分層如下：

- **阻嚇**：複製保護（`src/lib/copy-protection.ts`），讓「直接複製貼上」多一點摩擦。
- **標示**：頁尾的 CC BY-NC-ND 4.0、條款頁的版權與授權說明，讓授權範圍與署名要求有明文依據。
- **證據**：水印解碼、原始檔與 commit 記錄、發佈時間對照，用於日後比對與投訴。
- **法律**：授權申請、侵權通知與平台投訴流程。
- **限流**：Cloudflare WAF 速率限制規則，攔截短時間內的高頻抓取。

## 各層措施總表

| 措施             | 實作位置                                                                                                                                                      | 生效範圍                                                                            | 擋得住什麼／擋不住什麼                                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 複製防護＋出處   | `src/lib/copy-protection.ts`、`public/scripts/copy-guard-core.js`、`public/scripts/copy-guard.js`、`src/styles/reading.css`、三個詳情頁的 `data-copy-protect` | 小說、世界觀、詞典詳情頁；可用 frontmatter `copyProtect` 逐篇覆寫；部落格預設不保護 | 擋：滑鼠拖曳選取、右鍵選單、拖放。當選取仍包含保護文字時（例如部分瀏覽器或輔助技術），複製內容會被改寫為最多 120 字＋出處；Chromium 的實際可達性見下一節。不擋：檢視原始碼、閱讀模式、停用 JS、截圖 OCR、人工重打。 |
| 頁面標示與條款   | `src/pages/terms.astro`、`src/i18n/ui.ts`                                                                                                                     | 全站；`/terms` 的「版權與授權」一節                                                 | 明示授權範圍與引用上限；屬法律與溝通層，不是技術限制。                                                                                                                                                              |
| 不可見水印       | `src/lib/watermark-core.mjs`、`src/lib/watermark-plugin.mjs`、`astro.config.mjs`、`scripts/decode-watermark.mjs`                                              | 建置時寫入小說、世界觀、詞典正文的輸出 HTML；不改儲存的 Markdown                    | 提供「可能的」來源證據，可證明某一頁的段落曾被複製。不擋：零寬字元可被清除，少數工具可能顯示或朗讀。                                                                                                                |
| robots.txt 分級  | `src/lib/robots-txt.ts`、`src/pages/robots.txt.ts`、`src/lib/crawl-policy.ts`                                                                                 | 對自願遵守 robots.txt 的爬蟲；搜尋引擎維持可抓                                      | 擋：合規的 AI 爬蟲依規則避開 blocked 路徑。不擋：不遵守的爬蟲、假冒 User-Agent、已抓取的內容。                                                                                                                      |
| WAF 速率限制     | Cloudflare 後台手動設定（本文件下方範本）                                                                                                                     | 三個文件前綴；需在後台建立規則                                                      | 擋：短時間內同 IP 的高頻抓取。不擋：慢速、分散式、換 IP 的抓取。                                                                                                                                                    |
| 邊緣 AI 爬蟲政策 | Cloudflare 後台 **Security → Settings → filter Bot traffic → AI Crawler and Agent access policies**                                                           | 全站；需在後台手動設定                                                              | 邊緣封鎖已驗證的 AI 爬蟲與訓練用途；對未驗證或偽裝的流量有限。細節與方案限制見 `docs/CRAWLER-POLICY.md`。                                                                                                           |

## 無障礙與使用體驗取捨

- 正文沒有被移出 DOM：沒有 `aria-hidden`，沒有改成圖片／canvas／偽元素，沒有攔截 `selectstart`，沒有禁用列印（`reading.css` 沒有 `@media print` 規則），也沒有攔截鍵盤快捷鍵。
- `user-select: none` 的實際影響：滑鼠無法在保護區內選取文字（這是目的）；螢幕閱讀器、瀏覽器翻譯與閱讀模式仍可讀取 DOM 文字。在 Chromium 實測中，連 `Ctrl+A` 也不會把保護正文納入選取，所以對保護正文而言，主要效果是「選不到」，剪貼簿改寫通常不會觸發。若某些瀏覽器或輔助技術仍產生包含保護文字的選取，`copy` 事件的處理器會把它改寫成 120 字＋出處；這是防禦縱深，不是保證會發生的路徑。
- 選取完全落在 `[data-copy-allow]`（或表單控制項、`[contenteditable]`）內時，`copy` 處理器不介入，維持原本的複製內容；跨出該範圍的選取則照保護規則改寫。
- 表單、輸入框、`[contenteditable]` 與 `[data-copy-allow]` 內的文字維持可選取；部落格頁完全不受影響；程式碼區塊的複製按鈕（`markdown-enhance.js`）走自己的剪貼簿路徑，不受複製防護改寫。
- 沒有新增「已複製摘要」的 toast 或 live region：專案目前沒有可重用的非阻塞提示元件，為避免新增元件與 i18n 鍵，這次只改寫剪貼簿內容。
- 已知代價：保護區內無法用滑鼠選取去「搜尋選取文字」或自行引用；Chromium 的鍵盤全選也不會帶入保護正文。需要引用時請改用閱讀模式、瀏覽器翻譯，或直接查看原始碼。
- 尚未實測：螢幕閱讀器實機（NVDA／VoiceOver）、Safari、Firefox。已實測的瀏覽器見下一節。

## 已驗證項目

| 日期       | 環境                                                        | 操作                                                                                                                  | 結果                                                                                                                                                                                                                                                                       |
| ---------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-08 | Chromium 1228（Playwright，headless）                       | 小說詳情頁：拖曳選取、右鍵、拖放、跨保護區的程式化選取後複製、`Ctrl+A`、部落格對照、程式碼複製按鈕、Swup 換頁、搜尋框 | 拖曳選不到、右鍵與拖放被擋；跨保護區的選取經 `copy` 處理器改寫為 120 字＋出處（209 字元）；`Ctrl+A` 在 Chromium 不納入保護正文（另行以相同 Chromium 重現）；部落格可正常複製、程式碼按鈕正常、Swup 換頁後防護仍在、主控台 0 錯誤。腳本未提交，重跑需自備 Playwright 腳本。 |
| 2026-11-08 | Node 22.23.4                                                | `node --test tests/copy-guard-core.test.ts`                                                                           | 6/6 通過（截斷、0 字、CJK／換行、空選取、自訂授權、預設標題）。                                                                                                                                                                                                            |
| 2026-11-08 | Node 22.23.4，`WATERMARK_SECRET=probe-secret`，臨時測試條目 | 建置後檢查輸出 HTML、以 `scripts/decode-watermark.mjs` 解碼                                                           | 3 段正文各插入 1 組 32 位元零寬簽章；解碼回報 `novel/<id>`；未設定 secret 時建置成功並印出略過警告。                                                                                                                                                                       |

## 調整 `COPY_MAX_CHARS`

- 常數在 `src/lib/copy-protection.ts`，目前為 `120`；`0` 代表完全不保留內文，只輸出出處。
- 三個詳情頁把常數寫進 `data-copy-max`，`/terms` 透過 `data-i18n-args` 帶入同一數字，所以文案與行為不會各說各話。
- 改動後依序跑 `npm run check`、`npm run check:public`、`npm test`、`npm run build`，並重新跑一次瀏覽器檢查。
- 這個數字是站內政策參考值，不是法律界線；不要把它寫成「超過即侵權」之類的判斷。

## 逐篇覆寫 `copyProtect` 與 `crawl`

- `copyProtect`：布林，選填。未設定時，`novel`／`dictionary`／`world` 預設受保護，`blog` 預設不保護；設 `false` 可讓單篇小說或世界觀頁恢復一般選取。
- `crawl`：`open`／`paid`／`blocked`，選填。未設定時，`blog` 為 `open`、小說前 3 章（`NOVEL_TRIAL_CHAPTERS`）為 `open`、其後章節與 `dictionary`／`world` 為 `blocked`；`paid` 目前行為與 `blocked` 相同，待 Pay Per Crawl 核准後再切換。
- 兩個欄位都寫在內容檔的 frontmatter；CMS 端接受布林或 `'true'`／`'false'` 字串，儲存時會原樣保留，但後台表單沒有這兩個欄位（需直接改 frontmatter）。
- 單篇覆寫不影響 robots.txt 的產生：robots 仍以建置時的內容集合與 `crawl` 值為準。

## 關閉水印

- 水印在建置時由 `src/lib/watermark-plugin.mjs` 寫入；沒有 `WATERMARK_SECRET` 時只印一行警告並略過，不會讓建置失敗。
- 要暫時關閉：從 Cloudflare Workers Builds 的建置變數移除 `WATERMARK_SECRET`，或在本機建置時不設該變數。要永久移除：把 `createWatermarkPlugin()` 從 `astro.config.mjs` 的 `mdastPlugins` 陣列拿掉。
- 關閉只影響之後的建置；已產生的 HTML 仍帶著舊水印，直到重新建置與部署。儲存的 Markdown、`/search-index.json`、RSS、OG 圖與 sitemap 都沒有被寫入水印。

## Cloudflare 速率限制規則範本

這一節只處理**文件頁**（`/posts/novel/*`、`/world/*`、`/dictionary/*`）的單一 IP 限流。`/posts`、`/about`、`/status` 等 SSR 頁與 `/api/*` 不在本節範圍；API 的限流仍由 `wrangler.jsonc` 的 `ratelimits` binding 在 Worker 內處理。

### 為何用 WAF 規則，而不是 Worker 的 `ratelimits` binding

`/posts/novel/<slug>`、`/world/<slug>`、`/dictionary/<slug>` 都是 `export const prerender = true` 的頁面：它們由 adapter 在 `app.render` 之前直接向 `ASSETS` 取檔回傳，`src/middleware.ts` 與頁面路由程式都不會執行（見 [`DEPLOY-CLOUDFLARE.md`](../DEPLOY-CLOUDFLARE.md) §14、§15）。而 Workers 的 Rate Limiting API 只有在 Worker 程式碼實際呼叫 `env.BINDING.limit({ key })` 時才生效（[Cloudflare：Rate Limiting（Workers）](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)，查閱 2026-11-08；頁面標示最後更新 2026-10-21）。本專案只有 `/api/*` 會呼叫那三個 binding，文件頁沒有任何呼叫點；要在文件頁加 Worker 端限流，等於要改寫 adapter 入口或加一層 wrapper，而那會把 §15 已解決的 `Range`／`ETag` 問題帶回來。

因此文件頁的限流只能交給 **Cloudflare WAF 的速率限制規則**：它在資產層之前、與 Worker 是否執行無關。

### 方案限制（官方可用性表）

以下數字取自 [Cloudflare：Rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/) 的可用性表（查閱 2026-11-08；頁面標示最後更新 2026-08-25）：

| 項目           | Free               | Pro                                            | Business                               | Enterprise                                 |
| -------------- | ------------------ | ---------------------------------------------- | -------------------------------------- | ------------------------------------------ |
| 規則數量       | 1                  | 2                                              | 5                                      | 100                                        |
| 可用運算式欄位 | Path、Verified Bot | Host、URI、Path、Full URI、Query、Verified Bot | 上述再加 Method、Source IP、User Agent | 更廣（含 Bot Management、header、body 等） |
| 計數特徵       | IP                 | IP                                             | IP、IP（支援 NAT）                     | 多種                                       |
| 計數期間       | 僅 10 秒           | 最長 1 分鐘                                    | 最長 10 分鐘                           | 最長 65,535 秒                             |
| 緩解時間       | 僅 10 秒           | 最長 1 小時                                    | 最長 1 天                              | 更長                                       |
| 自訂計數運算式 | 不支援             | 不支援                                         | 支援                                   | 支援                                       |
| 排除快取資產   | 不支援             | 不支援                                         | 支援                                   | 支援                                       |
| 自訂封鎖回應   | 不支援             | 支援                                           | 支援                                   | 支援                                       |

兩個對本站影響最大的限制：

- **Free 只有 1 條規則**，所以三個前綴必須用 `or` 併在同一條運算式裡，且三個前綴共用同一個門檻。
- **Free 的計數期間與緩解時間都固定 10 秒**，只能攔「10 秒內的高頻」，攔不到「每 10 秒抓一次」的慢速爬蟲。

另外，Free／Pro 的方案在後台不能排除快取資產（官方參數說明：`requests_to_origin` 的可用性依方案而定，未提供時 Cloudflare 預設對快取資產也套用規則；見 [Rate limiting parameters](https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/)，查閱 2026-11-08，最後更新 2026-11-04）。這對本範本反而有利：命中快取的文件頁請求照樣計數，爬蟲快取與否都逃不掉；而運算式只匹配三個文件前綴，所以 `/_astro/*`、`/og/*`、`/search-index.json` 與其他子資源不會被計數。

### 規則運算式（完整版）

單一規則、三個前綴，貼進 Security rules → Create rule → Rate limiting rules 的運算式欄位：

```text
(starts_with(http.request.uri.path, "/posts/novel/") or
 starts_with(http.request.uri.path, "/world/") or
 starts_with(http.request.uri.path, "/dictionary/"))
```

- 用 `starts_with()` 函式而非 `wildcard` 運算子：後台會把「starts with」編譯成這個函式，而 `matches` 運算子需要 Business 或以上方案（[Rules language operators](https://developers.cloudflare.com/ruleset-engine/rules-language/operators/)，查閱 2026-11-08，最後更新 2026-10-01）。若你的後台版本提供等價的 `wildcard` 寫法且方案允許，語意相同，但仍以實際後台可存檔的寫法為準。
- 運算式只匹配文件頁；`http.request.uri.path` 不含查詢字串，所以 `/posts/novel/x?utm=…` 也會匹配，這是預期行為。
- 計數特徵選 **IP**（`ip.src`）。Free 方案只有這一個選項，不需要也不能設定自訂計數運算式。

### 建議起始門檻與上線流程

以下門檻都以「每個 IP、每 10 秒的文件請求數」表示，因為 Free 方案的計數期間固定 10 秒。數字是**起始建議值，未經本站流量實測**（見下方待確認清單），上線後要用 Security Events 與讀者回報修正。

| 階段    | 動作       | 門檻（每 IP／10 秒） | 建議觀察期 | 目的                                                      |
| ------- | ---------- | -------------------- | ---------- | --------------------------------------------------------- |
| 1. 基線 | 先不建規則 | —                    | 1 週       | 從 Security Analytics／存取紀錄看正常讀者與已知爬蟲的分佈 |
| 2. 寬鬆 | Block      | 60                   | 1 週       | 只攔明顯異常；確認沒有正常讀者中招                        |
| 3. 收窄 | Block      | 30                   | 3–7 天     | 逐步靠近實際需要                                          |
| 4. 目標 | Block      | 20                   | 持續       | 日常運作值；每次改動後重看 Security Events                |

注意「Log 再 Block」在 Free／Pro 上做不到：規則動作裡的 **Log 只提供 Enterprise 方案**（[Rules language actions](https://developers.cloudflare.com/ruleset-engine/rules-language/actions/)，查閱 2026-11-08，最後更新 2026-04-23）。替代做法是：

1. 第一週先完全不建規則，只用 Security Analytics 建立基線。
2. 第二週用「寬鬆門檻 + Block」上線，把它當成事實上的觀察階段：Block 在速率限制規則中回 HTTP 429，被攔的請求會出現在 Security Events，可以逐筆回看是否符合預期。
3. 確認沒有誤傷後才收窄門檻；每次只改一個階段，保留至少 3 天觀察期。
4. 若某段時間誤傷明顯（例如發佈新章後的讀者潮），可暫時把動作改為 Managed Challenge 或把門檻調回上一階段，而不是直接停用規則。

### 不傷搜尋引擎與快速翻頁讀者

- **搜尋引擎**：Cloudflare 官方提醒，對 Verified Bots 套用速率限制**可能影響 SEO**（同上的 Rate limiting rules 頁面；另見 [Improve SEO](https://developers.cloudflare.com/fundamentals/performance/improve-seo/)，查閱 2026-11-08，最後更新 2026-04-20：「Rate limiting rules are allowing Verified Bots」）。若方案與欄位允許，應在運算式加上排除條件；但 Free 方案是否接受 `cf.verified_bot_category`（或後台「Verified Bot」欄位對應的底層名稱）**尚待確認**，在證實前不要把未經驗證的欄位寫進正式規則——存檔失敗還算好，默默不匹配更難發現。實務上的替代保護是：門檻不要低於正常爬蟲的抓取節奏，上線後在 Search Console 觀察抓取統計；若發現 crawler 經常收到 429，就把門檻調回上一階段。
- **快速翻頁讀者**：本站啟用 Swup 的 `preload: { hover: true, visible: true }`（`astro.config.mjs`），滑過或看見章節連結就會預取，快速翻頁時同一個 IP 可能在 10 秒內產生數個文件請求。這是把目標門檻放在 20 而不是 5 的主要原因；若日後關閉 preload，可以再收窄。NAT／校園網路／手機電信網路後方多人共用同一出口 IP，也會放大誤傷風險——這也是 Free 方案（只有 IP 計數）最大的弱點。
- **不要**把 `/`、`/_astro/*`、`/og/*`、`/search-index.json` 納入運算式；一次頁面瀏覽會抓數十個子資源，納入後門檻會變得沒有意義，且整站都可能被誤鎖。

### 已知限制與陷阱

- **計數不精確**：官方原文說明速率限制「不是設計來讓精確數量的請求到達 origin」，計數器更新可能延遲數秒，超過門檻的請求仍可能在封鎖生效前到達（Rate limiting rules 頁面，查閱 2026-11-08）。
- **各數據中心各自計數**：Cloudflare 不提供跨整個網路的全域計數器，每個資料中心維護自己的計數（[Request rate](https://developers.cloudflare.com/waf/rate-limiting-rules/request-rate/)，查閱 2026-11-08，最後更新 2026-04-16）。分散式爬蟲（多 IP、多地區）幾乎不會被單一規則擋住。
- **路徑正規化差異**：origin 與 Cloudflare 對路徑的正規化／解碼可能不同，改寫過的路徑有機會繞過 path 規則；上線前先確認 zone 的 URL normalization 設定（[Best practices](https://developers.cloudflare.com/waf/rate-limiting-rules/best-practices/)，查閱 2026-11-08，最後更新 2026-10-23）。
- **429 的成本很低**：Free 方案的緩解時間固定 10 秒，換個 IP 或等 10 秒就過去；本節的規則只能降低「無腦高速抓取」的效率，對有資源的抄襲者幾乎沒有嚇阻力。
- **只保護 HTTP 路徑**：已被下載、截圖或人工重打的內容不受任何限流影響。

### 待確認

1. Free 方案是否接受 `cf.verified_bot_category`（或後台「Verified Bot」欄位對應的底層運算式名稱）用於速率限制規則——官方可用性表只寫「Verified Bot」，API 欄位名未經證實。
2. 後台選單與欄位名稱（「Security rules」→「Rate limiting rules」、計數特徵與期間的呈現方式）可能隨版本不同，以實際後台為準。
3. 上表的 60／30／20 門檻是起始建議，尚未用本站流量驗證；需要至少一週基線資料才能定案。
4. 若日後要對 `/_astro/*` 或媒體檔限流，需先確認不會破壞 Safari 的 `Range` 行為與快取（見 `DEPLOY-CLOUDFLARE.md` §15）。

## 抄竊發現後的處理流程

以下只是操作步驟，不是法律意見。實際個案（尤其是跨境平台、合理使用／公平處理、平台責任）應諮詢熟悉香港《版權條例》（第 528 章）的專業人士。

### 1. 先判斷性質，再決定要不要動作

先分清三種情況：（a）**有授權的轉載**——頁尾或該頁明文標示 CC BY-NC-ND 4.0，或曾個別授權；（b）**合理引用**——短引用、有署名、用於評論或介紹，落在本站 `/terms` 說明的容許範圍內；（c）**未授權的全文／大段轉載、改作或商業使用**。只有 (c) 才進入以下流程；(a)(b) 不需要處理，也不要公開指控。

### 2. 先保全證據，再通知對方

通知一旦送出，對方可能立刻修改或刪除內容，所以證據要在最前面保存：

1. 對侵權頁面做**完整頁面存檔**：瀏覽器「另存頁面」保存原始 HTML 與資源、整頁截圖（含網址列與系統時間）、輸出 PDF；必要時用 Internet Archive 的 Save Page Now 留一份第三方快照。
2. 記錄**雙方發佈時間**：對方頁面的發佈／更新時間、你自己的 commit 時間（`git log --follow -- <檔案>`）與首次上線時間。
3. 保存**比對材料**：逐段並列的文字對照、相同錯字／標點／自訂名詞（例如本站在用的世界觀專名）、相同排版特徵。計算重疊篇幅，區分「相同段落」與「相同主題」。
4. 為所有檔案計算雜湊（`sha256sum`）並與截圖一起存放，日後可證明檔案未被替換。

### 3. 解碼水印（若內容含本站水印）

解碼工具是 `scripts/decode-watermark.mjs`，需要與建置時相同的 `WATERMARK_SECRET`。它會走訪 `src/content/{novel,dictionary,world}` 的所有條目，重算 HMAC 簽章並比對文字中的零寬字元序列；只含其中一段的局部複製也能比對出來。

```bash
# 先確認 secret 與 Workers Builds 建置變數一致
export WATERMARK_SECRET='<建置時使用的值>'
node scripts/decode-watermark.mjs < suspect.txt
```

Windows 的 PowerShell 管線在把文字送進原生程式時可能丟失 U+200B／U+200C；請先把可疑文字存成 UTF-8 檔，再用 `cmd /c "node scripts/decode-watermark.mjs < suspect.txt"` 或直接以檔案重定向執行。

1. 從侵權頁面取得原始文字或圖片（優先原始 HTML／原圖，不要只留截圖；截圖與圖片壓縮會丟失零寬字元）。
2. 執行上述指令，輸出會列出符合的 `collection/id`（例如 `novel/chapter-1`）或「未找到」。把輸出與第 2 步的證據放在同一目錄。
3. 若沒有符合項，改用替代證據：內容中的唯一字串、自訂專名、錯字、排版特徵，以及「對方頁面出現本站才有的內部連結或圖片路徑」。這類替代證據要在紀錄中標明是間接比對，不要寫成水印已解碼。
4. 水印只是「可能的」證據：零寬字元可能被對方清除或工具改寫，單靠水印不足以證明整篇來源；應與 commit 時間、發佈時間、其他文字特徵一起使用。

### 4. 通知平台與主機

1. **先直接聯絡**（若能找到可用的聯絡方式）：簡短說明涉及頁面、要求移除或補上署名與授權，給一個合理期限。保留寄件備份。
2. **平台投訴**：依各平台公告的著作權／侵權投訴流程提交（GitHub、Medium、方格子、Facebook、Telegram 頻道等各有不同表格與要求），附上第 2 步的證據、雙方網址、你的權利說明，以及「該內容未採 CC 授權或超出授權範圍」的說明。不要捏造授權狀態。
3. **主機／CDN 投訴**：若對方是自架網站，查 WHOIS 或網站頁尾找到主機商，向其 abuse 信箱提交同樣材料；投訴信要說明具體 URL 與侵權段落，不要只寫「他抄我」。
4. **本地途徑**：香港的個案可考慮先諮詢律師，了解是否適合向香港海關（負責版權刑事執法）或相關機構查詢；是否構成侵權、是否值得報案，屬專業判斷。

### 5. 記錄與後續

1. 建一份事件紀錄：發現日期、來源 URL、證據檔案路徑、通知日期與對象、回覆、處理結果（已下架／已補署名／無回應）。放在不公開的位置。
2. 同一來源重複出現時，累積紀錄再處理；不要在新聞稿或社交平台公開指名未經證實的抄竊者，避免誹謗與隱私風險。
3. 事件結束後回頭檢查防護是否要調整：限流門檻、`copyProtect`、水印參數、robots／`crawl` 層級。調整後更新本文件與 `DEPLOY-CLOUDFLARE.md` 的相關章節。

### 建議諮詢專業意見

本文件是站內的操作筆記，不是法律意見，也不構成對任何個案勝負的判斷。涉及授權範圍、合理使用／公平處理、跨境管轄、平台責任或索償金額時，建議諮詢專業意見（律師或相關機構），再決定是否採取法律行動。

## 參考資料

- [Cloudflare：Rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)（查閱 2026-11-08；最後更新 2026-08-25）
- [Cloudflare：Rate limiting parameters](https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/)（查閱 2026-11-08；最後更新 2026-11-04）
- [Cloudflare：Request rate](https://developers.cloudflare.com/waf/rate-limiting-rules/request-rate/)（查閱 2026-11-08；最後更新 2026-04-16）
- [Cloudflare：Rate limiting best practices](https://developers.cloudflare.com/waf/rate-limiting-rules/best-practices/)（查閱 2026-11-08；最後更新 2026-10-23）
- [Cloudflare：Create a rate limiting rule in the dashboard](https://developers.cloudflare.com/waf/rate-limiting-rules/create-zone-dashboard/)（查閱 2026-11-08；最後更新 2026-08-03）
- [Cloudflare：Rules language actions](https://developers.cloudflare.com/ruleset-engine/rules-language/actions/)（查閱 2026-11-08；最後更新 2026-04-23）
- [Cloudflare：Rules language operators](https://developers.cloudflare.com/ruleset-engine/rules-language/operators/)（查閱 2026-11-08；最後更新 2026-10-01）
- [Cloudflare：Rate Limiting（Workers binding）](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)（查閱 2026-11-08；最後更新 2026-10-21）
- [Cloudflare：Improve SEO](https://developers.cloudflare.com/fundamentals/performance/improve-seo/)（查閱 2026-11-08；最後更新 2026-04-20）
