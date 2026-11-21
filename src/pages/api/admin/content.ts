import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import {
  GithubCmsError,
  getContentFile,
  listAllContentWithFrontmatter,
  listContentFiles,
  putContentFile,
} from '../../../lib/github-cms';
import { deleteDraft, listDrafts, upsertDraft } from '../../../lib/cms-drafts';
import { parseFrontmatter, serializeContentFrontmatter, type ContentCollection } from '../../../lib/frontmatter';
import {
  draftKey,
  isContentCollection,
  normalizeContentData,
  validateLoreReferences,
} from '../../../lib/content-admin';
import { notifyBlogPublished } from '../../../lib/discord-notify';

export const prerender = false;

function requireCollection(value: unknown): ContentCollection | null {
  return typeof value === 'string' && isContentCollection(value) ? value : null;
}

function draftNamespaces(collection: ContentCollection): string {
  return `${collection}:`;
}

/** Published files + D1 drafts merged into one list, newest draft first. */
export const GET: APIRoute = async ({ request, url }) => {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const requested = url.searchParams.get('collection');
  const collections: ContentCollection[] = requested
    ? requireCollection(requested)
      ? [requested as ContentCollection]
      : []
    : ['blog', 'novel', 'dictionary', 'world'];
  if (collections.length === 0) {
    return Response.json({ ok: false, error: 'Unknown collection.' }, { status: 400 });
  }

  try {
    const drafts = await listDrafts();
    const items: Array<Record<string, unknown>> = [];

    for (const collection of collections) {
      const entries = await listAllContentWithFrontmatter(collection);
      const collectionDrafts = new Map<string, { data: Record<string, any>; updatedAt: string }>();
      for (const draft of drafts) {
        if (!draft.slug.startsWith(draftNamespaces(collection))) continue;
        const id = draft.slug.slice(draftNamespaces(collection).length);
        if (!id) continue;
        collectionDrafts.set(id, { data: parseFrontmatter(draft.content).data, updatedAt: draft.updatedAt });
      }

      // One row per effective entry: the D1 draft overrides the published file,
      // exactly like the single-entry GET and the editor save path. Returning
      // both rows made the CMS list show the same post twice.
      for (const entry of entries) {
        const draft = collectionDrafts.get(entry.id);
        const data = draft?.data ?? entry.data;
        items.push({
          collection,
          id: entry.id,
          sha: entry.sha,
          data,
          draft: draft ? true : Boolean(entry.data.draft),
          ...(draft ? { draftOnly: false, updatedAt: draft.updatedAt } : {}),
        });
        collectionDrafts.delete(entry.id);
      }
      for (const [id, draft] of collectionDrafts) {
        items.push({
          collection,
          id,
          sha: null,
          data: draft.data,
          draft: true,
          draftOnly: true,
          updatedAt: draft.updatedAt,
        });
      }
    }

    return Response.json({ ok: true, items }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    const status = err instanceof GithubCmsError ? err.status : 502;
    return Response.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status });
  }
};

/** Create a new entry in any collection (drafts go to D1, publish goes to GitHub). */
export const POST: APIRoute = async ({ request, site, url }) => {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  if (!body) return Response.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });

  const collection = requireCollection(body.collection);
  if (!collection) return Response.json({ ok: false, error: 'Unknown collection.' }, { status: 400 });
  const id = String(body.id ?? '').trim();
  if (!id || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
    return Response.json({ ok: false, error: 'id must be lowercase letters, numbers and hyphens.' }, { status: 400 });
  }

  const normalized = normalizeContentData(collection, body.data ?? body);
  if (normalized.errors.length > 0) {
    return Response.json(
      { ok: false, error: normalized.errors.join('; '), errors: normalized.errors },
      { status: 400 },
    );
  }

  try {
    const existing = await getContentFile(collection, id);
    if (existing) return Response.json({ ok: false, error: `"${id}" already exists.` }, { status: 409 });

    const markdownBody = String(body.body ?? '');
    const content = serializeContentFrontmatter(collection, normalized.data, markdownBody);
    const warnings = await contentWarnings(collection, markdownBody);

    if (body.draft !== false) {
      await upsertDraft(draftKey(collection, id), content);
      return Response.json(
        { ok: true, collection, id, draft: true, warnings },
        { headers: { 'cache-control': 'no-store' } },
      );
    }

    const result = await putContentFile(collection, id, content, `feat(${collection}): publish "${id}"`);
    await deleteDraft(draftKey(collection, id));
    const notified =
      collection === 'blog'
        ? await notifyBlogPublished({
            title: String(normalized.data.title ?? id),
            description: String(normalized.data.description ?? ''),
            slug: id,
            category: String(normalized.data.category ?? 'General'),
            tags: Array.isArray(normalized.data.tags) ? (normalized.data.tags as string[]) : [],
            siteUrl: site?.toString() || url.origin,
          })
        : null;
    return Response.json(
      { ok: true, collection, id, sha: result.sha, draft: false, notified, warnings },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (err) {
    const status = err instanceof GithubCmsError ? err.status : 502;
    return Response.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status });
  }
};

/** `[[word]]` hints against the published dictionary ids; never blocks a save. */
export async function loreWarnings(collection: ContentCollection, body: string): Promise<string[]> {
  if (collection === 'dictionary' || collection === 'world' || !body.includes('[[')) return [];
  try {
    const dictionary = await listContentFiles('dictionary');
    return validateLoreReferences(
      body,
      dictionary.map((entry) => entry.id),
    );
  } catch {
    return [];
  }
}

/** Cheap mirror of the validate-markdown pre-publish hints that fit a Worker. */
export async function contentWarnings(collection: ContentCollection, body: string): Promise<string[]> {
  const warnings: string[] = [];
  if (!body.trim()) warnings.push('內文為空');
  warnings.push(...(await loreWarnings(collection, body)));
  return warnings;
}
