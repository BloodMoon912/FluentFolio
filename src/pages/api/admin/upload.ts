import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { requireAdmin } from '../../../lib/admin-auth';
import { detectImageType, isDeclaredUploadTooLarge, MAX_UPLOAD_BYTES } from '../../../lib/image-signature';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  if (!env.BLOG_IMAGES) {
    return Response.json({ ok: false, error: 'R2 bucket (BLOG_IMAGES binding) is not configured.' }, { status: 503 });
  }
  if (!env.R2_PUBLIC_BASE_URL) {
    return Response.json({ ok: false, error: 'R2_PUBLIC_BASE_URL is not configured.' }, { status: 503 });
  }

  // Cheap rejection before the multipart body is parsed. Content-Length can be
  // absent or inaccurate, so it is only a first line of defence; the byte check
  // below remains authoritative.
  const declaredLength = Number(request.headers.get('content-length') ?? '');
  if (isDeclaredUploadTooLarge(declaredLength)) {
    return Response.json({ ok: false, error: 'Request is too large.' }, { status: 413 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) {
    return Response.json({ ok: false, error: 'Missing "file" field.' }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) {
    return Response.json({ ok: false, error: 'Uploaded file is empty.' }, { status: 400 });
  }
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return Response.json({ ok: false, error: 'File is too large (max 5MB).' }, { status: 413 });
  }

  // The declared MIME is not evidence of the actual format. Decide the
  // extension and R2 content-type from the bytes; anything that is not one of
  // the four raster formats (including SVG/HTML) is rejected here.
  const verified = detectImageType(bytes);
  if (!verified) {
    return Response.json(
      { ok: false, error: 'Unsupported image content. Allowed: jpg, png, webp, gif.' },
      { status: 415 },
    );
  }

  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const key = `blog/${yyyy}/${mm}/${Date.now()}-${randomKeySegment()}.${verified.extension}`;

  await env.BLOG_IMAGES.put(key, bytes, { httpMetadata: { contentType: verified.mime } });

  const publicUrl = `${env.R2_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}`;
  return Response.json({ ok: true, url: publicUrl, key }, { headers: { 'cache-control': 'no-store' } });
};

function randomKeySegment(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}
