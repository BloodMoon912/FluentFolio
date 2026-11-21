import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import { GithubCmsError, listAllContentWithFrontmatter } from '../../../lib/github-cms';
import { listDrafts } from '../../../lib/cms-drafts';
import { parseFrontmatter } from '../../../lib/frontmatter';
import { draftKey } from '../../../lib/content-admin';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  try {
    const [posts, drafts] = await Promise.all([listAllContentWithFrontmatter('blog'), listDrafts()]);
    const effective = new Map<string, Record<string, any>>();
    for (const post of posts) effective.set(draftKey('blog', post.id), post.data);
    for (const draft of drafts) {
      const id = draft.slug.startsWith('blog:')
        ? draft.slug.slice('blog:'.length)
        : draft.slug.includes(':')
          ? ''
          : draft.slug;
      if (!id) continue;
      effective.set(draftKey('blog', id), parseFrontmatter(draft.content).data);
    }

    const counts = new Map<string, number>();
    for (const data of effective.values()) {
      const category = typeof data.category === 'string' && data.category.trim() ? data.category.trim() : 'General';
      counts.set(category, (counts.get(category) || 0) + 1);
    }
    const categoryCounts = [...counts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category, 'zh-Hant'));
    const categories = categoryCounts.map((item) => item.category);
    return Response.json({ ok: true, categories, categoryCounts }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    const status = err instanceof GithubCmsError ? err.status : 502;
    return Response.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status });
  }
};
