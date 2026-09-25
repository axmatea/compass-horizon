import type { NextRequest } from 'next/server';
import { handle, requireWorkspace, resetDemo } from '@/server/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** POST /api/demo/reset -> { world } */
export const POST = handle(async (req: NextRequest) => {
  const ws = await requireWorkspace(req);
  return Response.json(await resetDemo(ws));
});
