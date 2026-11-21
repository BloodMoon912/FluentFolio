import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import {
  GithubCmsError,
  commitFileChanges,
  contentPath,
  listAllContentWithFrontmatter,
} from '../../../../lib/github-cms';
import { dataToFrontmatter, parseFrontmatter, serializeFrontmatter } from '../../../../lib/frontmatter';
import { listDrafts, upsertDraft } from '../../../../lib/cms-drafts';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const oldCategory = typeof body?.oldCategory === 'string' ? body.oldCategory.trim() : '';
  const newCategory = typeof body?.newCategory === 'string' ? body.newCategory.trim() : '';
  if (!oldCategory || !newCategory) {
    return Response.json({ ok: false, error: 'oldCategory 與 newCategory 都是必填。' }, { status: 400 });
  }
  if (oldCategory === 'General') {
    return Response.json({ ok: false, error: 'General 是預設分類，不能重新命名。' }, { status: 400 });
  }
  if (newCategory.length > 80)
    return Response.json({ ok: false, error: '分類名稱不可超過 80 個字元。' }, { status: 400 });
  if (oldCategory === newCategory) return Response.json({ ok: true, touched: 0 });

  try {
    const [posts, drafts] = await Promise.all([listAllContentWithFrontmatter('blog'), listDrafts()]);
    const affected = posts.filter((post) => (post.data.category || 'General') === oldCategory);
    // Blog keeps its original serializer (AGENTS.md). dataToFrontmatter also
    // carries the pubDate -> date fallback, which hand-edited old drafts need.
    const changes = affected.map((post) => ({
      path: contentPath('blog', post.id),
      content: serializeFrontmatter(dataToFrontmatter(post.data, { category: newCategory }), post.body),
    }));
    await commitFileChanges(
      changes,
      `chore(blog): rename category "${oldCategory}" -> "${newCategory}" (${changes.length} posts)`,
    );
    const draftChanges = drafts
      .filter((draft) => draft.slug.startsWith('blog:') || !draft.slug.includes(':'))
      .map((draft) => ({ draft, parsed: parseFrontmatter(draft.content) }))
      .filter(({ parsed }) => (parsed.data.category || 'General') === oldCategory);
    await Promise.all(
      draftChanges.map(({ draft, parsed }) =>
        upsertDraft(
          draft.slug,
          serializeFrontmatter(dataToFrontmatter(parsed.data, { category: newCategory }), parsed.body),
        ),
      ),
    );
    return Response.json(
      {
        ok: true,
        touched: changes.length + draftChanges.length,
        published: changes.length,
        drafts: draftChanges.length,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (err) {
    const status = err instanceof GithubCmsError ? err.status : 502;
    return Response.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status });
  }
};
