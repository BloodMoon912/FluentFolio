import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import {
  GithubCmsError,
  commitFileChanges,
  contentPath,
  listAllContentWithFrontmatter,
} from '../../../../lib/github-cms';
import {
  dataToFrontmatter,
  parseFrontmatter,
  serializeContentFrontmatter,
  serializeFrontmatter,
  type ContentCollection,
} from '../../../../lib/frontmatter';
import { listDrafts, upsertDraft } from '../../../../lib/cms-drafts';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const tag = typeof body?.tag === 'string' ? body.tag.trim() : '';
  if (!tag) return Response.json({ ok: false, error: '請提供 tag。' }, { status: 400 });

  try {
    const collections: ContentCollection[] = ['blog', 'novel'];
    const [entryGroups, drafts] = await Promise.all([
      Promise.all(collections.map((collection) => listAllContentWithFrontmatter(collection))),
      listDrafts(),
    ]);
    const entries = entryGroups.flat();
    const affected = entries.filter((entry) => Array.isArray(entry.data.tags) && entry.data.tags.includes(tag));
    // Blog keeps its original serializer (AGENTS.md); novel uses the generic one.
    const changes = affected.map((entry) => {
      const nextTags = (entry.data.tags as string[]).filter((value) => value !== tag);
      return {
        path: contentPath(entry.collection, entry.id),
        content:
          entry.collection === 'blog'
            ? serializeFrontmatter(dataToFrontmatter(entry.data, { tags: nextTags }), entry.body)
            : serializeContentFrontmatter(entry.collection, { ...entry.data, tags: nextTags }, entry.body),
      };
    });
    await commitFileChanges(changes, `chore(content): remove tag "${tag}" (${changes.length} entries)`);
    const draftChanges = drafts
      .map((draft) => {
        const separator = draft.slug.indexOf(':');
        const collection = (separator > 0 ? draft.slug.slice(0, separator) : 'blog') as ContentCollection;
        return { draft, collection, parsed: parseFrontmatter(draft.content) };
      })
      .filter(
        ({ collection, parsed }) =>
          collections.includes(collection) && Array.isArray(parsed.data.tags) && parsed.data.tags.includes(tag),
      );
    await Promise.all(
      draftChanges.map(({ draft, collection, parsed }) => {
        const data = { ...parsed.data, tags: (parsed.data.tags as string[]).filter((value) => value !== tag) };
        return upsertDraft(
          draft.slug,
          collection === 'blog'
            ? serializeFrontmatter(dataToFrontmatter(data), parsed.body)
            : serializeContentFrontmatter(collection, data, parsed.body),
        );
      }),
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
