import type { APIRoute } from 'astro';
import { passkeyLoginVerify } from '../../../../lib/admin-passkeys';

export const prerender = false;
export const POST: APIRoute = passkeyLoginVerify;
