# 爬蟲政策與邊緣封鎖（Crawler Policy）

本文件說明 `fluentfolio` 的爬蟲政策：哪些內容公開、哪些只准搜尋引擎以外的人類讀者、`robots.txt` 由哪段程式產生，以及「真正擋住 AI 爬蟲」為何一定要在 Cloudflare 邊緣另設規則。

> 事實查核日期：2026-11-08。文中每一項非顯而易見的 Cloudflare 行為都附官方連結；未能從官方文件確認的項目一律標示「待確認」，不臆測。

## 目錄

- [1. 政策分層](#1-政策分層)
- [2. 程式實際做了什麼](#2-程式實際做了什麼)
- [3. 為何只有 robots.txt 不夠](#3-為何只有-robots-txt-不夠)
- [4. 必須在 Cloudflare 儀表板人手設定](#4-必須在-cloudflare-儀表板人手設定)
- [5. WAF 自訂規則範本](#5-waf-自訂規則範本)
- [6. 驗證方式與 curl](#6-驗證方式與-curl)
- [7. 收費（Pay Per Crawl）現況](#7-收費pay-per-crawl現況)
- [8. 待向 Cloudflare 確認](#8-待向-cloudflare-確認)
- [9. 參考資料](#9-參考資料)

## 1. 政策分層

分層的單一真相是 [`src/lib/crawl-policy.ts`](../src/lib/crawl-policy.ts)；`robots.txt`、內容 schema 與測試都從它推導。

| 分層      | 內容                                                                              | `robots.txt` 現況                           | 目標執行方式                          |
| --------- | --------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------- |
| `open`    | 首頁、`/posts`、部落格文章、`/about`、`/privacy`、`/terms`、小說第 1–3 章（試閱） | `Allow: /`；小說試閱另加精確 `Allow`        | 不封鎖                                |
| `paid`    | 保留給 Pay Per Crawl 的內容                                                       | 目前**與 `blocked` 完全相同**（`Disallow`） | 計劃核准後改為收費／HTTP 402          |
| `blocked` | `/world/*`、`/dictionary/*`、小說第 4 章起                                        | AI 群組 `Disallow` 前綴                     | Cloudflare WAF（必要時）＋ robots.txt |

`paid` 與 `blocked` 今天沒有任何行為差異。`src/lib/robots-txt.ts` 的註解已標明切換點；Pay Per Crawl 目前仍是封閉測試（見第 7 節），在計劃核准前不應假裝收費已生效。

### 1.1 最長匹配（longest match）

`robots.txt` 的 `Allow`／`Disallow` 不是「先寫先贏」，而是**最長匹配路徑優先**；長度相同時 `Allow` 優先。因此：

```text
Disallow: /posts/novel/            # 小說全部先擋
Allow: /posts/novel/chapter-1/     # 試閱章節較長，勝出
```

尾斜線是必要的：若寫成 `/posts/novel/chapter-1`，它同時是 `/posts/novel/chapter-10` 的前綴，會把第十章也放行。加上 `/` 之後，這條 `Allow` 只匹配該章自己的網址前綴；產生器就是這樣輸出的。

這也是為什麼產生器一定要把試閱章節的完整路徑逐條寫出來，而不能只寫 `Allow: /posts/novel/chapter-1$` 之類的正規表達式——`robots.txt` 的 `$` 與 `*` 支援度不一，精確路徑最可靠。

## 2. 程式實際做了什麼

- [`src/pages/robots.txt.ts`](../src/pages/robots.txt.ts)：`prerender = true`，建置時以 `getCollection` 讀取 `blog`／`novel`／`dictionary`／`world` 四個集合，映射成 `CrawlPolicyEntry` 後交給純函式產生器。回應型別 `text/plain; charset=utf-8`。
- [`src/lib/robots-txt.ts`](../src/lib/robots-txt.ts)：純函式 `buildRobotsTxt(entries)`。不匯入 Astro、不匯入 Cloudflare，所以 `node --test` 可以直接驗證輸出。
- `public/robots.txt` 已刪除。舊檔與新路由同時存在會產生兩個真相；現在唯一來源是建置產物。
- 草稿（`draft: true`）不會進入任何 `Allow`。`paid`／`blocked` 的內容會依 `AI_RESTRICTED_PREFIXES` 或其實際路徑被 `Disallow`。
- `User-agent: *` 群組維持 `Allow: /`、`Disallow: /admin`，並加上 Cloudflare 的 Content Signals：`search=yes, ai-train=no, ai-input=no`。
- 搜尋引擎（Googlebot、Bingbot、DuckDuckBot、Baiduspider、YandexBot 等）**永遠不會**出現在任何 `Disallow` 群組；`tests/robots.test.ts` 有對應斷言。

### 2.1 robots.txt 不是存取控制

`robots.txt` 是自願性標準（RFC 9309）。它只對「願意遵守」的爬蟲有效；惡意或不在乎聲譽的抓取者可以直接忽略。Content Signals 同理，它是宣告，不是封鎖。任何「已擋住 AI」的說法，都必須以邊緣規則或實際 403／402 回應為證，不能只拿 robots.txt 當證據。

### 2.2 AI crawler token 與依據

產生器中的名稱不是憑印象列出，逐個對照如下（存取日期 2026-11-08）：

| Token                | 類別               | 依據                                                                    |
| -------------------- | ------------------ | ----------------------------------------------------------------------- |
| `GPTBot`             | 訓練               | Cloudflare bot reference；OpenAI 官方頁讀取時被攔截，待確認             |
| `ChatGPT-User`       | 使用者觸發         | Cloudflare bot reference                                                |
| `OAI-SearchBot`      | AI 搜尋            | Cloudflare bot reference                                                |
| `ClaudeBot`          | 訓練               | Anthropic 官方 crawler 文件                                             |
| `Claude-User`        | 使用者觸發         | Anthropic 官方 crawler 文件                                             |
| `Claude-SearchBot`   | AI 搜尋            | Anthropic 官方 crawler 文件                                             |
| `anthropic-ai`       | 訓練（舊版）       | Anthropic 現行文件已改列 ClaudeBot 系列；保留作相容，待確認             |
| `PerplexityBot`      | AI 搜尋            | Perplexity 官方 crawler 文件                                            |
| `Perplexity-User`    | 使用者觸發         | Perplexity 官方 crawler 文件（明言使用者主動請求時一般忽略 robots.txt） |
| `Google-Extended`    | 訓練（控制 token） | Google 官方；沒有獨立 HTTP UA                                           |
| `Applebot-Extended`  | 訓練（控制 token） | Apple 官方；不自行抓取頁面                                              |
| `CCBot`              | 訓練               | Common Crawl 官方 `CCBot` 頁                                            |
| `Bytespider`         | 訓練               | Cloudflare bot reference（ByteDance 未見官方爬蟲頁）                    |
| `Meta-ExternalAgent` | 訓練               | Cloudflare bot reference（UA 為 `meta-externalagent`）                  |
| `Amazonbot`          | 訓練               | Cloudflare bot reference                                                |
| `cohere-ai`          | 訓練               | 找不到 Cohere 現行官方爬蟲頁；保留作 best-effort，待確認                |
| `Diffbot`            | 訓練               | Diffbot robots.txt FAQ（另有 `Diffbot-User`，本政策未列）               |

`Google-Extended` 與 `Applebot-Extended` 只存在於 robots.txt 的「控制」語義，邊緣 WAF 無法以 UA 辨識；`Perplexity-User` 的行為亦不受 robots.txt 保證。這三者在文件與程式註解中都已標明，避免把「寫了 robots.txt」誤當成「已封鎖」。

## 3. 為何只有 robots.txt 不夠

本站在 Astro 7 以 `output: 'server'` 部署到 Cloudflare Workers，但**首頁、文章、小說章節等頁面是 prerender 的靜態資產**：

- prerender 頁面在建置時就產生，請求時不經 `src/middleware.ts`，所以 Worker 內的路徑檢查、CSP、任何「依 User-Agent 判斷」的邏輯都不會執行。這一點在本倉庫的 [`DEPLOY-CLOUDFLARE.md`](../DEPLOY-CLOUDFLARE.md) §14 已有記錄。
- `public/_headers` 只能設定靜態標頭，不能依 `User-Agent` 分支。
- 因此，若要「真的」讓 AI 爬蟲拿不到 `/world/*` 等內容，唯一可行的位置是 **Cloudflare 邊緣的 WAF 自訂規則**（或 Bot Management 政策），而不是 Worker 程式。

一句話：**程式負責宣告政策，Cloudflare 邊緣負責執行政策。**

## 4. 必須在 Cloudflare 儀表板人手設定

以下設定**不在本倉庫的程式內**，也不應假裝已設定。請在部署後逐項核對。

### 4.1 AI Crawler and Agent access policies

官方文件：<https://developers.cloudflare.com/bots/additional-configurations/block-ai-bots/>（Last updated: 2026-11-02）

- 位置：**Security → Settings → 以 Bot traffic 篩選 → AI Crawler and Agent access policies**。
- 行為分類為 **Search**、**Agent**、**Training**；動作有 **Block**、**Block on pages with ads**、**Allow (do not block)**，以及只適用 Training 的 **Disallow**。
- 新網域預設三者皆為 **Allow**。也就是說，不進 dashboard 調整，AI 爬蟲就是被允許的。
- `Disallow`（Training）會寫入 robots.txt；若同時開啟 Bot Preference Sync，亦會在邊緣封鎖。混合型（同時搜尋與訓練）爬蟲會被排除在邊緣封鎖之外——細節以官方文件為準。

**建議**：Search 保持 Allow；Training 與 Agent 依本文件政策設為 Block 或 Disallow。設定後務必用第 6 節方式複驗，並在 Security → Analytics → Events 觀察是否誤傷 Googlebot。

### 4.2 Managed robots.txt（會改寫你送出的檔案）

官方文件：<https://developers.cloudflare.com/bots/additional-configurations/managed-robots-txt/>（Last updated: 2026-11-02）

- 只有在 **Enable Bot Preference Sync** 開啟，且至少一條 Search／Agent／Training 政策為 Block（或 Training 的 Disallow）時，Cloudflare 才會把你送出的 `robots.txt` **前面插入**託管指令與 Content Signals；全部 Allow 時原樣送出。
- 若站上沒有 `robots.txt`，Cloudflare 會代為建立；若已有 HTTP 200 的 `robots.txt`，則以「前置合併」方式處理。所有方案皆適用。
- 後果：**你以為的 robots.txt 可能不是最終送出的那份。** 上線後一定要 `curl` 取得實際內容，確認沒有重複或矛盾的群組。

### 4.3 Bot Fight Mode 與 Block AI Bots 的互動

官方文件：<https://developers.cloudflare.com/bots/get-started/bot-fight-mode/>（Last updated: 2026-08-03）

- Bot Fight Mode 是免費產品，會對疑似機器人發出高成本的挑戰。
- **它不能被 WAF 自訂規則或 Page Rules 跳過**：Skip／Bypass／Allow 在它所在的管線沒有作用。也就是說，若 Bot Fight Mode 誤挑戰正常流量，WAF 規則救不回來，只能關掉它。
- 它會自動啟用 JavaScript Detections 且無法停用；在 `script-src 'self'` 的 CSP 下可能出現 console 錯誤，必要時需允許 `/cdn-cgi/challenge-platform/`。
- 舊的「Block AI bots」開關已改由 4.1 的 AI Crawler and Agent access policies 管理。

**建議**：若啟用 Bot Fight Mode，必須在 Security → Analytics → Events（事件會標示 `Bot Fight Mode`）確認 Googlebot 等已驗證搜尋引擎未被挑戰。這是「確認 Googlebot 不受影響」的唯一實證方式，不能只看文件推論。

### 4.4 檢查清單

- [ ] AI Crawler and Agent access policies：Search 允許；Training／Agent 依政策設定。
- [ ] Bot Preference Sync：確認開啟或關閉的決定，並比對實際送出的 `robots.txt`。
- [ ] Bot Fight Mode：確認是否需要；若開啟，檢查 Events 有否誤傷搜尋引擎。
- [ ] `curl` 取得 `/robots.txt`，確認 `Content-Signal` 與 AI 群組存在且未被託管規則覆蓋成矛盾內容。
- [ ] 以 Google Search Console 的網址檢驗工具或實際日誌確認 Googlebot 仍可抓取。
- [ ] 在 Cloudflare Security Events 觀察 24 小時，再決定是否擴大封鎖範圍。

## 5. WAF 自訂規則範本

官方文件：<https://developers.cloudflare.com/waf/custom-rules/>（Last updated: 2026-10-16）

先確認方案限制，否則規則寫得再對也部署不了：

| 項目         | Free   | Pro    | Business | Enterprise |
| ------------ | ------ | ------ | -------- | ---------- |
| 自訂規則數量 | 5      | 20     | 100      | 1000       |
| `Log` 動作   | 不支援 | 不支援 | 不支援   | 支援       |
| Regex        | 不支援 | 不支援 | 支援     | 支援       |

因此範本刻意只用 `starts_with()`、`in {}` 與 `not (...)`，避免 Regex；`Log` 動作只有 Enterprise 可用，其他方案只能直接 Block（見 5.2）。若 Free 方案不接受 `cf.verified_bot_category`，改用後台的「Verified Bot」欄位（語意較粗，會一併匹配非 AI 的驗證機器人），或只依賴 robots.txt；不要把未經試存的欄位直接上線（見第 8 節第 6 點）。

### 5.1 表達式（Block）

在 **Security → WAF → Custom rules → Create rule → Edit expression** 貼上，並把三個試閱章節換成真實 slug：

```text
(starts_with(http.request.uri.path, "/posts/novel/")
 or starts_with(http.request.uri.path, "/world/")
 or starts_with(http.request.uri.path, "/dictionary/"))
and cf.verified_bot_category in {"AI Crawler" "AI Assistant" "AI Search"}
and not (http.request.uri.path in {"/posts/novel/chapter-1" "/posts/novel/chapter-2" "/posts/novel/chapter-3"})
```

- `cf.verified_bot_category` 是 Ruleset Engine 欄位，值為字串；合法的舊分類包括 `AI Crawler`、`AI Assistant`、`AI Search`、`Search Engine Crawler` 等。官方文件：<https://developers.cloudflare.com/bots/concepts/bot/verified-bots/>（Last updated: 2026-11-02）與 <https://developers.cloudflare.com/bots/reference/bot-management-variables/>（Last updated: 2026-09-16）。
- 2026-07-01 起的新行為分類（Search／Agent／Training……）**不是** WAF 欄位；請用上表的舊分類值。
- 這個條件只匹配**已驗證**機器人。未驗證、偽造 `User-Agent` 的請求不會被這條規則擋下——這正是 robots.txt 與 WAF 都只是「盡力而為」的原因。
- `Google-Extended` 與 `Applebot-Extended` 是**控制 token，不是 HTTP User-Agent**，邊緣規則無法單獨辨識它們；這兩個只能靠 robots.txt 表達意願。`Perplexity-User` 官方明言「使用者主動請求時一般會忽略 robots.txt」，其行為亦不能在邊緣以 robots.txt 證明。

### 5.2 Log 先行的 rollout

1. **Enterprise**：先把動作設為 `Log`，觀察 24–72 小時的 Security Events，確認命中的都是 AI 爬蟲、沒有搜尋引擎，再改成 `Block`。
2. **Free／Pro／Business**：沒有 `Log` 動作。先只把**單一前綴**（例如 `/world/`）設為 Block，觀察 Events 與站長工具 24 小時，確認無誤傷後才加入其餘前綴。
3. 任何時候都不要把 `cf.verified_bot_category` 的 `Search Engine Crawler` 放進封鎖條件。

## 6. 驗證方式與 curl

```bash
# 1. 實際送出的 robots.txt（含 Cloudflare 託管規則）
curl -sS https://www.example.com/robots.txt

# 2. 以 AI 爬蟲 UA 請求受限路徑
curl -sS -o /dev/null -w '%{http_code}\n' \
  -A 'GPTBot' https://www.example.com/world/

# 3. 以搜尋引擎 UA 請求同一路徑（應該維持可抓取）
curl -sS -o /dev/null -w '%{http_code}\n' \
  -A 'Googlebot' https://www.example.com/world/
```

**這些指令能證明什麼、不能證明什麼：**

- 能證明：`robots.txt` 的內容、伺服器對「這個 UA 字串」的回應碼、WAF 是否對來自你目前 IP 的請求生效。
- 不能證明：真實爬蟲的行為。`User-Agent` 可以任意偽造；`curl -A GPTBot` 不是 GPTBot，也不會帶有 Web Bot Auth 簽章，因此不會匹配 `cf.verified_bot_category`。封鎖是否真的擋住 OpenAI／Anthropic，只能看 Cloudflare 的 verified bot 日誌與實際流量。
- 也不能證明 robots.txt 被遵守——它本來就沒有強制力。

## 7. 收費（Pay Per Crawl）現況

官方文件（全部於 2026-11-08 讀取）：

- <https://developers.cloudflare.com/ai-crawl-control/features/pay-per-crawl/what-is-pay-per-crawl/>（Last updated: 2026-07-28）
- <https://developers.cloudflare.com/ai-crawl-control/features/pay-per-crawl/use-pay-per-crawl-as-site-owner/set-a-pay-per-crawl-price/>（Last updated: 2026-07-28）
- <https://developers.cloudflare.com/ai-crawl-control/features/pay-per-crawl/faq/>（Last updated: 2026-04-23）

已確認的要點：

- **目前是封閉測試（closed beta）**，需透過 <https://www.cloudflare.com/paypercrawl-signup/> 或 Enterprise 客戶經理申請。不是打開開關就能收費。
- 收費單位是**每個 zone 單一價格**，每次成功取得內容（HTTP 200）計費；可為不同爬蟲選 Block／Charge／Allow，但不能為不同爬蟲設不同價。最低價 **US$0.001／次**。
- 付款意向由爬蟲以請求標頭表達；未付款會收到 **HTTP 402 Payment Required**。Cloudflare 是 Merchant of Record。
- **WAF 或 Bot Management 的封鎖會覆寫收費**：被擋下的爬蟲不會取得內容，也不會被計費。所以「先 Block、之後改收費」必須調整邊緣規則，不能只改 robots.txt。
- 永遠免費的路徑：`/robots.txt`、`/sitemap.xml`、`/security.txt`、`/.well-known/security.txt`、`/crawlers.json`。
- 爬蟲必須以已 onboard 到 Cloudflare 的標準 UA，並透過 **Web Bot Auth** 識別；也就是說，收費只對「可識別、可驗簽」的爬蟲成立，對匿名抓取者無效。

本站在計劃核准前的做法：`paid` 分層照 `blocked` 處理，並在程式註解標明切換點；不把「未來可收費」寫成「現在已收費」。

## 8. 待向 Cloudflare 確認

以下問題官方文件未給出足夠明確的答案，或需要帳戶層級的確認，**不要當成事實對外宣稱**：

1. **按路徑定價**：文件提到 dynamic pricing 可為不同內容設不同價格，但具體能否以 URL 路徑為單位、規則如何設定，待確認。
2. **WAF 與計費的先後次序**：文件說 WAF／Bot Management 會覆寫 charge；但「已驗證爬蟲被 WAF 放行後，402 與計費的實際順序」仍需以 beta 文件或支援確認。
3. **收款帳戶與稅務**：payout 帳戶、結算幣別、稅務責任（Merchant of Record 下的實際流程）待確認。
4. **子網域資格**：啟用條件是網域使用 Cloudflare nameservers 或 DNS 由 Cloudflare 管理；`www.example.com` 這類子網域是否符合 beta 資格，待確認。
5. **beta 准入**：一般方案能否加入、審核標準與等待時間，待確認。
6. **Free 方案的 WAF 欄位**：官方可用性表只寫「Verified Bot」；Free 方案的自訂規則是否接受 `cf.verified_bot_category`（以及後台欄位實際編譯成哪個名稱）尚未證實。上線前請在後台以草稿規則試存，失敗就不要把該欄位放進正式規則。

## 9. 參考資料

所有連結的最後存取日期均為 **2026-11-08**。

- Content Signals Policy：<https://blog.cloudflare.com/content-signals-policy>
- Managed robots.txt：<https://developers.cloudflare.com/bots/additional-configurations/managed-robots-txt/>
- AI Crawler and Agent access policies：<https://developers.cloudflare.com/bots/additional-configurations/block-ai-bots/>
- Verified bots（分類值）：<https://developers.cloudflare.com/bots/concepts/bot/verified-bots/>
- Bot Management variables：<https://developers.cloudflare.com/bots/reference/bot-management-variables/>
- WAF Custom rules（方案限制）：<https://developers.cloudflare.com/waf/custom-rules/>
- Bot Fight Mode：<https://developers.cloudflare.com/bots/get-started/bot-fight-mode/>
- Pay Per Crawl：<https://developers.cloudflare.com/ai-crawl-control/features/pay-per-crawl/what-is-pay-per-crawl/>
- AI Crawl Control bot reference（UA 對照）：<https://developers.cloudflare.com/ai-crawl-control/reference/bots/>
- OpenAI crawler 文件：<https://platform.openai.com/docs/bots>（讀取時被 Cloudflare 攔截，UA 名單以 Cloudflare bot reference 為準，待確認）
- Anthropic crawler 文件：<https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler>
- Perplexity crawler 文件：<https://docs.perplexity.ai/docs/resources/perplexity-crawlers>
- Google common crawlers（含 `Google-Extended`）：<https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers>
- Applebot 與 `Applebot-Extended`：<https://support.apple.com/en-us/119829>
- Common Crawl `CCBot`：<https://commoncrawl.org/ccbot>
- Diffbot robots.txt 說明：<https://www.diffbot.com/docs/crawl/faq/robots-txt>
