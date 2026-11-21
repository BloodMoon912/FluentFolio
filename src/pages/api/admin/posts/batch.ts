import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import {
  GithubCmsError,
  blogPathForSlug,
  commitFileChanges,
  listAllPostsWithFrontmatter,
} from '../../../../lib/github-cms';
import {
  dataToFrontmatter,
  isValidSlug,
  parseFrontmatter,
  serializeFrontmatter,
  type PostFrontmatter,
} from '../../../../lib/frontmatter';
import { deleteDrafts, listDrafts, upsertDraft } from '../../../../lib/cms-drafts';
import { draftKey } from '../../../../lib/content-admin';

export const prerender = false;

type BatchAction = 'delete' | 'set-draft' | 'set-featured' | 'set-category' | 'add-tag' | 'remove-tag';
const VALID_ACTIONS: BatchAction[] = ['delete', 'set-draft', 'set-featured', 'set-category', 'add-tag', 'remove-tag'];

const ACTION_LABEL: Record<BatchAction, string> = {
  delete: '刪除',
  'set-draft': '設定草稿狀態',
  'set-featured': '設定精選狀態',
  'set-category': '設定分類',
  'add-tag': '新增標籤',
  'remove-tag': '移除標籤',
};

export const POST: APIRoute = async ({ request }) => {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const action = body?.action as BatchAction;
  const requestedSlugs: string[] = Array.isArray(body?.slugs)
    ? body.slugs.filter((s: unknown) => typeof s === 'string')
    : [];

  if (!VALID_ACTIONS.includes(action)) {
    return Response.json(
      { ok: false, error: `Unknown action. Expected one of: ${VALID_ACTIONS.join(', ')}` },
      { status: 400 },
    );
  }
  if (requestedSlugs.length === 0) {
    return Response.json({ ok: false, error: 'slugs must be a non-empty array.' }, { status: 400 });
  }
  const value = String(body?.value || '').trim();
  if ((action === 'set-category' || action === 'add-tag' || action === 'remove-tag') && !value) {
    return Response.json({ ok: false, error: `"${action}" requires a non-empty "value".` }, { status: 400 });
  }

  try {
    // Load every affected post's current content in one shot, so the whole
    // batch can be turned into a single commit below.
    const [allPosts, allDrafts] = await Promise.all([listAllPostsWithFrontmatter(), listDrafts()]);
    const bySlug = new Map(allPosts.map((p) => [p.slug, p]));
    // Drafts override published content everywhere else in the CMS (single GET,
    // editor save, tag/category rename). A batch edit that only touched the
    // GitHub file would be silently overwritten the next time that draft is
    // loaded, so the draft copy has to be updated in the same operation.
    const draftsBySlug = new Map(allDrafts.map((draft) => [draft.slug, draft]));

    const errors: Array<{ slug: string; error: string }> = [];
    const changes: Array<{ path: string; content: string | null }> = [];
    const touchedSlugs: string[] = [];
    const draftUpdates: Array<{ slug: string; content: string }> = [];

    /** Apply the batch action to one frontmatter record (published or draft). */
    const applyPatch = (data: Record<string, any>): PostFrontmatter => {
      if (action === 'set-draft') return dataToFrontmatter(data, { draft: Boolean(body?.draft) });
      if (action === 'set-featured') return dataToFrontmatter(data, { featured: Boolean(body?.featured) });
      if (action === 'set-category') return dataToFrontmatter(data, { category: value });
      const currentTags: string[] = Array.isArray(data.tags) ? data.tags : [];
      return action === 'add-tag'
        ? dataToFrontmatter(data, { tags: [...new Set([...currentTags, value])] })
        : dataToFrontmatter(data, {
            tags: currentTags.filter((tag) => tag !== value),
          });
    };

    for (const slug of requestedSlugs) {
      // The slug becomes a repository path (`src/content/blog/<slug>.md`).
      if (!isValidSlug(slug)) {
        errors.push({ slug, error: 'Invalid slug.' });
        continue;
      }

      const post = bySlug.get(slug);
      if (!post) {
        errors.push({ slug, error: 'Not found.' });
        continue;
      }

      if (action === 'delete') {
        changes.push({ path: blogPathForSlug(slug), content: null });
        touchedSlugs.push(slug);
        continue;
      }

      const frontmatter = applyPatch(post.data);
      changes.push({ path: blogPathForSlug(slug), content: serializeFrontmatter(frontmatter, post.body) });
      touchedSlugs.push(slug);

      const draft = draftsBySlug.get(draftKey('blog', slug)) ?? draftsBySlug.get(slug);
      if (draft) {
        const parsed = parseFrontmatter(draft.content);
        draftUpdates.push({
          slug: draft.slug,
          content: serializeFrontmatter(applyPatch(parsed.data), parsed.body),
        });
      }
    }

    if (changes.length > 0) {
      const message = `chore(blog): batch ${ACTION_LABEL[action]} (${changes.length} posts)`;
      await commitFileChanges(changes, message);
    }

    if (action === 'delete') {
      // Deleting the GitHub file only would leave the D1 draft behind; the
      // draft-first GET would then resurrect the deleted post as a draft card.
      // Both the namespaced key and the legacy bare-slug key are cleared.
      await deleteDrafts(touchedSlugs.flatMap((slug) => [draftKey('blog', slug), slug]));
    } else {
      await Promise.all(draftUpdates.map(({ slug, content }) => upsertDraft(slug, content)));
    }

    return Response.json(
      { ok: true, touched: touchedSlugs.length, drafts: action === 'delete' ? 0 : draftUpdates.length, errors },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (err) {
    const status = err instanceof GithubCmsError ? err.status : 502;
    return Response.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' }, { status });
  }
};
