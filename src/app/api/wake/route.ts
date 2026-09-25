import type { NextRequest } from 'next/server';
import { handle, requireWorkspace, wakeNow } from '@/server/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** POST /api/wake -> { world, run }. Resumes an interrupted run first. */
export const POST = handle(async (req: NextRequest) => {
  const ws = await requireWorkspace(req);
  return Response.json(await wakeNow(ws, 'MANUAL'));
});
