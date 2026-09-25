import type { NextRequest } from 'next/server';
import { earlyAccess, handle, readJson } from '@/server/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** POST /api/early-access {email, name?, company?} -> { ok: true } only after a durable write */
export const POST = handle(async (req: NextRequest) => Response.json(await earlyAccess(req, await readJson(req))));
