import { env } from 'cloudflare:workers';
import type { ContentCollection } from './frontmatter';
import {
  commitFileChanges as commitFileChangesCore,
  deleteBlogFile as deleteBlogFileCore,
  deleteContentFile as deleteContentFileCore,
  getBlogFile as getBlogFileCore,
  getContentFile as getContentFileCore,
  listAllContentWithFrontmatter as listAllContentWithFrontmatterCore,
  listAllPostsWithFrontmatter as listAllPostsWithFrontmatterCore,
  listBlogFiles as listBlogFilesCore,
  listContentFiles as listContentFilesCore,
  putBlogFile as putBlogFileCore,
  putContentFile as putContentFileCore,
  type BlogFile,
  type BlogFileSummary,
  type ContentFile,
  type ContentFileSummary,
  type FileChange,
  type FullContentEntry,
  type FullPost,
  type GithubContext,
} from './github-cms-core';

// Thin wrapper around the GitHub API, scoped to `src/content/*` in this repo.
// Used by the online admin CMS so a deployed Worker (which has no writable
// filesystem) can still create/edit/delete content — every write is a real git
// commit, so full history is preserved and Cloudflare Workers Builds picks it
// up automatically.
//
// The HTTP/GraphQL logic lives in `github-cms-core.ts` (no `cloudflare:workers`
// import, so `node --test` can exercise it against a fake fetch). This file
// keeps the module's public API — every export and signature below is
// unchanged, so callers did not need to move — and injects the runtime
// bindings and global fetch into that core.

export { CONTENT_DIRS, GithubCmsError, blogPathForSlug, contentPath } from './github-cms-core';
export type { BlogFile, BlogFileSummary, ContentFile, ContentFileSummary, FileChange, FullContentEntry, FullPost };

/** The Worker's bindings plus its global `fetch`. */
const context: GithubContext = {
  env,
  fetch: (input, init) => fetch(input, init),
};

/** List every *.md file in src/content/blog (one directory level, no recursion needed today). */
export async function listBlogFiles(): Promise<BlogFileSummary[]> {
  return listBlogFilesCore(context);
}

/** Fetch one post's raw content + sha (sha is required to update/delete it). */
export async function getBlogFile(slug: string): Promise<BlogFile | null> {
  return getBlogFileCore(context, slug);
}

/**
 * Create or update a post. Pass `sha` (from getBlogFile/listBlogFiles) when
 * updating an existing file — GitHub rejects the write without it, which
 * also protects against silently clobbering a concurrent edit.
 */
export async function putBlogFile(
  slug: string,
  content: string,
  message: string,
  sha?: string,
): Promise<{ sha: string }> {
  return putBlogFileCore(context, slug, content, message, sha);
}

export async function deleteBlogFile(slug: string, sha: string, message: string): Promise<void> {
  return deleteBlogFileCore(context, slug, sha, message);
}

/**
 * Fetch every post's full content + parsed frontmatter. This is the shared
 * building block behind the post list, the tags/categories aggregation, and
 * batch operations — anything that needs to reason about "all posts" rather
 * than one at a time. One GraphQL query on success; the REST listing with
 * bounded concurrency when GraphQL is unavailable.
 */
export async function listAllPostsWithFrontmatter(): Promise<FullPost[]> {
  return listAllPostsWithFrontmatterCore(context);
}

export async function listContentFiles(collection: ContentCollection): Promise<ContentFileSummary[]> {
  return listContentFilesCore(context, collection);
}

export async function getContentFile(collection: ContentCollection, id: string): Promise<ContentFile | null> {
  return getContentFileCore(context, collection, id);
}

export async function putContentFile(
  collection: ContentCollection,
  id: string,
  content: string,
  message: string,
  sha?: string,
): Promise<{ sha: string }> {
  return putContentFileCore(context, collection, id, content, message, sha);
}

export async function deleteContentFile(
  collection: ContentCollection,
  id: string,
  sha: string,
  message: string,
): Promise<void> {
  return deleteContentFileCore(context, collection, id, sha, message);
}

export async function listAllContentWithFrontmatter(collection: ContentCollection): Promise<FullContentEntry[]> {
  return listAllContentWithFrontmatterCore(context, collection);
}

/**
 * Commit multiple file changes (writes and/or deletes) as a SINGLE git
 * commit and a single push, using the low-level Git Data API instead of the
 * one-file-per-commit Contents API. This is what batch post operations and
 * tag rename/delete use, so selecting 20 posts and renaming a tag produces
 * one commit (and one Cloudflare Workers Build) instead of 20.
 *
 * No-op safe: if `changes` is empty, returns without hitting the network.
 */
export async function commitFileChanges(changes: FileChange[], message: string): Promise<{ commitSha: string } | null> {
  return commitFileChangesCore(context, changes, message);
}
