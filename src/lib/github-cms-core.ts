import { siteConfig } from '../site.config.ts';
// GitHub-backed content store — HTTP layer.
//
// This module is deliberately free of `cloudflare:workers`: the Worker-facing
// façade in `github-cms.ts` injects the bindings (`GITHUB_*`) and `fetch`, so
// the request/response handling can be unit-tested with a fake `fetch`
// (tests/github-cms.test.ts) while every public signature lives in
// `github-cms.ts` unchanged.
//
// Writes go through the Contents API (one commit per file) unless the caller
// batches them through `commitFileChanges`, which uses the low-level Git Data
// API for a single commit. Reads of a whole collection use one GitHub GraphQL
// query instead of "list the directory, then GET every file" (the admin list
// used to be N+1 requests), and fall back to the REST listing with bounded
// concurrency when GraphQL is unavailable.

// The explicit `.ts` extension is required so `npm test` (plain Node type
// stripping) can import this module directly — same pattern as
// `admin-sessions-core.ts`.
import { parseFrontmatter, type ContentCollection } from './frontmatter.ts';

const BLOG_DIR = 'src/content/blog';
const GITHUB_API = 'https://api.github.com';

/** Concurrency of the REST fallback: one directory listing + one GET per file. */
export const REST_LIST_CONCURRENCY = 6;

export const CONTENT_DIRS: Record<ContentCollection, string> = {
  blog: 'src/content/blog',
  novel: 'src/content/novel',
  dictionary: 'src/content/dictionary',
  world: 'src/content/world',
};

export function contentPath(collection: ContentCollection, id: string): string {
  return `${CONTENT_DIRS[collection]}/${id}.md`;
}

export function blogPathForSlug(slug: string): string {
  return `${BLOG_DIR}/${slug}.md`;
}

export class GithubCmsError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

/** The subset of the Worker `Env` this module needs. */
export interface GithubEnv {
  GITHUB_TOKEN?: string;
  GITHUB_REPO?: string;
  GITHUB_BRANCH?: string;
}

/** `fetch` with the signature this module calls; the façade passes the global one. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Bindings + network, injected so the module stays testable under plain Node. */
export interface GithubContext {
  env: GithubEnv;
  fetch: FetchLike;
}

export interface RepoConfig {
  owner: string;
  repo: string;
  branch: string;
  token: string;
}

/** Resolve `GITHUB_TOKEN` / `GITHUB_REPO` / `GITHUB_BRANCH` at call time. */
export function repoConfigFromEnv(env: GithubEnv): RepoConfig {
  const token = env.GITHUB_TOKEN;
  const repoSlug = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || 'main';
  if (!token || !repoSlug) {
    throw new GithubCmsError('GITHUB_TOKEN / GITHUB_REPO is not configured.', 503);
  }
  const [owner, repo] = repoSlug.split('/');
  if (!owner || !repo) throw new GithubCmsError('GITHUB_REPO must be in "owner/repo" form.', 503);
  return { owner, repo, branch, token };
}

async function githubFetch(ctx: GithubContext, path: string, init?: RequestInit): Promise<Response> {
  const { token } = repoConfigFromEnv(ctx.env);
  return ctx.fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': `${siteConfig.cmsSlug}-admin-cms`,
      ...(init?.headers || {}),
    },
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToText(base64: string): string {
  const cleaned = base64.replace(/\n/g, '');
  const binary = atob(cleaned);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

interface RestContentEntry {
  name: string;
  path: string;
  sha: string;
  type: string;
}

/**
 * One GraphQL query for a whole `src/content/<collection>` directory. `Blob`
 * `text` is the file body, so no per-file request is needed; `oid` is the same
 * git blob SHA the Contents API calls `sha`, which the update/delete paths need.
 */
const DIRECTORY_LISTING_QUERY = `query CmsDirectoryListing($owner: String!, $name: String!, $expression: String!) {
  repository(owner: $owner, name: $name) {
    object(expression: $expression) {
      __typename
      ... on Tree {
        entries {
          name
          type
          object {
            __typename
            ... on Blob {
              oid
              text
            }
          }
        }
      }
    }
  }
}`;

interface GraphqlBlob {
  __typename?: string | null;
  oid?: string | null;
  text?: string | null;
}

interface GraphqlTreeEntry {
  name?: string | null;
  type?: string | null;
  object?: GraphqlBlob | null;
}

interface GraphqlDirectoryPayload {
  data?: {
    repository?: {
      object?: { __typename?: string | null; entries?: Array<GraphqlTreeEntry | null> | null } | null;
    } | null;
  } | null;
  errors?: Array<{ message?: string | null }> | null;
}

interface DirectoryMarkdownFile {
  name: string;
  sha: string;
  content: string;
}

/**
 * Read one collection directory through the GraphQL API.
 *
 * Throws `GithubCmsError` for anything that is not a clean success (HTTP
 * error, GraphQL `errors`, non-Tree object, a blob whose text was withheld
 * because it is binary/oversized): the caller then degrades to the REST
 * listing, which is the established, slower-but-simple path.
 */
async function listDirectoryViaGraphql(ctx: GithubContext, dir: string): Promise<DirectoryMarkdownFile[]> {
  const { owner, repo, branch } = repoConfigFromEnv(ctx.env);
  const response = await githubFetch(ctx, '/graphql', {
    method: 'POST',
    body: JSON.stringify({
      query: DIRECTORY_LISTING_QUERY,
      variables: { owner, name: repo, expression: `${branch}:${dir}` },
    }),
  });
  if (!response.ok) {
    throw new GithubCmsError(`GitHub GraphQL listing failed: ${response.status}`, 502);
  }

  const payload = (await response.json()) as GraphqlDirectoryPayload;
  const graphqlError = payload.errors?.find((error) => error?.message)?.message;
  if (graphqlError) {
    throw new GithubCmsError(`GitHub GraphQL listing failed: ${graphqlError}`.slice(0, 500), 502);
  }

  const repository = payload.data?.repository;
  if (!repository) throw new GithubCmsError('GitHub GraphQL listing failed: repository not found', 502);
  // A directory that does not exist is an empty collection, exactly like the
  // REST listing's 404 branch below.
  const tree = repository.object;
  if (!tree) return [];
  if (tree.__typename !== 'Tree') {
    throw new GithubCmsError('GitHub GraphQL listing failed: object is not a directory', 502);
  }

  const files: DirectoryMarkdownFile[] = [];
  for (const entry of tree.entries ?? []) {
    if (!entry || entry.type !== 'blob' || !entry.name?.endsWith('.md')) continue;
    const blob = entry.object;
    if (blob?.__typename !== 'Blob' || !blob.oid || typeof blob.text !== 'string') {
      throw new GithubCmsError('GitHub GraphQL listing returned a blob without text', 502);
    }
    files.push({ name: entry.name, sha: blob.oid, content: blob.text });
  }
  return files;
}

/**
 * Run `mapper` over `items` with at most `limit` promises in flight, preserving
 * input order. `Promise.all` over a whole directory is what made the old
 * fallback able to open one request per post at once.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface BlogFileSummary {
  slug: string;
  path: string;
  sha: string;
}

export interface BlogFile extends BlogFileSummary {
  content: string; // raw markdown incl. frontmatter
}

/** List every *.md file in src/content/blog (one directory level, no recursion needed today). */
export async function listBlogFiles(ctx: GithubContext): Promise<BlogFileSummary[]> {
  const { owner, repo, branch } = repoConfigFromEnv(ctx.env);
  const response = await githubFetch(
    ctx,
    `/repos/${owner}/${repo}/contents/${BLOG_DIR}?ref=${encodeURIComponent(branch)}`,
  );
  if (response.status === 404) return [];
  if (!response.ok) throw new GithubCmsError(`GitHub list failed: ${response.status}`, 502);

  const entries = (await response.json()) as RestContentEntry[];
  return entries
    .filter((entry) => entry.type === 'file' && entry.name.endsWith('.md'))
    .map((entry) => ({ slug: entry.name.replace(/\.md$/, ''), path: entry.path, sha: entry.sha }));
}

/** Fetch one post's raw content + sha (sha is required to update/delete it). */
export async function getBlogFile(ctx: GithubContext, slug: string): Promise<BlogFile | null> {
  const { owner, repo, branch } = repoConfigFromEnv(ctx.env);
  const path = `${BLOG_DIR}/${slug}.md`;
  const response = await githubFetch(ctx, `/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new GithubCmsError(`GitHub get failed: ${response.status}`, 502);

  const data = (await response.json()) as { content: string; sha: string };
  return { slug, path, sha: data.sha, content: base64ToText(data.content) };
}

/**
 * Create or update a post. Pass `sha` (from getBlogFile/listBlogFiles) when
 * updating an existing file — GitHub rejects the write without it, which also
 * protects against silently clobbering a concurrent edit.
 */
export async function putBlogFile(
  ctx: GithubContext,
  slug: string,
  content: string,
  message: string,
  sha?: string,
): Promise<{ sha: string }> {
  const { owner, repo, branch } = repoConfigFromEnv(ctx.env);
  const path = `${BLOG_DIR}/${slug}.md`;
  const response = await githubFetch(ctx, `/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      branch,
      content: bytesToBase64(new TextEncoder().encode(content)),
      ...(sha ? { sha } : {}),
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new GithubCmsError(`GitHub write failed: ${response.status} ${detail}`.slice(0, 500), 502);
  }
  const data = (await response.json()) as { content: { sha: string } };
  return { sha: data.content.sha };
}

export async function deleteBlogFile(ctx: GithubContext, slug: string, sha: string, message: string): Promise<void> {
  const { owner, repo, branch } = repoConfigFromEnv(ctx.env);
  const path = `${BLOG_DIR}/${slug}.md`;
  const response = await githubFetch(ctx, `/repos/${owner}/${repo}/contents/${path}`, {
    method: 'DELETE',
    body: JSON.stringify({ message, branch, sha }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new GithubCmsError(`GitHub delete failed: ${response.status} ${detail}`.slice(0, 500), 502);
  }
}

export interface FullPost {
  slug: string;
  sha: string;
  data: Record<string, any>;
  body: string;
}

export interface ContentFileSummary {
  collection: ContentCollection;
  id: string;
  path: string;
  sha: string;
}

export interface ContentFile extends ContentFileSummary {
  content: string;
}

export interface FullContentEntry {
  collection: ContentCollection;
  id: string;
  sha: string;
  data: Record<string, any>;
  body: string;
}

export async function listContentFiles(
  ctx: GithubContext,
  collection: ContentCollection,
): Promise<ContentFileSummary[]> {
  const { owner, repo, branch } = repoConfigFromEnv(ctx.env);
  const dir = CONTENT_DIRS[collection];
  const response = await githubFetch(ctx, `/repos/${owner}/${repo}/contents/${dir}?ref=${encodeURIComponent(branch)}`);
  if (response.status === 404) return [];
  if (!response.ok) throw new GithubCmsError(`GitHub list failed: ${response.status}`, 502);

  const entries = (await response.json()) as RestContentEntry[];
  return entries
    .filter((entry) => entry.type === 'file' && entry.name.endsWith('.md'))
    .map((entry) => ({
      collection,
      id: entry.name.replace(/\.md$/, ''),
      path: entry.path,
      sha: entry.sha,
    }));
}

export async function getContentFile(
  ctx: GithubContext,
  collection: ContentCollection,
  id: string,
): Promise<ContentFile | null> {
  const { owner, repo, branch } = repoConfigFromEnv(ctx.env);
  const path = contentPath(collection, id);
  const response = await githubFetch(ctx, `/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new GithubCmsError(`GitHub get failed: ${response.status}`, 502);
  const data = (await response.json()) as { content: string; sha: string };
  return { collection, id, path, sha: data.sha, content: base64ToText(data.content) };
}

export async function putContentFile(
  ctx: GithubContext,
  collection: ContentCollection,
  id: string,
  content: string,
  message: string,
  sha?: string,
): Promise<{ sha: string }> {
  const { owner, repo, branch } = repoConfigFromEnv(ctx.env);
  const path = contentPath(collection, id);
  const response = await githubFetch(ctx, `/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      branch,
      content: bytesToBase64(new TextEncoder().encode(content)),
      ...(sha ? { sha } : {}),
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new GithubCmsError(`GitHub write failed: ${response.status} ${detail}`.slice(0, 500), 502);
  }
  const data = (await response.json()) as { content: { sha: string } };
  return { sha: data.content.sha };
}

export async function deleteContentFile(
  ctx: GithubContext,
  collection: ContentCollection,
  id: string,
  sha: string,
  message: string,
): Promise<void> {
  const { owner, repo, branch } = repoConfigFromEnv(ctx.env);
  const path = contentPath(collection, id);
  const response = await githubFetch(ctx, `/repos/${owner}/${repo}/contents/${path}`, {
    method: 'DELETE',
    body: JSON.stringify({ message, branch, sha }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new GithubCmsError(`GitHub delete failed: ${response.status} ${detail}`.slice(0, 500), 502);
  }
}

/** The REST N+1 path, kept as the GraphQL fallback with bounded concurrency. */
async function listAllEntriesViaRest(ctx: GithubContext, collection: ContentCollection): Promise<FullContentEntry[]> {
  const files = await listContentFiles(ctx, collection);
  const results = await mapWithConcurrency(files, REST_LIST_CONCURRENCY, async (file) => {
    const full = await getContentFile(ctx, collection, file.id);
    if (!full) return null;
    const { data, body } = parseFrontmatter(full.content);
    return { collection, id: file.id, sha: full.sha, data, body };
  });
  return results.filter((entry): entry is FullContentEntry => entry !== null);
}

/**
 * Every *.md entry of one collection with parsed frontmatter: one GraphQL
 * request on the happy path, the REST listing + one GET per file otherwise.
 */
async function listAllEntries(ctx: GithubContext, collection: ContentCollection): Promise<FullContentEntry[]> {
  const dir = CONTENT_DIRS[collection];
  try {
    const files = await listDirectoryViaGraphql(ctx, dir);
    return files.map((file) => {
      const { data, body } = parseFrontmatter(file.content);
      return { collection, id: file.name.replace(/\.md$/, ''), sha: file.sha, data, body };
    });
  } catch (error) {
    // GraphQL is an optimisation, not a requirement. A misconfiguration
    // (503) is not worth a second attempt, but any GraphQL/API/network
    // failure degrades to the REST listing without changing the result shape.
    if (error instanceof GithubCmsError && error.status === 503) throw error;
    console.warn('[github-cms] GraphQL directory listing failed, falling back to REST:', error);
    return listAllEntriesViaRest(ctx, collection);
  }
}

/** Every blog post with parsed frontmatter (one GraphQL query, REST fallback). */
export async function listAllPostsWithFrontmatter(ctx: GithubContext): Promise<FullPost[]> {
  const entries = await listAllEntries(ctx, 'blog');
  return entries.map(({ id, sha, data, body }) => ({ slug: id, sha, data, body }));
}

/** Every entry of any collection with parsed frontmatter (GraphQL, REST fallback). */
export async function listAllContentWithFrontmatter(
  ctx: GithubContext,
  collection: ContentCollection,
): Promise<FullContentEntry[]> {
  return listAllEntries(ctx, collection);
}

export interface FileChange {
  /** Repo-relative path, e.g. "src/content/blog/my-post.md". */
  path: string;
  /** New file content, or null to delete this path. */
  content: string | null;
}

/**
 * Commit multiple file changes (writes and/or deletes) as a SINGLE git commit
 * and a single push, using the low-level Git Data API instead of the
 * one-file-per-commit Contents API. This is what batch post operations and tag
 * rename/delete use, so selecting 20 posts and renaming a tag produces one
 * commit (and one Cloudflare Workers Build) instead of 20.
 *
 * No-op safe: if `changes` is empty, returns without hitting the network.
 */
export async function commitFileChanges(
  ctx: GithubContext,
  changes: FileChange[],
  message: string,
): Promise<{ commitSha: string } | null> {
  if (changes.length === 0) return null;
  const { owner, repo, branch } = repoConfigFromEnv(ctx.env);

  // 1. Where does the branch currently point?
  const refRes = await githubFetch(ctx, `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  if (!refRes.ok) throw new GithubCmsError(`GitHub read ref failed: ${refRes.status}`, 502);
  const refData = (await refRes.json()) as { object: { sha: string } };
  const baseCommitSha = refData.object.sha;

  // 2. What tree does that commit point to?
  const commitRes = await githubFetch(ctx, `/repos/${owner}/${repo}/git/commits/${baseCommitSha}`);
  if (!commitRes.ok) throw new GithubCmsError(`GitHub read commit failed: ${commitRes.status}`, 502);
  const commitData = (await commitRes.json()) as { tree: { sha: string } };
  const baseTreeSha = commitData.tree.sha;

  // 3. Upload a blob for every file being written (deletes need no blob).
  const treeEntries: Array<{ path: string; mode: string; type: string; sha: string | null }> = [];
  for (const change of changes) {
    if (change.content === null) {
      treeEntries.push({ path: change.path, mode: '100644', type: 'blob', sha: null });
      continue;
    }
    const blobRes = await githubFetch(ctx, `/repos/${owner}/${repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: bytesToBase64(new TextEncoder().encode(change.content)), encoding: 'base64' }),
    });
    if (!blobRes.ok) throw new GithubCmsError(`GitHub create blob failed: ${blobRes.status}`, 502);
    const blobData = (await blobRes.json()) as { sha: string };
    treeEntries.push({ path: change.path, mode: '100644', type: 'blob', sha: blobData.sha });
  }

  // 4. Build a new tree on top of the base tree with just those paths changed.
  const treeRes = await githubFetch(ctx, `/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
  });
  if (!treeRes.ok) throw new GithubCmsError(`GitHub create tree failed: ${treeRes.status}`, 502);
  const treeData = (await treeRes.json()) as { sha: string };

  // 5. One commit for the whole batch.
  const newCommitRes = await githubFetch(ctx, `/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree: treeData.sha, parents: [baseCommitSha] }),
  });
  if (!newCommitRes.ok) throw new GithubCmsError(`GitHub create commit failed: ${newCommitRes.status}`, 502);
  const newCommitData = (await newCommitRes.json()) as { sha: string };

  // 6. Move the branch to the new commit — this is the single push/trigger.
  const updateRefRes = await githubFetch(ctx, `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: newCommitData.sha, force: false }),
  });
  if (!updateRefRes.ok) {
    const detail = await updateRefRes.text().catch(() => '');
    throw new GithubCmsError(
      `GitHub update ref failed: ${updateRefRes.status} ${detail}`.slice(0, 500) +
        ' (someone/something else committed in the meantime — retry the batch operation.)',
      409,
    );
  }

  return { commitSha: newCommitData.sha };
}
