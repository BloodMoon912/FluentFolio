import type { APIRoute } from 'astro';
import { passkeyStatus } from '../../../lib/admin-passkeys';

export const prerender = false;
export const GET: APIRoute = passkeyStatus;
