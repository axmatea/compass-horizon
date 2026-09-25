import type { NextRequest } from 'next/server';
import { handle, nextBeat, requireWorkspace } from '@/server/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** POST /api/demo/beat -> { world, run? }. 409 INTERRUPTED while the latest run is interrupted. */
export const POST = handle(async (req: NextRequest) => {
  const ws = await requireWorkspace(req);
  return Response.json(await nextBeat(ws));
});
