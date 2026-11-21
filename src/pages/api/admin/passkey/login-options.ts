import type { APIRoute } from 'astro';
import { passkeyLoginOptions } from '../../../../lib/admin-passkeys';

export const prerender = false;
export const POST: APIRoute = passkeyLoginOptions;
