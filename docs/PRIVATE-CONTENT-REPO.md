# Private content repository

> **This is an optional feature.** By default FluentFolio keeps posts in `src/content/` in the same
> repository as the code, and that works out of the box. Follow this document only when you want to keep
> your posts in a separate **private** repository.

The site code and the post content are stored separately:

- **Code repository** (this repository, `fluentfolio`): code only. To enable this mode, uncomment
  `# /src/content/` in `.gitignore`, run `git rm -r --cached src/content` to stop tracking the content,
  and delete the sample posts if you like.
- **Content repository** (private, `fluentfolio-content`): `src/content/{blog,novel,dictionary,world}`,
  with exactly the same directory layout as before. The template is in
  [`examples/private-content-repo/`](../examples/private-content-repo/).

This buys two things: handing the code to an AI reviewer, to a collaborator or to the public never drags
any posts along; and the CMS token cannot reach the code, which implements option 1 of
[ADR 0001](DECISIONS/0001-cms-write-path.md).

## How it works

```text
/admin save ──► content repo main ──► GitHub Action ──► Workers Builds deploy hook
                                                            │
code repo main ───────────────────────────────────────────► │  build
                                                            │
                          prebuild: scripts/fetch-content.mjs with a read-only token
                          shallow-clones the content repo and copies only the four collections
                                                            ▼
                                                  astro build ──► deploy
```

- At build time `scripts/fetch-content.mjs` (`prebuild`) fetches the content. If `src/content` already
  holds Markdown it is skipped, never overwritten.
- When Workers Builds cannot fetch the content, **the build fails outright** instead of deploying an empty
  site.
- `draft: true` entries in the content repository never enter the build and are never published.
- The admin CMS still uses `GITHUB_TOKEN` / `GITHUB_REPO`; only `GITHUB_REPO` now points at the content
  repository, and no code changes are needed.

## 1. Check before migrating

```bash
git log --oneline -- src/content
```

If this repository's history already contains content you do not want to publish, deleting the files is
not enough — old commits stay readable. In a private repository the exposure is limited; in a public one,
treat the historical content as already published, or rewrite history with `git filter-repo` and
force-push.

## 2. Create the content repository

1. Create a **private** repository `fluentfolio-content` on GitHub (do not tick README).
2. Put the template content (`fluentfolio-content-template/`) in it, then add your existing posts:

   ```bash
   cd fluentfolio-content-template
   git init -b main
   # Copy the existing content out of the code repository, keeping the src/content layout
   cp -r ../fluentfolio/src/content/. src/content/
   git add .
   git commit -m "Initial content"
   git remote add origin git@github.com:your-name/fluentfolio-content.git
   git push -u origin main
   ```

If you use a different repository name, update `GITHUB_REPO` in `wrangler.jsonc` and `CONTENT_REPO` in
Workers Builds to match.

## 3. Create two tokens

Both are fine-grained personal access tokens, both restricted to the content repository (Only select
repositories), and they must **not** be the same token.

| Purpose                       | Scope                    | Stored in                                        |
| ----------------------------- | ------------------------ | ------------------------------------------------ |
| Admin CMS writes              | Contents: Read and write | Worker secret `GITHUB_TOKEN`                     |
| Reading content at build time | Contents: **Read-only**  | Workers Builds build secret `CONTENT_REPO_TOKEN` |

Do not grant the Workflows permission: the CMS token then cannot modify the content repository's
workflows, and therefore cannot reach the deploy hook described below.

## 4. Configure Cloudflare Workers Builds

In Workers & Pages → `fluentfolio` → Settings → Builds:

1. **Variables and secrets** (these are build-time variables; the running Worker cannot see them):
   - `CONTENT_REPO_TOKEN`: choose type **Secret** and paste the read-only token
   - `CONTENT_REPO` = `your-name/fluentfolio-content`
   - `CONTENT_REQUIRED` = `1`
2. **Deploy Hooks**: add one, select the `main` branch, and copy the generated URL.

## 5. Make content updates trigger a deploy automatically

In the content repository go to Settings → Secrets and variables → Actions and add a repository secret:

- `SITE_DEPLOY_HOOK_URL` = the deploy hook URL copied in the previous step

The deploy hook URL is itself a credential: anyone who has it can trigger a build (rate-limited to 10 per
Worker per minute), so keep it only in this secret. If it leaks, delete it and create a new one.

## 6. Switch the code repository and the CMS

Do this in order so the site is never left in a broken state:

1. Update the Worker secret first (switch it to the read/write token for the content repository):

   ```bash
   npx wrangler secret put GITHUB_TOKEN
   ```

2. Apply this change in the code repository and stop tracking the content you moved out:

   ```bash
   git rm -r --cached src/content
   git add -A
   git commit -m "Move content to a private repository"
   git push
   ```

3. Wait for Workers Builds to finish. The build log should contain
   `fetch-content: fetched N Markdown file(s) from …`.
4. Open the site and `/admin` to confirm every post is there, save a test post, and confirm the content
   repository's Actions triggered a new build.
5. Delete the old `GITHUB_TOKEN` on GitHub that covered the code repository.

## Local development

Clone the content repository next to the code repository, then mirror it into `src/content`:

```bash
git clone git@github.com:your-name/fluentfolio-content.git ../fluentfolio-content
npm run fetch:content -- --from ../fluentfolio-content
npm run dev
```

`--from` replaces the four collection folders under `src/content`, so **edit in the content repository**,
not in `src/content` directly (it is only a copy and is never committed). For posts published through
`/admin`, `git pull` in the content repository first, then re-run the commands above.

When you have no real content, `node scripts/seed-mock-content.mjs --seed` inserts fake posts for testing.

## Handing the code to an AI reviewer

- Hand over only the code repository. `src/content` is excluded, and `git archive` will not include it
  either.
- Do not hand over the content repository, and do not paste `.dev.vars`, `.env*` or any token.
- `tests/fixtures/` holds only fake data and is safe to share.

## What this protects, and what it does not

- **Protects**: unpublished drafts, unreleased fiction and world-building notes never appear in the code
  repository or in an archive handed to an AI. A leaked CMS token cannot change code either — it can only
  change content, and that can be recovered from the content repository's history.
- **Does not protect**: already published posts. They appear on the site and in RSS anyway, where anyone
  can read them.
- **Still watch**: if the read-only build token leaks, an attacker can read the content repository, drafts
  included. Set an expiry date and rotate it regularly. Branch protection on `main` in the code repository
  is also worth enabling.

## Rolling back

1. Point `GITHUB_REPO` in `wrangler.jsonc` back at the code repository and switch `GITHUB_TOKEN` back to a
   matching token.
2. Remove `/src/content/` from `.gitignore` and copy the content back into `src/content`.
3. Remove `prebuild` from `package.json`.
