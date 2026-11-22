# fluentfolio-content

Private content for My Personal Space. This repository holds writing only; the
site code lives in the separate `fluentfolio` repository.

## Layout

```text
src/content/
  blog/         essays and notes
  novel/        fiction chapters
  dictionary/   conlang entries
  world/        world-building entries
```

The layout is identical to the one the site expects, so the admin CMS
(`/admin`) and the site's collection schemas keep working unchanged. The
schemas themselves are defined in the site repository (`src/content.config.ts`).

## How it reaches the site

1. A save in `/admin` (or a commit here) lands on `main`.
2. `.github/workflows/trigger-site-build.yml` calls the Cloudflare Workers
   Builds deploy hook.
3. The site build runs `scripts/fetch-content.mjs`, which clones this repository
   read-only and copies the four collections into `src/content`.

`draft: true` entries stay in this repository and are left out of the build.

## Rules

- Keep this repository **private**.
- Do not add code, secrets or workflow changes through the CMS token. The CMS
  token only needs Contents: read and write on this repository, with no
  Workflows permission.
- Setup, token scopes and migration steps are in the site repository:
  `docs/PRIVATE-CONTENT-REPO.md`.
