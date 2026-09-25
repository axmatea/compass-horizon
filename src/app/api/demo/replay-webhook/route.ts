import type { NextRequest } from 'next/server';
import { handle, replayWebhook, requireWorkspace } from '@/server/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** POST /api/demo/replay-webhook -> { duplicate: true, world }. Same externalId, recorded as webhook.duplicate_ignored. */
export const POST = handle(async (req: NextRequest) => {
  const ws = await requireWorkspace(req);
  return Response.json(await replayWebhook(ws));
});
