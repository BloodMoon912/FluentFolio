#!/usr/bin/env node
// Bring the private content repository into `src/content` before a build.
//
// Published writing (essays, chapters, dictionary, world entries) no longer
// lives in this repository. It lives in a separate PRIVATE repository that
// keeps the same layout (`src/content/<collection>/<id>.md`), so the admin CMS
// and the Astro collections work unchanged. This script is the bridge:
//
//   npm run fetch:content                       shallow-clone the content repo into src/content
//   npm run fetch:content -- --from ../fluentfolio-content
//                                               mirror a local clone (for `astro dev`)
//
// The content repository is also the site's private overlay:
//
//   site.config.json          identity, nav, feeds, licence, branding paths
//   assets/brand/*            logo, favicon, icons, background video/audio
//   assets/background.webp    still background used by the parallax layer
//
// Those are copied over the generic defaults in this repository, so a theme
// upgrade only ever replaces code, never a site's identity or media.
//
// It runs automatically as `prebuild`, so `npm run build` on Cloudflare Workers
// Builds fetches the content first.
//
// Environment:
//   CONTENT_REPO        `owner/name` (or a full git URL). Default: DEFAULT_CONTENT_REPO.
//   CONTENT_REPO_TOKEN  Fine-grained PAT, Contents: read-only on the content repo.
//                       A Workers Builds *build secret*, never a runtime secret.
//   CONTENT_REF         Branch or tag to fetch. Default: main.
//   CONTENT_REQUIRED    "1": fail the build when content cannot be fetched.
//                       "0": never fail. Unset: required on Workers Builds
//                       (WORKERS_CI is set there), optional everywhere else.
//
// Fail-closed matters: a build that silently ships zero posts would replace the
// live site with an empty one.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_CONTENT_REPO = 'your-name/fluentfolio-content';
export const COLLECTIONS = ['blog', 'novel', 'dictionary', 'world'];

const REPO_SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const GITHUB_HTTPS_PREFIX = 'https://github.com/';
const BRAND_TARGET = join('public', 'brand');
const STILL_BACKGROUND_TARGET = join('src', 'assets', 'background.webp');

/**
 * @typedef {object} ContentConfig
 * @property {string} repo
 * @property {string} ref
 * @property {string} token
 * @property {boolean} required
 */

/**
 * @param {Record<string, string | undefined>} env
 * @returns {ContentConfig}
 */
export function resolveConfig(env) {
  const flag = env.CONTENT_REQUIRED;
  const required = flag === '1' ? true : flag === '0' ? false : Boolean(env.WORKERS_CI);
  return {
    repo: (env.CONTENT_REPO || DEFAULT_CONTENT_REPO).trim(),
    ref: (env.CONTENT_REF || 'main').trim(),
    token: (env.CONTENT_REPO_TOKEN || '').trim(),
    required,
  };
}

/**
 * `owner/name` becomes a GitHub HTTPS URL; anything with a scheme is used as is
 * (this is what lets the tests clone from a local `file://` repository).
 * @param {string} repo
 */
export function repoUrl(repo) {
  if (repo.includes('://')) return repo;
  if (!REPO_SLUG.test(repo)) {
    throw new Error(`CONTENT_REPO must look like "owner/name" or be a full git URL, got "${repo}".`);
  }
  return `${GITHUB_HTTPS_PREFIX}${repo}.git`;
}

/**
 * Git environment that authenticates to github.com without ever putting the
 * token on a command line (process listings and logs) or into `.git/config`.
 * Needs git >= 2.31 for GIT_CONFIG_COUNT.
 * @param {string} token
 * @param {Record<string, string | undefined>} baseEnv
 * @returns {Record<string, string | undefined>}
 */
export function gitEnv(token, baseEnv) {
  /** @type {Record<string, string | undefined>} */
  const env = { ...baseEnv, GIT_TERMINAL_PROMPT: '0' };
  if (token) {
    const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = `http.${GITHUB_HTTPS_PREFIX}.extraheader`;
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${basic}`;
  }
  return env;
}

/**
 * @param {string} text
 * @param {string} token
 */
function redact(text, token) {
  if (!token) return text;
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  return text.split(token).join('***').split(basic).join('***');
}

/** @param {string} dir */
function countMarkdown(dir) {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) total += countMarkdown(full);
    else if (entry.isFile() && entry.name.endsWith('.md')) total += 1;
  }
  return total;
}

/** @param {string} contentDir */
function countAll(contentDir) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const collection of COLLECTIONS) counts[collection] = countMarkdown(join(contentDir, collection));
  return counts;
}

/** @param {Record<string, number>} counts */
function total(counts) {
  return Object.values(counts).reduce((sum, value) => sum + value, 0);
}

/**
 * Copy the private overlay (identity config and brand media) from a content
 * checkout over the generic defaults. Missing pieces are fine: a content repo
 * that only holds Markdown still works.
 *
 * @param {string} sourceRoot
 * @param {string} root
 * @param {(message: string) => void} log
 */
function applyOverlay(sourceRoot, root, log) {
  const copied = [];

  const config = join(sourceRoot, 'site.config.json');
  if (existsSync(config)) {
    cpSync(config, join(root, 'site.config.json'));
    copied.push('site.config.json');
  }

  const brand = join(sourceRoot, 'assets', 'brand');
  if (existsSync(brand)) {
    cpSync(brand, join(root, BRAND_TARGET), { recursive: true });
    copied.push('assets/brand');
  }

  const still = join(sourceRoot, 'assets', 'background.webp');
  if (existsSync(still)) {
    cpSync(still, join(root, STILL_BACKGROUND_TARGET));
    copied.push('assets/background.webp');
  }

  log(
    copied.length > 0
      ? `fetch-content: applied private overlay (${copied.join(', ')}).`
      : 'fetch-content: content repository has no private overlay; keeping the theme defaults.',
  );
}

/**
 * Replace the four collection directories in `target` with the ones from
 * `source`. Only those four directories are touched, and only they are copied:
 * nothing else in the content repository (workflows, README) can reach src/.
 * @param {string} source
 * @param {string} target
 */
function mirrorCollections(source, target) {
  mkdirSync(target, { recursive: true });
  for (const collection of COLLECTIONS) {
    const from = join(source, collection);
    const to = join(target, collection);
    rmSync(to, { recursive: true, force: true });
    if (existsSync(from) && statSync(from).isDirectory()) cpSync(from, to, { recursive: true });
    else mkdirSync(to, { recursive: true });
  }
}

/**
 * @typedef {object} FetchOptions
 * @property {string} root                      Project root (contains `src/`).
 * @property {Record<string, string | undefined>} env
 * @property {string} [from]                    Mirror this local clone instead of cloning.
 * @property {(message: string) => void} [log]
 *
 * @typedef {object} FetchResult
 * @property {'skipped' | 'fetched' | 'synced' | 'empty'} status
 * @property {Record<string, number>} counts
 */

/**
 * @param {FetchOptions} options
 * @returns {FetchResult}
 */
export function fetchContent({ root, env, from, log = () => {} }) {
  const contentDir = join(root, 'src', 'content');

  if (from) {
    const sourceRoot = resolve(root, from);
    const sourceDir = join(sourceRoot, 'src', 'content');
    if (!existsSync(sourceDir)) {
      throw new Error(`--from: "${sourceDir}" does not exist. Point it at a clone of the content repository.`);
    }
    applyOverlay(sourceRoot, root, log);
    mirrorCollections(sourceDir, contentDir);
    const counts = countAll(contentDir);
    log(`fetch-content: mirrored ${total(counts)} Markdown file(s) from ${from}.`);
    return { status: 'synced', counts };
  }

  const existing = countAll(contentDir);
  if (total(existing) > 0) {
    log(`fetch-content: src/content already has ${total(existing)} Markdown file(s); leaving it alone.`);
    return { status: 'skipped', counts: existing };
  }

  const config = resolveConfig(env);

  /** @param {string} reason */
  const unavailable = (reason) => {
    if (config.required) throw new Error(`${reason} Refusing to build a site without its content.`);
    log(`fetch-content: ${reason} Continuing with empty collections (CONTENT_REQUIRED is not set).`);
    mirrorCollections(join(root, '.__no_such_dir__'), contentDir);
    return /** @type {FetchResult} */ ({ status: 'empty', counts: countAll(contentDir) });
  };

  const isGithubHttps = repoUrl(config.repo).startsWith(GITHUB_HTTPS_PREFIX);
  if (isGithubHttps && !config.token) {
    return unavailable('CONTENT_REPO_TOKEN is not set, so the private content repository cannot be cloned.');
  }

  const checkout = mkdtempSync(join(tmpdir(), 'bm-content-'));
  try {
    try {
      execFileSync(
        'git',
        ['clone', '--quiet', '--depth', '1', '--no-tags', '--branch', config.ref, repoUrl(config.repo), checkout],
        { env: gitEnv(config.token, env), stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 },
      );
    } catch (error) {
      const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '';
      const detail = redact(stderr.trim() || (error instanceof Error ? error.message : String(error)), config.token);
      return unavailable(`Cloning ${config.repo}@${config.ref} failed: ${detail}`);
    }

    applyOverlay(checkout, root, log);

    const sourceDir = join(checkout, 'src', 'content');
    if (!existsSync(sourceDir)) {
      return unavailable(`${config.repo}@${config.ref} has no src/content directory.`);
    }

    mirrorCollections(sourceDir, contentDir);
    const counts = countAll(contentDir);
    const head = execFileSync('git', ['-C', checkout, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    log(`fetch-content: fetched ${total(counts)} Markdown file(s) from ${config.repo}@${config.ref} (${head}).`);
    for (const collection of COLLECTIONS) log(`  ${collection}: ${counts[collection]}`);
    return { status: 'fetched', counts };
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
}

function main() {
  const args = process.argv.slice(2);
  const fromIndex = args.indexOf('--from');
  const from = fromIndex === -1 ? undefined : args[fromIndex + 1];
  if (fromIndex !== -1 && !from) {
    console.error('fetch-content: --from needs a path.');
    process.exit(1);
  }
  try {
    fetchContent({
      root: fileURLToPath(new URL('..', import.meta.url)),
      env: process.env,
      from,
      log: (message) => console.log(message),
    });
  } catch (error) {
    console.error(`fetch-content: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
