import { siteConfig } from '../../../../site.config.ts';
import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { GithubCmsError, deleteBlogFile, getBlogFile, putBlogFile } from '../../../../lib/github-cms';
import { deleteDraft, getDraft, upsertDraft } from '../../../../lib/cms-drafts';
import {
  isValidSlug,
  normalizeCopyProtect,
  normalizeCrawlTier,
  parseFrontmatter,
  serializeFrontmatter,
  type PostFrontmatter,
} from '../../../../lib/frontmatter';
import { notifyBlogPublished } from '../../../../lib/discord-notify';

export const prerender = false;

export const GET: APIRoute = async ({ request, params }) => {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const slug = params.slug || '';
  if (!isValidSlug(slug)) return Response.json({ ok: false, error: 'Invalid slug.' }, { status: 400 });

  try {
    const [draft, file] = await Promise.all([getDraft(slug), getBlogFile(slug)]);
    if (draft) {
      const { data, body } = parseFrontmatter(draft.content);
      return Response.json(
        {
          ok: true,
          slug,
          sha: file?.sha ?? null,
          frontmatter: data,
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
      { ok: true, slug, sha: file.sha, frontmatter: data, body, draftOnly: false },
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

  const slug = params.slug || '';
  if (!isValidSlug(slug)) return Response.json({ ok: false, error: 'Invalid slug.' }, { status: 400 });

  const body = await request.json().catch(() => null);
  if (!body) return Response.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });

  if (body.action === 'delete') {
    try {
      const [existing, draft] = await Promise.all([getBlogFile(slug), getDraft(slug)]);
      if (!existing && !draft) return Response.json({ ok: false, error: 'Not found.' }, { status: 404 });
      if (existing) await deleteBlogFile(slug, existing.sha, `chore(blog): delete "${slug}"`);
      await deleteDraft(slug);
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
    const [draftRecord, existing] = await Promise.all([getDraft(slug), getBlogFile(slug)]);
    if (!draftRecord && !existing) return Response.json({ ok: false, error: 'Not found.' }, { status: 404 });

    const previousSource = draftRecord?.content ?? existing!.content;
    const previous = parseFrontmatter(previousSource).data;
    const wasDraft = Boolean(previous.draft);

    const frontmatter: PostFrontmatter = {
      title: String(body.title ?? previous.title ?? '').trim(),
      description: String(body.description ?? previous.description ?? '').trim(),
      date: String(
        body.date ?? body.pubDate ?? previous.date ?? previous.pubDate ?? new Date().toISOString().slice(0, 10),
      ),
      type: String(body.type ?? previous.type ?? 'essay'),
      updatedDate: body.updatedDate
        ? String(body.updatedDate)
        : previous.updatedDate
          ? String(previous.updatedDate)
          : undefined,
      category: String(body.category ?? previous.category ?? 'General'),
      tags: Array.isArray(body.tags) ? body.tags.map(String) : Array.isArray(previous.tags) ? previous.tags : [],
      author: String(body.author ?? previous.author ?? siteConfig.authorName),
      draft: body.draft !== undefined ? Boolean(body.draft) : Boolean(previous.draft),
      featured: body.featured !== undefined ? Boolean(body.featured) : Boolean(previous.featured),
      // Not exposed in the CMS UI; preserve a hand-written value across saves.
      crawl: normalizeCrawlTier(body.crawl ?? previous.crawl),
      copyProtect: normalizeCopyProtect(body.copyProtect ?? previous.copyProtect),
    };
    if (!frontmatter.title || !frontmatter.description) {
      return Response.json({ ok: false, error: 'title and description are required.' }, { status: 400 });
    }

    const markdownBody = body.body !== undefined ? String(body.body) : parseFrontmatter(previousSource).body;
    const content = serializeFrontmatter(frontmatter, markdownBody);

    if (frontmatter.draft) {
      await upsertDraft(slug, content);
      return Response.json(
        { ok: true, slug, sha: existing?.sha ?? null, draft: true, notified: null },
        { headers: { 'cache-control': 'no-store' } },
      );
    }

    const message = wasDraft
      ? `feat(blog): publish "${frontmatter.title}"`
      : `chore(blog): update "${frontmatter.title}"`;
    const result = await putBlogFile(slug, content, message, existing?.sha);

    // Delete the Cloudflare D1 draft only after GitHub accepted the publish.
    await deleteDraft(slug);

    // Only notify on the draft -> published transition, unless the caller
    // explicitly asked to re-notify for this update (e.g. a major rewrite).
    const justPublished = wasDraft && !frontmatter.draft;
    const forceNotify = Boolean(body.notifyOnUpdate) && !frontmatter.draft;
    let notified: { ok: boolean; error?: string } | null = null;
    if (justPublished || forceNotify) {
      notified = await notifyBlogPublished({
        title: frontmatter.title,
        description: frontmatter.description,
        slug,
        category: frontmatter.category,
        tags: frontmatter.tags,
        siteUrl: site?.toString() || url.origin,
      });
    }

    return Response.json({ ok: true, slug, sha: result.sha, notified }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    const status = err instanceof GithubCmsError ? err.status : 502;
    return Response.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status });
  }
};
