import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../../lib/admin-auth';
import { GithubCmsError, deleteContentFile, getContentFile, putContentFile } from '../../../../../lib/github-cms';
import { deleteDraft, getDraft, upsertDraft } from '../../../../../lib/cms-drafts';
import { parseFrontmatter, serializeContentFrontmatter, type ContentCollection } from '../../../../../lib/frontmatter';
import { draftKey, isContentCollection, normalizeContentData } from '../../../../../lib/content-admin';
import { notifyBlogPublished } from '../../../../../lib/discord-notify';
import { contentWarnings } from '../../content';

export const prerender = false;

function collectionAndId(
  params: Record<string, string | undefined>,
): { collection: ContentCollection; id: string } | null {
  const collection = params.collection;
  const id = params.id ?? '';
  if (!collection || !isContentCollection(collection) || !id) return null;
  // The id becomes a repo path (`src/content/<collection>/<id>.md`), so a path
  // segment smuggled through the URL must never be able to escape it.
  if (id.length > 200 || id === '.' || id === '..' || /[\\/]/.test(id)) return null;
  return { collection, id };
}

export const GET: APIRoute = async ({ request, params }) => {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  const target = collectionAndId(params);
  if (!target) return Response.json({ ok: false, error: 'Unknown collection or id.' }, { status: 400 });

  try {
    const [draft, file] = await Promise.all([
      getDraft(draftKey(target.collection, target.id)),
      getContentFile(target.collection, target.id),
    ]);
    if (draft) {
      const { data, body } = parseFrontmatter(draft.content);
      return Response.json(
        {
          ok: true,
          collection: target.collection,
          id: target.id,
          sha: file?.sha ?? null,
          data,
          body,
          draftOnly: !file,
          draftUpdatedAt: draft.updatedAt,
        },
        { headers: { 'cache-control': 'no-store' } },
      );
    }
    if (!file) return Response.json({ ok: false, error: 'Not found.' }, { status: 404 });
    const { data, body } = parseFrontmatter(file.content);
    return Response.json(
      { ok: true, collection: target.collection, id: target.id, sha: file.sha, data, body, draftOnly: false },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (err) {
    const status = err instanceof GithubCmsError ? err.status : 502;
    return Response.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status });
  }
};

export const POST: APIRoute = async ({ request, params, site, url }) => {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  const target = collectionAndId(params);
  if (!target) return Response.json({ ok: false, error: 'Unknown collection or id.' }, { status: 400 });

  const body = await request.json().catch(() => null);
  if (!body) return Response.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });

  if (body.action === 'delete') {
    try {
      const [existing, draft] = await Promise.all([
        getContentFile(target.collection, target.id),
        getDraft(draftKey(target.collection, target.id)),
      ]);
      if (!existing && !draft) return Response.json({ ok: false, error: 'Not found.' }, { status: 404 });

      if (existing) {
        await deleteContentFile(
          target.collection,
          target.id,
          existing.sha,
          `chore(${target.collection}): delete "${target.id}"`,
        );
      }
      await deleteDraft(draftKey(target.collection, target.id));
      return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
    } catch (err) {
      const status = err instanceof GithubCmsError ? err.status : 502;
      return Response.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status });
    }
  }
  if (body.action !== undefined && body.action !== 'save') {
    return Response.json({ ok: false, error: 'Unknown content action.' }, { status: 400 });
  }

  try {
    const [draft, existing] = await Promise.all([
      getDraft(draftKey(target.collection, target.id)),
      getContentFile(target.collection, target.id),
    ]);
    if (!draft && !existing) return Response.json({ ok: false, error: 'Not found.' }, { status: 404 });

    const previous = parseFrontmatter(draft?.content ?? existing!.content);
    const normalized = normalizeContentData(target.collection, {
      ...previous.data,
      ...(body.data ?? body),
      draft: body.draft !== undefined ? Boolean(body.draft) : Boolean(previous.data.draft),
    });
    if (normalized.errors.length > 0) {
      return Response.json(
        { ok: false, error: normalized.errors.join('; '), errors: normalized.errors },
        { status: 400 },
      );
    }

    const markdownBody = body.body !== undefined ? String(body.body) : previous.body;
    const content = serializeContentFrontmatter(target.collection, normalized.data, markdownBody);
    const warnings = await contentWarnings(target.collection, markdownBody);

    if (normalized.data.draft) {
      await upsertDraft(draftKey(target.collection, target.id), content);
      return Response.json(
        { ok: true, collection: target.collection, id: target.id, sha: existing?.sha ?? null, draft: true, warnings },
        { headers: { 'cache-control': 'no-store' } },
      );
    }

    const wasDraft = Boolean(previous.data.draft);
    const result = await putContentFile(
      target.collection,
      target.id,
      content,
      `${wasDraft ? 'feat' : 'chore'}(${target.collection}): ${wasDraft ? 'publish' : 'update'} "${target.id}"`,
      existing?.sha,
    );
    await deleteDraft(draftKey(target.collection, target.id));

    const forceNotify = Boolean(body.notifyOnUpdate);
    const notified =
      target.collection === 'blog' && (wasDraft || forceNotify)
        ? await notifyBlogPublished({
            title: String(normalized.data.title ?? target.id),
            description: String(normalized.data.description ?? ''),
            slug: target.id,
            category: String(normalized.data.category ?? 'General'),
            tags: Array.isArray(normalized.data.tags) ? (normalized.data.tags as string[]) : [],
            siteUrl: site?.toString() || url.origin,
          })
        : null;

    return Response.json(
      { ok: true, collection: target.collection, id: target.id, sha: result.sha, draft: false, notified, warnings },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (err) {
    const status = err instanceof GithubCmsError ? err.status : 502;
    return Response.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status });
  }
};
