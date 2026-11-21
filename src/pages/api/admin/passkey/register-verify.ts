import type { APIRoute } from 'astro';
import { passkeyRegisterVerify } from '../../../../lib/admin-passkeys';

export const prerender = false;
export const POST: APIRoute = passkeyRegisterVerify;
