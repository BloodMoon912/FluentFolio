import { env } from 'cloudflare:workers';

// Sends a "new post published" notification to Discord via an Incoming
// Webhook. Fires synchronously, right after the GitHub commit succeeds
// (Plan: Phase 3, "方案 A 不加延遲"). No Queues, no delay — the Cloudflare
// Workers Build that follows the commit usually finishes 1-2 minutes later,
// so the notification can arrive slightly before the site is actually live.

export interface PublishedPostSummary {
  title: string;
  description: string;
  slug: string;
  category: string;
  tags: string[];
  siteUrl: string; // e.g. https://www.example.com
}

const CATEGORY_COLORS: Record<string, number> = {
  General: 0x8b7bff,
  Tech: 0x6edbff,
  Life: 0x63df98,
  Notes: 0xf2c66d,
};

function colorForCategory(category: string): number {
  return CATEGORY_COLORS[category] ?? 0x8b7bff;
}

/** Best-effort: failures here must never block the publish flow itself. */
export async function notifyBlogPublished(post: PublishedPostSummary): Promise<{ ok: boolean; error?: string }> {
  const webhookUrl = env.DISCORD_BLOG_WEBHOOK_URL;
  if (!webhookUrl) return { ok: false, error: 'DISCORD_BLOG_WEBHOOK_URL is not configured' };

  const postUrl = `${post.siteUrl.replace(/\/$/, '')}/posts/blog/${post.slug}`;

  const payload = {
    username: '我的個人空間',
    embeds: [
      {
        title: `📝 新文章發布：${post.title}`,
        description: post.description,
        url: postUrl,
        color: colorForCategory(post.category),
        fields: [
          { name: '分類', value: post.category, inline: true },
          ...(post.tags.length ? [{ name: '標籤', value: post.tags.join(', '), inline: true }] : []),
        ],
        timestamp: new Date().toISOString(),
      },
    ],
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) return { ok: false, error: `Discord webhook returned ${response.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown error' };
  }
}
