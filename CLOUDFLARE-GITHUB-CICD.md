# GitHub → Cloudflare Workers Builds

This project is designed for Cloudflare's native Workers Builds integration. It keeps production deploys inside Cloudflare and uses GitHub as the source of truth.

## 1. Put the project in GitHub

```bash
git init
git add .
git commit -m "Initial personal Fluent site"
git branch -M main
git remote add origin https://github.com/YOUR_NAME/YOUR_REPO.git
git push -u origin main
```

Do not commit `.env`, `.dev.vars`, API keys, or Cloudflare secrets.

## 2. Connect the existing Worker

In Cloudflare Dashboard:

Workers & Pages → select `fluentfolio` → Settings → Builds → Connect.

Choose GitHub, authorize the repository, and select the repository and `main` branch.

The Worker name in the dashboard must match the `name` in `wrangler.jsonc`.

Recommended build settings:

- Root directory: `/`
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Production branch: `main`
- Non-production branch deploy command: keep Cloudflare's default `npx wrangler versions upload`

Save the settings, then push a commit to `main` to trigger the first automatic production deployment.

### Optional: private content repository (build variables)

Only if you keep posts in a separate private repository (they are then fetched during `npm run build`). In Settings → Builds → Variables and secrets add `CONTENT_REPO_TOKEN` (secret, read-only), `CONTENT_REPO` and `CONTENT_REQUIRED=1`. Content changes rebuild the site through a Deploy Hook called from the content repository. Full setup: [docs/PRIVATE-CONTENT-REPO.md](docs/PRIVATE-CONTENT-REPO.md).

## 3. Production secrets

The Worker uses these secrets:

- `STEAM_API_KEY`
- `STEAM_ID`
- `VISITOR_SALT`
- `VISITOR_COOKIE_SECRET`
- `DISCORD_USER_ID`
- `ADMIN_PASSWORD`
- `ADMIN_SESSION_SECRET`
- `GITHUB_TOKEN`
- `DISCORD_BLOG_WEBHOOK_URL`

`.env.example` is the authoritative list, including the non-secret vars (`GITHUB_REPO`, `GITHUB_BRANCH`, `R2_PUBLIC_BASE_URL`). `ACTIVITY_TOKEN` was removed along with the old activity-update flow and no longer exists. `TURNSTILE_SECRET` is live again: it enables Cloudflare Turnstile on `POST /api/visitors` (see `DEPLOY-CLOUDFLARE.md` section 5b) and doubles as the last-resort cookie-signing fallback.

Manage them with Wrangler (`npx wrangler secret put ...`) or in the Worker dashboard. Never place their values in GitHub.

## 4. D1 migrations

A new schema change is added as a numbered SQL file under `migrations/`.

For example, after adding `migrations/0002_activity_rich_presence.sql` locally:

```bash
npx wrangler d1 migrations apply personal-site --local
npm run build
```

After the code is verified:

```bash
npx wrangler d1 migrations apply personal-site --remote
```

Run the remote migration as an explicit deployment step whenever a new production migration is introduced. Do not put production database credentials into GitHub Actions.

## 5. Daily workflow

```bash
npm run dev
npm run build
git add .
git commit -m "Update activity dashboard"
git push
```

Cloudflare Workers Builds then performs the build and deploy for `main`.

A lightweight GitHub Actions workflow in `.github/workflows/ci.yml` also validates on pushes and pull requests: `npm run check`, `npm run lint`, `npm test`, then `npm run build`. It does not deploy production, avoiding two independent deployment systems.

## 6. Rollbacks and previews

Cloudflare Workers Builds can deploy non-production commits as preview versions using `wrangler versions upload`. Production remains controlled by the `main` branch.

## 7. Important migration note for this project

`migrations/0002_activity_rich_presence.sql` is a production schema change for the Activity table. Apply it to local D1 first if you use local D1 for development, then apply it to the remote D1 before or as part of releasing the code that depends on those columns.

`migrations/0003_visitor_geo_referrer.sql` adds `country` and `referrer_host` columns to the `visits` table (used by the visitor-analytics geo/referrer breakdown on the homepage). Apply it the same way — local first, then `--remote` — before/with the release that reads those columns.

Later migrations follow the same pattern: `0004_set_site_started_at.sql` pins the site start time, and `0005_cms_drafts.sql` creates the D1 draft table used by the admin CMS. Treat the `migrations/` directory as the authoritative list rather than this summary.
