# 後台雙層驗證與 Passkey 設計

## 驗證順序

```text
Browser
  │
  ▼
Cloudflare Access（Zero Trust Edge）
  │  Access Policy：只允許指定管理員 Email
  │  驗證成功後簽發 Access Application JWT
  ▼
Cloudflare Worker / Astro middleware
  │  驗證 CF-Access-Jwt-Assertion 的 RS256 簽章、iss、aud、exp、nbf、iat
  │  失敗或未設定時 fail closed
  ▼
/admin/login
  │
  ├── Passkey（優先；WebAuthn + discoverable credential）
  │
  └── 密碼（備用；與 Passkey 互為替代）
          │
          ▼
  __Host-bm-admin（隨機 session ID + HMAC 簽章、HttpOnly、Secure、SameSite=Lax、7 天）
          │
          ▼
  admin_sessions（D1）：每次請求驗簽章、檢查未過期、未撤銷
          │
          ▼
  /admin + /api/admin/*
```

Cloudflare Access 和網站帳戶驗證是兩道獨立檢查。Access JWT 驗證放在 Astro middleware，因此 `/admin`、`/admin/login` 及所有 `/api/admin/*`（包括 Passkey options/verify）都先經過同一個 Worker-side Access 驗證。單純存在 `CF-Access-Jwt-Assertion` Header 不足以通過檢查。

唯一的開發例外是 `astro dev` 在 `localhost`、`127.0.0.1` 或 `::1`；正式建置／部署沒有 Access bypass。

## Cloudflare Access 必要設定

1. Cloudflare Dashboard → Zero Trust → Access controls → Applications → Add an application → Self-hosted。
2. 以正式網站 hostname 建立保護規則，至少涵蓋：
   - `www.example.com/admin*`
   - `www.example.com/api/admin*`
3. 對兩個路徑套用相同的 Allow Policy，Include → Emails → 只加入管理員信箱。若 Dashboard 不接受同一 Application 的多個 Path，建立兩個 Application 並套用同一 Policy。
4. 在 Access Application 的 Additional settings 複製 **Application Audience (AUD) Tag**。
5. 到 Zero Trust 設定頁確認 team domain，例如 `https://<team-name>.cloudflareaccess.com`。
6. 單一 Access Application 同時保護頁面與 API 時，填入 `ACCESS_AUD`；若分成兩個 Application，分別填入 `ACCESS_ADMIN_AUD`（`/admin*`）和 `ACCESS_API_AUD`（`/api/admin*`）。不要用逗號把不同路徑的 AUD 合併成全域 allow-list，否則可能跨路徑重用 JWT。兩者缺一，Worker 會對後台回傳 503，不會默認放行。
7. Access app 必須套用正式 hostname。即使訪問 `workers.dev` 或其他未經 Access edge 規則的入口，Worker middleware 仍要求相同 Access issuer 和 audience 的有效簽章 JWT。
8. AUD 的路徑族判斷會先正規化路徑（重複百分號解碼、`.`／`..` 段解析、折疊重複斜線），所以 `//api/admin/*`、`/api/%61dmin/*` 這類寫法仍會被歸類為 API，不能拿管理頁 Application 的 JWT 呼叫 API。middleware 若載入驗證器失敗，會 fail closed 回 503（頁面 text/plain、API JSON），不會放行。

Worker 只接受 `Cf-Access-Jwt-Assertion` Header，並使用 team domain 的 `/cdn-cgi/access/certs` 公鑰驗證 RS256 簽章，再核對精確 issuer、Application AUD 和時間 claims。它不以 Header 存在與否、`CF_Authorization` Cookie 或訪客提供的 Email 當作身份證明。

## Passkey 初次設定

Passkey 和密碼不是連續兩個 MFA 步驟，而是兩種可互相替代的網站帳戶登入方式。兩者都必須先通過 Cloudflare Access。

1. 首次啟用先以既有管理員密碼登入。
2. 進入 `/admin` 後，按右上方「設定 Passkey」。
3. 以 Windows Hello、Touch ID、Face ID 或安全金鑰完成建立。
4. 登記成功後，之後登入頁會先準備 Passkey challenge，並在載入時啟動 Conditional UI；帳戶欄位使用 `autocomplete="username webauthn"`，支援的瀏覽器可在該欄位顯示原生 Passkey 選擇。也可直接點「使用 Passkey 登入」。
5. 裝置不支援、沒有已登記 Passkey、使用者取消或驗證失敗時，可展開「改用密碼登入」。

Passkey 必須在正式網站 HTTPS origin 註冊。Passkey 驗證只需要 `ADMIN_SESSION_SECRET`；密碼備援另外需要 `ADMIN_PASSWORD`。若不再設定 `ADMIN_PASSWORD`，已登記的 Passkey 仍可登入，但密碼切換入口會隱藏。不要在尚未登記多把 Passkey 前移除密碼備援。

預設設定：

- `ADMIN_WEBAUTHN_RP_ID=www.example.com`
- `ADMIN_WEBAUTHN_ORIGIN=https://www.example.com`

若將正式 hostname 改為非 www 網域，兩個值都要跟著改，並以同一個 canonical origin 開啟 `/admin`。RP ID 是 hostname，不包含 scheme、port 或 path。

### 管理員 Session（可撤銷）

密碼與 Passkey 兩種登入方式成功後，都會經由同一個 `src/lib/admin-sessions-core.ts` 建立 D1 session：

- Cookie `__Host-bm-admin` 的值為 `<session_id>.<issued_at>.<hmac>`：`session_id` 是 24 bytes 隨機數（32 個 base64url 字元），HMAC 使用 `ADMIN_SESSION_SECRET` 簽署 `admin.session.<session_id>.<issued_at>`；簽章 scope 與訪客 cookie 不同。
- D1 `admin_sessions`（`migrations/0008_admin_sessions.sql`）是 session 的唯一權威來源：`expires_at` 為建立後 7 天、`revoked_at` 標記撤銷、`last_seen_at` 記錄最近使用時間（最多每 5 分鐘更新一次）。
- `requireAdmin()`、`hasValidAdminSession()` 與 `/admin` 頁面守衛都會先驗證 HMAC，再讀 D1 確認 session 存在、未過期、未撤銷。簽章正確但 D1 沒有對應資料時，一律視為未登入。
- 舊格式（`<issued_at>.<signature>` 兩段）cookie 永遠無效；升級後現有管理員需重新登入一次。
- `POST /api/admin/logout` 會撤銷目前 session 並清除 cookie（刻意保持冪等：沒有有效 session 時仍會清除 cookie）；新增的 `POST /api/admin/logout-all` 會撤銷所有裝置的 session，`/admin` 右上角有「登出全部」按鈕。
- 每次成功登入約有 1% 機率順便刪除已過期 session（機會式清理，失敗不影響登入）。

**D1 是驗證的一部分，必須 fail closed**：D1 binding 缺失、查詢失敗，或 `0008` migration 尚未套用（`no such table: admin_sessions`）時，`/api/admin/*` 回 503，`/admin` 頁面亦回 503，而不是當成未登入。只有「沒有 cookie／簽章錯誤／session 已過期或撤銷」才是 401。因此部署順序必須是「先套用 remote migration，再部署程式碼」。

### D1 Migration

Passkey 公鑰、signature counter、transport 與五分鐘一次性 challenge 存在 D1。私鑰不會離開使用者裝置。

部署前執行：

```bash
npx wrangler d1 migrations apply personal-site --remote
```

Passkey 使用 `migrations/0006_admin_passkeys.sql`；管理員 session 使用 `migrations/0008_admin_sessions.sql`。同一管理帳戶最多可登記 10 把 Passkey。challenge 驗證時使用單一 DELETE ... RETURNING 操作消耗，無論成功或失敗都不能重播。兩個 migration 都必須在部署對應程式碼前套用到 remote D1。

## API 契約

| Route                                 | Method | 用途                                                  | 登入狀態                                                                               |
| ------------------------------------- | ------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `/api/admin/passkey/login-options`    | POST   | 建立短效登入 challenge、回傳 WebAuthn request options | Access only                                                                            |
| `/api/admin/passkey/login-verify`     | POST   | 驗證 assertion 並簽發網站 session                     | Access only                                                                            |
| `/api/admin/passkey/register-options` | POST   | 建立註冊 challenge                                    | Access + admin session                                                                 |
| `/api/admin/passkey/register-verify`  | POST   | 驗證註冊並儲存公鑰                                    | Access + admin session                                                                 |
| `/api/admin/passkeys`                 | GET    | 讀取 Passkey 數量和狀態                               | Access + admin session                                                                 |
| `/api/admin/login`                    | POST   | 備用密碼登入                                          | Access only                                                                            |
| `/api/admin/logout`                   | POST   | 撤銷目前 session 並清除 cookie                        | Access + 同源檢查（刻意冪等：session 已過期時仍可清除 cookie，因此不要求有效 session） |
| `/api/admin/logout-all`               | POST   | 撤銷所有裝置的管理員 session                          | Access + 有效 admin session + 同源檢查                                                 |

所有 POST 均檢查精確 Origin。Passkey challenge cookie 為 HttpOnly、Secure、SameSite=Lax、5 分鐘有效；challenge 本身只在 D1 短暫保存並以原子操作消耗。Challenge 與管理員 session cookie 都使用 `ADMIN_SESSION_SECRET` 做 HMAC 簽章，但簽署內容分別限定用途；Passkey 私鑰則始終留在使用者裝置。

## 部署前檢查

- [ ] `ACCESS_TEAM_DOMAIN` 已設定；單一 Access app 使用 `ACCESS_AUD`，兩個獨立 Access apps 則分別設定 `ACCESS_ADMIN_AUD` 與 `ACCESS_API_AUD`。
- [ ] Access Policy 只允許管理員 Email。
- [ ] Access Application 覆蓋 `/admin*` 與 `/api/admin*`，並在使用兩個 apps 時分別對應正確 AUD。
- [ ] `ADMIN_SESSION_SECRET` 已設為 Wrangler secret；若要保留密碼備援，另設定 `ADMIN_PASSWORD`。
- [ ] `ADMIN_WEBAUTHN_RP_ID` 和 `ADMIN_WEBAUTHN_ORIGIN` 對應實際 canonical domain。
- [ ] 已在 production D1 執行 migration 0006 與 0008；未套用 0008 時管理員登入會 fail closed 回 503。
- [ ] 首次以密碼登入並新增至少兩把 Passkey（例如 Windows Hello + 手機同步 Passkey），再測試登出後以 Passkey 重新登入。
- [ ] 測試「登出全部」後，其他瀏覽器上的管理員 session 即失效（再用舊 cookie 存取應回 401）。
- [ ] 測試時移除 Access Header 或使用錯誤 AUD，Worker 應回應 403；未設定 Access vars 應回應 503。

## 套件與 lockfile

後端使用 `@simplewebauthn/server` `14.0.3` 驗證 WebAuthn 註冊及登入回應。`package-lock.json` 已包含這個依賴（連同 `pinyin-pro`、`to-jyutping`），且是以 Node **22.23.4** / npm **10.9.9** 產生的；CI 使用 `npm ci`，若日後再新增依賴，請用 npm 10 重新產生 lockfile，不要只改 `package.json`。
