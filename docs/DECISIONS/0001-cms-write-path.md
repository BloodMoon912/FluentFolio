# 0001 — CMS write path: reduce the GitHub token's blast radius

- Status: Option 1 is available as an opt-in mode (see [PRIVATE-CONTENT-REPO.md](../PRIVATE-CONTENT-REPO.md)); by default the CMS commits to this repository. The body below is the original record
- Date: 2026-11-03
- Audit item: #12 (`GITHUB_TOKEN` scope too wide)
- Scope: decision record only — this change makes no code or configuration changes.

## Context

How CMS writes work today:

- The admin CMS runs inside the Worker and holds `GITHUB_TOKEN`, a fine-grained PAT documented as "Contents read/write on this repository only" (`src/lib/github-cms.ts`, `repoConfig()` / `githubFetch()`).
- Every save, publish, delete, batch edit and taxonomy rename is a real git commit: the Contents API for a single file (`putContentFile`, `deleteContentFile`) and the Git Data API for batches (`commitFileChanges`).
- The commit target is `GITHUB_BRANCH`, which is `"main"` in `wrangler.jsonc`, so every CMS write pushes straight to `main`.
- Cloudflare Workers Builds builds and deploys every push to `main` automatically (see `AGENTS.md` → "Deploy & production"); `.github/workflows/ci.yml` only validates, it does not gate deployment by itself.
- The admin surface in front of the token is Cloudflare Access plus a revocable site session, with same-origin, POST-only browser endpoints (`docs/ADMIN-AUTH-ARCHITECTURE.md`, `docs/CMS-HTTP-CONTRACT.md`). The token itself never reaches the browser.

## The risk

The deployment chain is: **CMS session (or token) → commit on `main` → automatic production deploy**.

GitHub's permission model does not restrict a Contents: write token to `src/content/**`; the path restriction exists only in our Worker code. Therefore:

1. Anyone who can act as the CMS (stolen admin session cookie, compromised Passkey device, an authorization bug in `/api/admin/*`) can use the token exactly as the Worker does.
2. Anyone who obtains `GITHUB_TOKEN` (secret leak, Worker bug, CI/build log) can write **any** file the token can reach, not only content.
3. A write to `src/**`, `astro.config.mjs`, `package.json` or the workflow files can execute code or exfiltrate secrets on the next build, and it deploys with no human review.
4. Because the CMS and the owner use the same identity/permissions, branch protection cannot distinguish "the CMS" from "the owner" unless the owner is added as a bypass actor — which would also cover a stolen token.

The audit finding is about blast radius and review, not about the CMS writing content (that part is intended).

## Options

### Option 1 — Content in a separate repository

Move `src/content/**` to a dedicated content repository (for example `your-name/fluentfolio-content`); the site repository keeps code only.

GitHub:

- New private content repo holding `src/content/{blog,novel,dictionary,world}`.
- Two fine-grained tokens: the CMS token scoped **only** to the content repo (Contents: read/write), and a read-only token or deploy key used by the build to fetch content.
- Keep a ruleset on the site repo `main`: no force pushes, no deletions, require CI and review.

Cloudflare:

- The Workers Builds build command becomes a script that fetches the content repo first (git submodule with a read-only deploy key, or a fetch script using the build-only read token), then runs `astro build`.
- The read token is a Workers Builds build secret, not a runtime Worker secret.
- No D1/R2 changes; previews build the same way.

`src/lib/github-cms.ts` changes: **small**. Point the CMS at the content repo (`GITHUB_REPO`) while keeping the same `src/content/<collection>/<id>.md` layout inside it, so `CONTENT_DIRS`, `contentPath()`, `commitFileChanges()` and their callers stay unchanged. The separation is mostly configuration plus a build step.

Effect on the risk: a compromised CMS or token can only change published content, never site code or deploy configuration. Content abuse (defacement, deleting posts) remains possible, but it is recoverable through the content repo's git history and can never become arbitrary code execution.

Cost: a second repository, build integration for the content checkout, and a second set of branch rules to maintain.

### Option 2 — CMS branch + pull request + branch protection

Keep one repository, but make every CMS write land on a review branch instead of `main`.

GitHub:

- Ruleset/branch protection on `main`: require a pull request before merging, require the CI checks, block direct pushes, block force pushes and deletions, dismiss stale approvals.
- Do **not** put the CMS token's user on the bypass list — the gate only exists if the token cannot bypass it.
- The fine-grained token needs Contents: read/write plus Pull requests: read/write, or a GitHub App with short-lived tokens.

Cloudflare:

- Unchanged: Workers Builds still deploys `main`, so the deploy happens only when a human merges the PR.
- Optional: PR preview deployments.

`src/lib/github-cms.ts` changes: **medium**. Writes target a dedicated CMS branch (or one branch per review); after `commitFileChanges()` the CMS opens a pull request and returns its URL/state, and it must handle "branch already exists", stale branches and merge conflicts. `admin-cms.ts` and its copy also change from "published" to "submitted for review" for the publish path, while draft semantics stay coherent.

Effect on the risk: a stolen token cannot merge its own PR, so both code and content changes pass a human gate and CI must be green before deploy. Residual: the token still has Contents write, so an attacker can create branches and PRs (noise, not a deploy), and the owner must actually review before merging.

Cost: manual review and merge for every publish; more moving parts in the CMS; GitHub-side rules to maintain.

### Option 3 — Status quo plus branch protection and token hygiene

Keep writing directly to `main`; add protections that do not change the workflow.

GitHub:

- Protect `main` (no force push, no deletion, require CI status).
- Keep the PAT fine-grained and minimal, use the shortest practical expiry, rotate on a schedule, watch the audit log, keep one token per use.
- Optionally restrict the deployment branch on the Cloudflare side to `main`.

Cloudflare:

- Unchanged.

`src/lib/github-cms.ts` changes: **none**.

Effect on the risk: protects the branch from accidents and forced rewrites, but not from a compromised token or CMS session — any commit the CMS or token holder can make still deploys immediately. This does not close the audit finding; it only lowers the chance of an unrecoverable mistake.

## Recommendation

Recommend **Option 1 (separate content repository)** as the target: it removes site code from the token's reach instead of relying on review discipline. If the two-repository build integration is too much work right now, **Option 2** is the acceptable interim — it adds a real human gate for every deploy with a much smaller change footprint, and it can later be combined with Option 1.

Option 3 on its own is not recommended as the answer to #12.

Independent hardening that should happen whichever option is chosen:

- Use the shortest practical fine-grained PAT expiry and rotate it; never widen it to a classic repo-wide token.
- Never print `GITHUB_TOKEN`; keep it out of logs, error bodies and build output.
- Alert on unexpected pushes to `main` (GitHub audit log or branch rules).

## Not in scope

This record makes no code, migration or configuration change; audit item #12 asks for a decision document only. The owner must choose an option before implementation starts.

## References

- `src/lib/github-cms.ts` (`repoConfig`, `putContentFile`, `commitFileChanges`)
- `docs/CMS-HTTP-CONTRACT.md`
- `docs/ADMIN-AUTH-ARCHITECTURE.md`
- `AGENTS.md` → "Deploy & production"
- `.github/workflows/ci.yml`
