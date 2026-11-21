# 線上 CMS + R2 圖床 + Discord 通知：設定步驟

程式碼已經寫好了。這份文件列出**你需要自己去申請/設定的東西**,照順序做完,CMS 就能用。

---

## 1. Cloudflare R2(圖床)

```bash
npx wrangler r2 bucket create blog-images
```

然後到 Cloudflare Dashboard → R2 → `blog-images` → Settings → **Custom Domains** → 新增一個子網域(例如 `img.yourdomain.com`),等待它顯示為 Active(通常幾分鐘內,因為同帳號網域,DNS/憑證是自動的)。

拿到網域後,打開 `wrangler.jsonc`,把這一行改成你實際的網域:

```jsonc
"R2_PUBLIC_BASE_URL": "https://img.yourdomain.com/"
```

**別忘了設定帳單警示**(先前討論過的防呆):Dashboard → Billing → Notifications → 新增一個 R2 storage 用量警示(例如 8GB 門檻)。

---

## 2. GitHub Fine-grained Token(讓 CMS 能 commit 文章)

1. 前往 <https://github.com/settings/tokens?type=beta> → **Generate new token**
2. Resource owner:你的帳號
3. Repository access:**Only select repositories** → 勾這個 repo(不要選全部)
4. Permissions → Repository permissions → **Contents: Read and write**(其他權限都不用開)
5. Expiration:建議設 90 天,到期前記得換新的
6. 產生後複製 token(只會顯示一次)

存成 Worker secret:

```bash
npx wrangler secret put GITHUB_TOKEN
# 貼上剛才複製的 token
```

同時把 `wrangler.jsonc` 裡的 `GITHUB_REPO` 改成你實際的 `"你的帳號/你的倉庫"`（預設 `"your-name/fluentfolio"`）。如果你把文章放在獨立的私有倉庫（選用，見 [docs/PRIVATE-CONTENT-REPO.md](docs/PRIVATE-CONTENT-REPO.md)），這裡與上面第 3 步都改選內容倉庫。

---

## 3. Discord Webhook(發布通知)

1. 到你要收通知的頻道 → 編輯頻道 → **整合** → **Webhook** → 新增 Webhook
2. 取個名字(例如「部落格發布通知」),複製 **Webhook URL**

```bash
npx wrangler secret put DISCORD_BLOG_WEBHOOK_URL
# 貼上 Webhook URL
```

---

## 4. 後台密碼與 Session 簽章密鑰

兩個都是「你自己決定的隨機字串」,不是去哪裡申請的東西:

- **ADMIN_PASSWORD**:備用密碼登入方式使用。若已登記多把 Passkey，仍可保留此密碼作為復原方式；只有在明確接受「只能用 Passkey 登入」的風險後才移除。建議使用密碼管理器產生 20 字元以上的隨機密碼。
- **ADMIN_SESSION_SECRET**:網站登入 Session 及 WebAuthn challenge cookie 的簽章密鑰，Passkey 和密碼登入都必須有它。可以用 `openssl rand -base64 32` 產生；不要放入 Git。

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put ADMIN_SESSION_SECRET
```

---

## 5. 必須設定 Cloudflare Access（第一道防線）

Cloudflare Access 不再只是建議；正式環境必須先經過 Zero Trust Edge 驗證，才能到達 Astro 登入頁。程式也會在 Worker middleware 再驗證 Access JWT，避免直接存取 Worker 的入口繞過 Edge policy。完整架構和 API 說明見 [`docs/ADMIN-AUTH-ARCHITECTURE.md`](docs/ADMIN-AUTH-ARCHITECTURE.md)。

1. Cloudflare Dashboard → Zero Trust → Access controls → Applications → Add an application → Self-hosted。
2. 使用正式 hostname，保護以下兩組路徑：
   - `www.example.com/admin*`
   - `www.example.com/api/admin*`
3. 建立 Allow policy，Include → Emails，只填管理員自己的 Email。若一個 Access Application 不接受多個 Path，建立兩個 Application，使用相同 Policy。
4. 在每個 Application 的 Additional settings 複製 Application Audience (AUD) Tag，並在 Zero Trust 設定頁取得 team domain。
5. 若使用單一 Access Application，填入共用 `ACCESS_AUD`；若分成兩個 Application，必須分別填入 `ACCESS_ADMIN_AUD` 和 `ACCESS_API_AUD`，不能把兩個 AUD 放進同一個全域清單。

```jsonc
"ACCESS_TEAM_DOMAIN": "https://<your-team>.cloudflareaccess.com",
// Single Access Application shared by both route groups:
"ACCESS_AUD": "<shared-application-aud-tag>",
// Or two separate Applications (leave ACCESS_AUD empty):
"ACCESS_ADMIN_AUD": "<admin-pages-aud-tag>",
"ACCESS_API_AUD": "<admin-api-aud-tag>"
```

`ACCESS_TEAM_DOMAIN` 必須是 `https://` 開頭的 issuer origin。單一 Application 時使用 `ACCESS_AUD`；分開設置時，Worker 會按 `/admin/*` 與 `/api/admin/*` 分別核對對應的 AUD，避免不同 Access Application 的 JWT 跨路徑重用。設定不完整時後台回 503；JWT 缺少、簽章錯誤、issuer 或 audience 不符時回 403。Worker 會驗證 RS256 簽章、iss、aud、exp、nbf 和 iat，不會只看 Header 是否存在。

## 6. Passkey（網站帳戶驗證方式之一）

Passkey 和密碼是網站帳戶登入的兩種替代方式，兩者都必須先通過 Cloudflare Access。Passkey 優先，密碼作為備用。

### 6.1 D1 Migration

```bash
npx wrangler d1 migrations apply personal-site --remote
```

這會套用 `migrations/0006_admin_passkeys.sql`，建立 Passkey 公鑰及一次性 challenge 儲存表。私鑰留在使用者裝置，不會上傳至網站。

### 6.2 WebAuthn 網域設定

正式網址目前為 `https://www.example.com`，`wrangler.jsonc` 已預設：

```jsonc
"ADMIN_WEBAUTHN_RP_ID": "www.example.com",
"ADMIN_WEBAUTHN_ORIGIN": "https://www.example.com"
```

RP ID 只填 hostname，不包含 `https://`、port 或 path。若更改正式網域，兩個值要一起更新。

### 6.3 登記第一把 Passkey

1. 確認 Access、D1 migration、`ADMIN_PASSWORD` 和 `ADMIN_SESSION_SECRET` 已完成設定。
2. 先通過 Cloudflare Access，再以管理員密碼登入 `/admin/login`。首次尚未登記 Passkey 時，備用密碼是初次進入 CMS 的啟用方式。
3. 進入 CMS 後，按右上方「設定 Passkey」。
4. 使用 Windows Hello、Touch ID、Face ID 或安全金鑰完成登記。建議至少登記兩把不同裝置／同步來源的 Passkey，以免遺失單一裝置後無法登入。
5. 登出後重新開啟 `/admin`，確認 Passkey 優先顯示；密碼登入仍可從「改用密碼登入」切換。

## 7. 部署

以上 secrets 設定好、`wrangler.jsonc` 的 `GITHUB_REPO` / `R2_PUBLIC_BASE_URL` 改完之後:

```bash
git add -A
git commit -m "feat: online admin CMS (R2 images + GitHub publish + Discord notify)"
git push
```

Push 到 `main` 後,Cloudflare Workers Builds 會自動重新建置部署(跟你平常發布網站更新一樣,不需要手動 `wrangler deploy`)。

> `/api/admin/login` 每 IP 每分鐘 5 次嘗試限流（成功與失敗都計入；限流器在密碼比對之前執行，超過即回 429 與 `Retry-After`）；Passkey ceremony API 每 IP 每分鐘 20 次請求限流。Cloudflare Dashboard 的 Rate Limiting 規則仍建議另外設定。

---

## 8. 測試清單

- [ ] 未通過 Cloudflare Access 時，`/admin/login` 和 `/api/admin/*` 都不能到達應用程式
- [ ] 直接呼叫 Worker hostname、移除 Access JWT 或使用錯誤 AUD，Worker 應拒絕請求
- [ ] 打開 `https://你的網域/admin/login`，已登記 Passkey 的瀏覽器可使用裝置解鎖登入
- [ ] Passkey 不支援、取消或沒有登記時，可使用「改用密碼登入」備援
- [ ] 首次登入以密碼進入 CMS，登記至少兩把 Passkey，再登出測試 Passkey 登入
- [ ] 點「＋ 新文章」,填標題/摘要/內文,**勾選草稿**,儲存 → 確認 GitHub repo 的 `src/content/blog/` 出現新檔案,列表也看得到(標示草稿)
- [ ] 打開剛剛那篇,取消勾選草稿,儲存 → 確認 Discord 頻道收到通知 embed
- [ ] 點「📷 插入圖片」,用手機相機拍一張照片上傳 → 確認 R2 Dashboard 的 bucket 裡出現檔案,且內文欄位自動插入了圖片 Markdown
- [ ] 刪除這篇測試文章 → 確認 GitHub repo 對應的 commit 是刪除,列表也不見了
- [ ] 登出後直接訪問 `/admin`,應該被導回登入頁

全部過了,CMS 就正式可以用了。正式環境部署前，請在 Node.js `>=22.23.4` 的環境安裝 WebAuthn 套件並重新產生 lockfile：

```bash
npm install --save-exact @simplewebauthn/server@14.0.3
npm ci
npm run check
npm test
npm run build
```

手機上可把 `/admin` 加到主畫面(分享 → 加入主畫面),之後開起來會更像一個獨立的 App。

---

## 更新紀錄

- **R2 binding 改名**:原本用 `IMAGES`,跟 `@astrojs/cloudflare` 內建的 Cloudflare Images binding 撞名導致部署失敗,已改名 `BLOG_IMAGES`(同時已在 `astro.config.mjs` 關閉了用不到的 Cloudflare Images 功能,因為這個專案完全沒用到 `astro:assets`)。
- **標籤/分類管理搬上線**(these features were ported from the former local CMS, since deleted):
  - 編輯器裡的「分類」欄位、「標籤」欄位現在都有既有值的自動完成(下拉建議)。
  - 標籤改成 chip 式輸入(按 Enter 或逗號新增,點 × 移除)。
  - 文章列表新增了多選 + 批次操作工具列(刪除、設為草稿/取消草稿、標為精選/取消精選、設定分類、新增/移除標籤)。
  - 新增「標籤管理」分頁:列出所有標籤與使用次數,可重新命名(套用到所有文章)或刪除(從所有文章移除)。
  - 上傳圖片的 `<input>` 加上 `capture="environment"`,手機上點「插入圖片」會直接開相機,不會先跳選單。

## 第三輪更新

- **批次操作改成單一 commit**:批次修改多篇文章、重新命名/刪除標籤,原本每篇文章各自一次 GitHub commit(=各自觸發一次 Cloudflare Build),現在改用 GitHub 的 Git Data API(blob → tree → commit → 更新分支指標),不管改幾篇文章都只產生**一個 commit、一次 push、一次 build**。實作在 `src/lib/github-cms.ts` 的 `commitFileChanges()`。
- **修正插入圖片的行為**:拿掉了 `capture="environment"`,現在點「📷 插入圖片」會跳出手機原生的選單(可選「照片圖庫」或「拍照」),不會強制直接開相機。
- **新增 Markdown 語法檢查 + 格式工具列**:
  - 內文欄位上方加了一排格式按鈕(粗體、斜體、標題、連結、行內/區塊程式碼、引言、項目/編號清單),點擊會在游標處插入或包住選取文字。
  - 在清單項目按 Enter 會自動接續下一個項目(空項目按 Enter 則結束清單),編號清單會自動遞增。
  - 「預覽」用 marked + DOMPurify 即時渲染 Markdown;「語法檢查」用 markdownlint 找出格式問題,點一下項目可以直接跳到內文對應那一行——這三個套件一樣透過 CDN 載入,沒有新增任何 npm 依賴。
- **確認:草稿文章不會出現在網站上**——`src/pages/blog/[slug].astro`、`blog.astro`、`index.astro`、`about.astro`、`rss.xml.ts`、`sitemap.xml.ts` 全部都用 `getCollection('blog', ({ data }) => !data.draft)` 或直接檢查 `post.data.draft` 過濾,直接訪問草稿文章的網址也會被擋掉(回傳等同 404)。這套邏輯在新增 CMS 之前就已經是對的,這次沒有改動,純粹確認。

## D1 draft storage

The online CMS now stores editor drafts in the Cloudflare D1 `cms_drafts` table instead of committing draft markdown files to GitHub. Saving with the `draft` flag set does not create a Git commit and therefore does not trigger the GitHub -> Cloudflare deployment pipeline.

A normal publish writes the final markdown to GitHub first. Only after the GitHub write succeeds does the CMS delete the corresponding D1 draft. If GitHub rejects the publish, the D1 draft is retained.

Apply the new migration to the production database before using draft storage:

```bash
npx wrangler d1 migrations apply personal-site --remote
```

## Local CMS removed

The former local desktop CMS (`scripts/cms/`) was the predecessor of this online CMS. It lived in git history and has now been deleted from the repository together with its `npm run cms` script; nothing in the online CMS depended on it at runtime.

`src/lib/frontmatter.ts` is the single source of truth for the post format on disk. It still emits the same byte layout the local tool produced, so existing posts are unaffected and no migration is needed.

## 四種內容類型（2026-10-31）

`/admin` 現在管理四個 content collections，對應 `src/content.config.ts` 的 schema：

| 類型              | 目錄                      | 表單欄位                                                                                     |
| ----------------- | ------------------------- | -------------------------------------------------------------------------------------------- |
| 隨筆 `blog`       | `src/content/blog/`       | `title`、`date`、`description`、`type`、`category`、`tags`、`featured`、`draft`              |
| 小說 `novel`      | `src/content/novel/`      | `title`、`volume`、`chapter`、`order`、`date`、`description`、`relatedLore`、`tags`、`draft` |
| 詞典 `dictionary` | `src/content/dictionary/` | `word`、`ipa`、`partOfSpeech`、`definition`、`etymology`、`relatedWords`、`draft`            |
| 世界觀 `world`    | `src/content/world/`      | `title`、`type`、`description`、`relatedEntries`、`draft`                                    |

- API：`GET/POST /api/admin/content`（列表／新增），`GET/PUT/DELETE /api/admin/content/<collection>/<id>`。全部經過 `requireAdmin()`；舊的 `/api/admin/posts*` 保留給 blog 相容與批次／標籤功能。
- Draft key 以 `${collection}:${id}` 存進 D1 `cms_drafts`；publish 成功後才刪草稿。舊的純 slug 草稿仍只會被 blog 相容端點讀取。
- 儲存前由 `src/lib/content-admin.ts` 做 schema 欄位正規化與必填檢查，並提示空內文及 `[[詞條]]` 找不到 dictionary id 的情況；`npm run validate:md` 仍是 CI 的最終內容驗證。
- 列表搜尋與類型篩選使用前台同一個 `src/lib/search-core.ts`；搜尋框沿用前台的對稱玻璃版型。
- 批次操作與「標籤管理」分頁仍只支援 blog；切換到其他 collection 時批次列隱藏。
