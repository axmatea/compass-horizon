import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { advance, ApiError, handle, readJson, requireWorkspace } from '@/server/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const Body = z.object({ days: z.number().int().min(1).max(30) });

/** POST /api/demo/advance {days} -> { world, run? } */
export const POST = handle(async (req: NextRequest) => {
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'INVALID_DAYS', 'days must be an integer from 1 to 30');
  const ws = await requireWorkspace(req);
  return Response.json(await advance(ws, parsed.data.days));
});
