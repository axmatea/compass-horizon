import { handle, health } from '@/server/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** GET /api/health -> { ok, db, providers, deployment } */
export const GET = handle(async () => Response.json(await health(), { headers: { 'Cache-Control': 'no-store' } }));
