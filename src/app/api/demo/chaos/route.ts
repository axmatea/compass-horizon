import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { ApiError, armChaos, handle, readJson, requireWorkspace } from '@/server/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const Body = z.object({ afterStep: z.number().int().min(0).max(6) });

/** POST /api/demo/chaos {afterStep} -> { armed: true }. The next run dies after that step (process.exit on Vercel). */
export const POST = handle(async (req: NextRequest) => {
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, 'INVALID_STEP', 'afterStep must be an integer from 0 to 6');
  const ws = await requireWorkspace(req);
  return Response.json(await armChaos(ws, parsed.data.afterStep));
});
