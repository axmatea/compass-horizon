import type { NextRequest } from 'next/server';
import { handle, ingestEvent, readJson, requireWorkspace } from '@/server/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** POST /api/events {source, externalId, type, leadId?, occurredAt, payload} -> { duplicate, world } */
export const POST = handle(async (req: NextRequest) => {
  const body = await readJson(req);
  const ws = await requireWorkspace(req);
  return Response.json(await ingestEvent(ws, body));
});
