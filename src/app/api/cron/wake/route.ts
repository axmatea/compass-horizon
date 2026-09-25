import type { NextRequest } from 'next/server';
import { ApiError, cronWake, handle } from '@/server/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** GET /api/cron/wake: wakes LIVE workspaces. Protected by CRON_SECRET (Authorization: Bearer) when set. */
export const GET = handle(async (req: NextRequest) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) throw new ApiError(401, 'UNAUTHORIZED', 'Missing or invalid cron secret');
  return Response.json(await cronWake());
});
