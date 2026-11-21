import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import { GithubCmsError, listAllContentWithFrontmatter } from '../../../lib/github-cms';
import { listDrafts } from '../../../lib/cms-drafts';
import { parseFrontmatter, type ContentCollection } from '../../../lib/frontmatter';
import { draftKey } from '../../../lib/content-admin';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  try {
    const collections: ContentCollection[] = ['blog', 'novel'];
    const [published, drafts] = await Promise.all([
      Promise.all(collections.map((collection) => listAllContentWithFrontmatter(collection))),
      listDrafts(),
    ]);
    const effective = new Map<string, { collection: ContentCollection; data: Record<string, any> }>();
    for (const entries of published) {
      for (const entry of entries) effective.set(draftKey(entry.collection, entry.id), entry);
    }
    for (const draft of drafts) {
      const separator = draft.slug.indexOf(':');
      const collection = separator > 0 ? draft.slug.slice(0, separator) : 'blog';
      const id = separator > 0 ? draft.slug.slice(separator + 1) : draft.slug;
      if (!collections.includes(collection as ContentCollection) || !id) continue;
      const { data } = parseFrontmatter(draft.content);
      effective.set(draftKey(collection as ContentCollection, id), {
        collection: collection as ContentCollection,
        data,
      });
    }

    const counts = new Map<string, number>();
    for (const entry of effective.values()) {
      const tags: string[] = Array.isArray(entry.data.tags) ? entry.data.tags : [];
      for (const tag of new Set(tags.map((value) => String(value).trim()).filter(Boolean))) {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
    const tags = [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    return Response.json({ ok: true, tags }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    const status = err instanceof GithubCmsError ? err.status : 502;
    return Response.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status });
  }
};
