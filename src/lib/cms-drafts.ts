import { env } from 'cloudflare:workers';

export interface DraftRecord {
  slug: string;
  content: string;
  updatedAt: string;
}

function db(): D1Database {
  if (!env.DB) throw new Error('Cloudflare D1 database is not configured.');
  return env.DB;
}

export async function getDraft(slug: string): Promise<DraftRecord | null> {
  const row = await db()
    .prepare('SELECT slug, content, updated_at FROM cms_drafts WHERE slug = ?1')
    .bind(slug)
    .first<{ slug: string; content: string; updated_at: string }>();
  if (!row) return null;
  return { slug: row.slug, content: row.content, updatedAt: row.updated_at };
}

export async function listDrafts(): Promise<DraftRecord[]> {
  const result = await db()
    .prepare('SELECT slug, content, updated_at FROM cms_drafts ORDER BY updated_at DESC')
    .all<{ slug: string; content: string; updated_at: string }>();
  return result.results.map((row) => ({ slug: row.slug, content: row.content, updatedAt: row.updated_at }));
}

export async function upsertDraft(slug: string, content: string): Promise<void> {
  await db()
    .prepare(
      `
      INSERT INTO cms_drafts (slug, content, updated_at)
      VALUES (?1, ?2, CURRENT_TIMESTAMP)
      ON CONFLICT(slug) DO UPDATE SET
        content = excluded.content,
        updated_at = CURRENT_TIMESTAMP
    `,
    )
    .bind(slug, content)
    .run();
}

export async function deleteDraft(slug: string): Promise<void> {
  await db().prepare('DELETE FROM cms_drafts WHERE slug = ?1').bind(slug).run();
}

export async function deleteDrafts(slugs: string[]): Promise<void> {
  if (slugs.length === 0) return;
  const statements = slugs.map((slug) => db().prepare('DELETE FROM cms_drafts WHERE slug = ?1').bind(slug));
  await db().batch(statements);
}
