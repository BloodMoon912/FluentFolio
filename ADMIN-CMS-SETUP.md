# Online CMS + R2 image host + Discord notifications: setup steps

The code is already written. This document lists **the things you have to apply for / configure yourself**; do them in order and the CMS works.

---

## 1. Cloudflare R2 (image host)

```bash
npx wrangler r2 bucket create blog-images
```

Then go to Cloudflare Dashboard → R2 → `blog-images` → Settings → **Custom Domains** → add a subdomain (for example `img.yourdomain.com`) and wait until it shows as Active (usually within minutes, because the domain belongs to the same account, so DNS and the certificate are automatic).

Once you have the domain, open `wrangler.jsonc` and change this line to your real domain:

```jsonc
"R2_PUBLIC_BASE_URL": "https://img.yourdomain.com/"
```

**Do not forget the billing alert** (the safety net discussed earlier): Dashboard → Billing → Notifications → add an R2 storage usage alert (for example at the 8 GB threshold).

---

## 2. GitHub fine-grained token (lets the CMS commit posts)

1. Go to <https://github.com/settings/tokens?type=beta> → **Generate new token**
2. Resource owner: your account
3. Repository access: **Only select repositories** → tick this repo (do not select all)
4. Permissions → Repository permissions → **Contents: Read and write** (no other permission is needed)
5. Expiration: 90 days is recommended; remember to replace it before it expires
6. When it is generated, copy the token (it is shown only once)

Store it as a Worker secret:

```bash
npx wrangler secret put GITHUB_TOKEN
# paste the token you just copied
```

Also change `GITHUB_REPO` in `wrangler.jsonc` to your real `"your-account/your-repo"` (the default is `"your-name/fluentfolio"`). If you keep your posts in a separate private repository (optional, see [docs/PRIVATE-CONTENT-REPO.md](docs/PRIVATE-CONTENT-REPO.md)), change it here and in step 3 above to the content repository.

---

## 3. Discord webhook (publish notifications)

1. Go to the channel that should receive notifications → Edit Channel → **Integrations** → **Webhooks** → New Webhook
2. Give it a name (for example "blog publish notifications"), then copy the **Webhook URL**

```bash
npx wrangler secret put DISCORD_BLOG_WEBHOOK_URL
# paste the Webhook URL
```

---

## 4. Admin password and session signing key

Both are "random strings you decide on yourself", not something you apply for elsewhere:

- **ADMIN_PASSWORD**: used by the fallback password login. If several Passkeys are already registered you can still keep this password as a recovery route; only remove it after explicitly accepting the risk of "Passkey login only". A password manager generating 20+ random characters is recommended.
- **ADMIN_SESSION_SECRET**: the signing key for the site session and the WebAuthn challenge cookie; both Passkey and password login need it. You can generate it with `openssl rand -base64 32`; do not put it into Git.

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put ADMIN_SESSION_SECRET
```

---

## 5. Cloudflare Access is mandatory (the first line of defence)

Cloudflare Access is no longer merely recommended; in production the Zero Trust edge must verify the request before it can reach the Astro login page. The Worker middleware also verifies the Access JWT, so hitting the Worker hostname directly cannot bypass the edge policy. The full architecture and API description are in [`docs/ADMIN-AUTH-ARCHITECTURE.md`](docs/ADMIN-AUTH-ARCHITECTURE.md).

1. Cloudflare Dashboard → Zero Trust → Access controls → Applications → Add an application → Self-hosted.
2. Use the production hostname and protect these two path groups:
   - `www.example.com/admin*`
   - `www.example.com/api/admin*`
3. Create an Allow policy, Include → Emails, with only the administrator's own email. If one Access application does not accept multiple paths, create two applications that use the same policy.
4. Copy the Application Audience (AUD) Tag from each application's Additional settings, and get the team domain from the Zero Trust settings page.
5. With a single Access application, fill in the shared `ACCESS_AUD`; with two applications you must fill in `ACCESS_ADMIN_AUD` and `ACCESS_API_AUD` separately — never put both AUDs into one global list.

```jsonc
"ACCESS_TEAM_DOMAIN": "https://<your-team>.cloudflareaccess.com",
// Single Access Application shared by both route groups:
"ACCESS_AUD": "<shared-application-aud-tag>",
// Or two separate Applications (leave ACCESS_AUD empty):
"ACCESS_ADMIN_AUD": "<admin-pages-aud-tag>",
"ACCESS_API_AUD": "<admin-api-aud-tag>"
```

`ACCESS_TEAM_DOMAIN` must be an issuer origin starting with `https://`. With a single application, `ACCESS_AUD` is used; with two, the Worker checks the matching AUD for `/admin/*` and `/api/admin/*` separately, so a JWT from one Access application cannot be reused on the other path. The admin area returns 503 while the configuration is incomplete, and 403 when the JWT is missing, badly signed, or has a wrong issuer or audience. The Worker verifies the RS256 signature, iss, aud, exp, nbf and iat rather than just checking that a header exists.

## 6. Passkey (one of the website-account login methods)

Passkey and password are two alternative ways to log into the website account, and both must pass Cloudflare Access first. Passkey is preferred, with the password as a fallback.

### 6.1 D1 migration

```bash
npx wrangler d1 migrations apply personal-site --remote
```

This applies `migrations/0006_admin_passkeys.sql`, creating the tables for Passkey public keys and one-time challenges. The private key stays on the user's device and is never uploaded to the website.

### 6.2 WebAuthn domain settings

The production URL is currently `https://www.example.com`, and `wrangler.jsonc` already defaults to:

```jsonc
"ADMIN_WEBAUTHN_RP_ID": "www.example.com",
"ADMIN_WEBAUTHN_ORIGIN": "https://www.example.com"
```

The RP ID takes the hostname only, without `https://`, port or path. If the production domain changes, update both values together.

### 6.3 Registering the first Passkey

1. Confirm that Access, the D1 migration, `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` are all configured.
2. Pass Cloudflare Access first, then log in at `/admin/login` with the admin password. With no Passkey registered yet, the fallback password is how you get into the CMS the first time.
3. Once in the CMS, press 「設定 Passkey」 (Set up Passkey) in the top right.
4. Register with Windows Hello, Touch ID, Face ID or a security key. Registering at least two Passkeys from different devices / sync sources is recommended, so losing a single device does not lock you out.
5. Log out, open `/admin` again and confirm the Passkey is offered first; you can still switch to password login with 「改用密碼登入」 (Use password instead).

## 7. Deployment

Once the secrets above are set and `GITHUB_REPO` / `R2_PUBLIC_BASE_URL` in `wrangler.jsonc` are changed:

```bash
git add -A
git commit -m "feat: online admin CMS (R2 images + GitHub publish + Discord notify)"
git push
```

After the push to `main`, Cloudflare Workers Builds rebuilds and deploys automatically (exactly like any other site update — no manual `wrangler deploy` needed).

> `/api/admin/login` is rate limited to 5 attempts per IP per minute (successes and failures both count; the limiter runs before the password comparison and returns 429 with `Retry-After` once exceeded); the Passkey ceremony APIs are limited to 20 requests per IP per minute. Setting a separate Rate Limiting rule in the Cloudflare Dashboard is still recommended.

---

## 8. Test checklist

- [ ] Without passing Cloudflare Access, neither `/admin/login` nor `/api/admin/*` reaches the application
- [ ] Calling the Worker hostname directly, removing the Access JWT, or using a wrong AUD is rejected by the Worker
- [ ] Open `https://<DOMAIN>/admin/login`; a browser with a registered Passkey can log in with the device unlock
- [ ] When a Passkey is unsupported, cancelled or not registered, 「改用密碼登入」 (Use password instead) is available as a fallback
- [ ] For the first login, enter the CMS with the password, register at least two Passkeys, then log out and test Passkey login
- [ ] Click 「＋ 新文章」 (New post), fill in title / summary / body, **tick draft**, save → confirm the new file appears under `src/content/blog/` in the GitHub repo and in the list (marked as a draft)
- [ ] Open the post you just created, untick draft, save → confirm the Discord channel receives a notification embed
- [ ] Click 「📷 插入圖片」 (Insert image) and upload a photo taken with the phone camera → confirm the file appears in the bucket in the R2 Dashboard and that the image Markdown was inserted into the body field automatically
- [ ] Delete that test post → confirm the matching commit in the GitHub repo is a deletion and that it disappears from the list
- [ ] After logging out, visiting `/admin` directly should redirect back to the login page

If all of that passes, the CMS is officially usable. Before deploying to production, install the WebAuthn package on Node.js `>=22.23.4` and regenerate the lockfile:

```bash
npm install --save-exact @simplewebauthn/server@14.0.3
npm ci
npm run check
npm test
npm run build
```

On a phone you can add `/admin` to the home screen (Share → Add to Home Screen) so it opens more like a standalone app.

---

## Changelog

- **R2 binding renamed**: it originally used `IMAGES`, which collided with the Cloudflare Images binding built into `@astrojs/cloudflare` and broke the deploy, so it is now `BLOG_IMAGES` (the unused Cloudflare Images feature was also disabled in `astro.config.mjs`, because this project does not use `astro:assets` at all).
- **Tag / category management went online** (these features were ported from the former local CMS, since deleted):
  - The 「分類」 (category) and 「標籤」 (tag) fields in the editor now autocomplete from existing values (dropdown suggestions).
  - Tags became a chip-style input (press Enter or comma to add, click × to remove).
  - The post list gained multi-select + a batch action toolbar (delete, set as draft / clear draft, mark as featured / clear featured, set category, add / remove tags).
  - A 「標籤管理」 (Tag management) tab was added: it lists every tag with its usage count and can rename one (applied to all posts) or delete one (removed from all posts).
  - `capture="environment"` was added to the image upload `<input>`, so tapping 「插入圖片」 (Insert image) on a phone opened the camera directly instead of showing the menu first.

## Third round of updates

- **Batch operations become a single commit**: editing several posts at once, or renaming / deleting tags, used to produce one GitHub commit per post (= one Cloudflare Build each). They now use GitHub's Git Data API (blob → tree → commit → update the branch pointer), so no matter how many posts are changed it produces **one commit, one push, one build**. The implementation is `commitFileChanges()` in `src/lib/github-cms.ts`.
- **Fixed the insert-image behaviour**: `capture="environment"` was removed, so tapping 「📷 插入圖片」 (Insert image) now opens the phone's native menu (choose "Photo Library" or "Take Photo") instead of forcing the camera.
- **Added Markdown syntax checking + a formatting toolbar**:
  - A row of format buttons sits above the body field (bold, italic, heading, link, inline / block code, blockquote, bulleted / numbered list); clicking one inserts at the cursor or wraps the selected text.
  - Pressing Enter inside a list item continues the list (Enter on an empty item ends it), and numbered lists increment automatically.
  - 「預覽」 (Preview) renders Markdown live with marked + DOMPurify; 「語法檢查」 (Lint) finds formatting problems with markdownlint and clicking an entry jumps straight to the matching line in the body — these three packages are likewise loaded from a CDN, so no npm dependency was added.
- **Confirmed: draft posts never appear on the site** — `src/pages/blog/[slug].astro`, `blog.astro`, `index.astro`, `about.astro`, `rss.xml.ts` and `sitemap.xml.ts` all filter with `getCollection('blog', ({ data }) => !data.draft)` or by checking `post.data.draft` directly, and visiting a draft post's URL is blocked as well (it returns the equivalent of a 404). That logic was already correct before the CMS was added; nothing was changed this time, it was only confirmed.

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

## The four content types (2026-10-31)

`/admin` now manages four content collections, matching the schema in `src/content.config.ts`:

| Type                    | Directory                 | Form fields                                                                                  |
| ----------------------- | ------------------------- | -------------------------------------------------------------------------------------------- |
| Essay `blog`            | `src/content/blog/`       | `title`, `date`, `description`, `type`, `category`, `tags`, `featured`, `draft`              |
| Novel `novel`           | `src/content/novel/`      | `title`, `volume`, `chapter`, `order`, `date`, `description`, `relatedLore`, `tags`, `draft` |
| Dictionary `dictionary` | `src/content/dictionary/` | `word`, `ipa`, `partOfSpeech`, `definition`, `etymology`, `relatedWords`, `draft`            |
| World `world`           | `src/content/world/`      | `title`, `type`, `description`, `relatedEntries`, `draft`                                    |

- API: `GET/POST /api/admin/content` (list / create), `GET/PUT/DELETE /api/admin/content/<collection>/<id>`. All of them go through `requireAdmin()`; the older `/api/admin/posts*` stays for blog compatibility and the batch / tag features.
- Draft keys are stored in D1 `cms_drafts` as `${collection}:${id}`; the draft is deleted only after a successful publish. Old slug-only drafts are still read by the blog compatibility endpoints alone.
- Before saving, `src/lib/content-admin.ts` normalises the schema fields, checks the required ones, and warns about an empty body or `[[term]]` references with no matching dictionary id; `npm run validate:md` remains CI's final content validation.
- List search and the type filter reuse the site's own `src/lib/search-core.ts`; the search box keeps the site's symmetrical glass styling.
- Batch operations and the 「標籤管理」 (Tag management) tab still support `blog` only; the batch row is hidden when you switch to another collection.
