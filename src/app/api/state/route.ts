import type { NextRequest } from 'next/server';
import { getStateFor, handle, parseAsOf } from '@/server/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** GET /api/state?asOf=<day>&stage=<STAGE_KEY> -> WorldView */
export const GET = handle(async (req: NextRequest) => {
  const asOf = parseAsOf(req);
  return Response.json(await getStateFor(req, asOf), { headers: { 'Cache-Control': 'no-store' } });
});
