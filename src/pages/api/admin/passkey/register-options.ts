import type { APIRoute } from 'astro';
import { passkeyRegisterOptions } from '../../../../lib/admin-passkeys';

export const prerender = false;
export const POST: APIRoute = passkeyRegisterOptions;
