import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { GithubCmsError, getBlogFile, listAllPostsWithFrontmatter, putBlogFile } from '../../../../lib/github-cms';
import { deleteDrafts, getDraft, listDrafts, upsertDraft } from '../../../../lib/cms-drafts';
import { draftKey } from '../../../../lib/content-admin';
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

function parseDraftContent(content: string) {
  return parseFrontmatter(content);
}

export const GET: APIRoute = async ({ request }) => {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  try {
    const [posts, drafts] = await Promise.all([listAllPostsWithFrontmatter(), listDrafts()]);
    const summaries = new Map<string, any>();

    for (const { slug, sha, data } of posts) {
      summaries.set(slug, {
        slug,
        sha,
        title: data.title ?? slug,
        description: data.description ?? '',
        date: data.date ?? data.pubDate ?? null,
        type: data.type ?? 'essay',
        updatedDate: data.updatedDate ?? null,
        category: data.category ?? 'General',
        tags: Array.isArray(data.tags) ? data.tags : [],
        draft: Boolean(data.draft),
        featured: Boolean(data.featured),
      });
    }

    for (const draft of drafts) {
      // Drafts are namespaced by collection (`blog:<slug>`); legacy rows may use
      // the bare blog slug. Skip drafts that belong to another collection.
      const key = draft.slug.startsWith('blog:')
        ? draft.slug.slice('blog:'.length)
        : draft.slug.includes(':')
          ? null
          : draft.slug;
      if (!key) continue;
      const { data } = parseDraftContent(draft.content);
      const published = summaries.get(key);
      summaries.set(key, {
        slug: key,
        sha: published?.sha ?? null,
        title: data.title ?? key,
        description: data.description ?? '',
        date: data.date ?? data.pubDate ?? null,
        type: data.type ?? 'essay',
        updatedDate: data.updatedDate ?? null,
        category: data.category ?? 'General',
        tags: Array.isArray(data.tags) ? data.tags : [],
        draft: true,
        featured: Boolean(data.featured),
        draftOnly: !published,
        updatedAt: draft.updatedAt,
      });
    }

    const summaryList = [...summaries.values()].sort(
      (a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')) * -1,
    );
    return Response.json({ ok: true, posts: summaryList }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    const status = err instanceof GithubCmsError ? err.status : 502;
    return Response.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status });
  }
};

export const POST: APIRoute = async ({ request, site, url }) => {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  if (!body) return Response.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });

  const slug = String(body.slug || '').trim();
  if (!isValidSlug(slug)) {
    return Response.json(
      { ok: false, error: 'Slug must be lowercase letters, numbers and hyphens only.' },
      { status: 400 },
    );
  }

  try {
    const [existing, namespacedDraft, legacyDraft] = await Promise.all([
      getBlogFile(slug),
      getDraft(draftKey('blog', slug)),
      getDraft(slug),
    ]);
    if (existing || namespacedDraft || legacyDraft) {
      return Response.json({ ok: false, error: `A post with slug "${slug}" already exists.` }, { status: 409 });
    }

    const frontmatter: PostFrontmatter = {
      title: String(body.title || '').trim(),
      description: String(body.description || '').trim(),
      date: String(body.date || body.pubDate || new Date().toISOString().slice(0, 10)),
      type: String(body.type || 'essay'),
      updatedDate: body.updatedDate ? String(body.updatedDate) : undefined,
      category: String(body.category || 'General'),
      tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
      author: String(body.author || 'Your Name'),
      draft: Boolean(body.draft),
      featured: Boolean(body.featured),
      crawl: normalizeCrawlTier(body.crawl),
      copyProtect: normalizeCopyProtect(body.copyProtect),
    };
    if (!frontmatter.title || !frontmatter.description) {
      return Response.json({ ok: false, error: 'title and description are required.' }, { status: 400 });
    }

    const markdownBody = String(body.body || '');
    const content = serializeFrontmatter(frontmatter, markdownBody);
    if (frontmatter.draft) {
      await upsertDraft(draftKey('blog', slug), content);
      return Response.json(
        { ok: true, slug, draft: true, notified: null },
        { headers: { 'cache-control': 'no-store' } },
      );
    }

    const result = await putBlogFile(slug, content, `feat(blog): publish "${frontmatter.title}"`);
    await deleteDrafts([draftKey('blog', slug), slug]);

    const notified = await notifyBlogPublished({
      title: frontmatter.title,
      description: frontmatter.description,
      slug,
      category: frontmatter.category,
      tags: frontmatter.tags,
      siteUrl: site?.toString() || url.origin,
    });

    return Response.json({ ok: true, slug, sha: result.sha, notified }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    const status = err instanceof GithubCmsError ? err.status : 502;
    return Response.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status });
  }
};
