/** API service layer: workspace resolution from the httpOnly cookie, and every demo/agent operation. */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import type { BeatResponse, HealthResponse, RunView, WorldView } from '@/contract';
import { BEATS, TOTAL_BEATS } from '@/engine/beats';
import { dayToIso, externalEventId, HORIZON_DAYS, isoToDay, str, WAKE_HOUR, type LedgerEvent } from '@/engine/events';
import { clockDayOf, currentBeatOf, incompleteRun, project, type WorkspaceMeta } from '@/engine/project';
import { SCENARIO_ID } from '@/engine/scenario/ai-media-q4';
import { SimulatedCrash, wake } from '@/engine/wake';
import { makeCrash } from './crash';
import { dbConfigured, DbBlockedError, getWorkspaceRow, insertEarlyAccess, insertWorkspace, listLiveWorkspaces, NeonStore, pingDb } from './db';
import { providerConfig, serverProviders } from './providers';

export const COOKIE = 'lv_ws';
export const STAGE_ID = 'stage';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let storeSingleton: NeonStore | null = null;
export function store(): NeonStore {
  if (!storeSingleton) storeSingleton = new NeonStore();
  return storeSingleton;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Handler = (req: NextRequest) => Promise<Response>;

/** JSON errors {error, code} for every failure. */
export function handle(fn: Handler): Handler {
  return async (req) => {
    try {
      return await fn(req);
    } catch (err) {
      if (err instanceof ApiError) return Response.json({ error: err.message, code: err.code }, { status: err.status });
      if (err instanceof SimulatedCrash) {
        return Response.json({ error: 'The process was killed mid-run (simulated crash). POST /api/wake to resume from the last checkpoint.', code: 'CRASHED' }, { status: 500 });
      }
      if (err instanceof DbBlockedError) return Response.json({ error: 'Database not configured', code: 'DB_BLOCKED' }, { status: 503 });
      console.error('[longview] api error', (err as Error).name, (err as Error).message);
      return Response.json({ error: 'Internal error', code: 'INTERNAL' }, { status: 500 });
    }
  };
}

function cookieOptions() {
  return { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 30 };
}

/** The stage cookie is a digest of STAGE_KEY, so a hand-written cookie cannot open the stage workspace. */
function stageToken(): string | null {
  const key = process.env.STAGE_KEY;
  if (!key) return null;
  return `stage.${createHash('sha256').update(`longview-stage:${key}`).digest('hex').slice(0, 32)}`;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function ensureStage(): Promise<WorkspaceMeta> {
  const existing = await getWorkspaceRow(STAGE_ID);
  if (existing && existing.liveProviders) return existing;
  const ws: WorkspaceMeta = { id: STAGE_ID, mode: 'DEMO', label: 'Stage', scenario: SCENARIO_ID, liveProviders: true };
  await insertWorkspace(ws);
  if (!existing) await seedDemo(ws);
  return ws;
}

/** Resolve the caller's workspace from the httpOnly cookie. New visitors get a fresh seeded DEMO workspace. */
export async function resolveWorkspace(req: NextRequest, opts: { create?: boolean } = {}): Promise<WorkspaceMeta | null> {
  if (!dbConfigured()) throw new DbBlockedError();
  const jar = await cookies();
  const stageParam = req.nextUrl.searchParams.get('stage');
  const key = process.env.STAGE_KEY;
  if (stageParam && key) {
    if (!safeEqual(stageParam, key)) throw new ApiError(403, 'STAGE_FORBIDDEN', 'Invalid stage key');
    const ws = await ensureStage();
    jar.set(COOKIE, stageToken() as string, cookieOptions());
    return ws;
  }
  const raw = jar.get(COOKIE)?.value;
  if (raw) {
    const st = stageToken();
    if (st && safeEqual(raw, st)) return ensureStage();
    if (UUID_RE.test(raw)) {
      const ws = await getWorkspaceRow(raw);
      if (ws) return ws;
    }
  }
  if (opts.create === false) return null;
  const ws: WorkspaceMeta = { id: randomUUID(), mode: 'DEMO', label: 'Demo', scenario: SCENARIO_ID, liveProviders: false };
  await insertWorkspace(ws);
  await seedDemo(ws);
  jar.set(COOKIE, ws.id, cookieOptions());
  return ws;
}

export async function requireWorkspace(req: NextRequest): Promise<WorkspaceMeta> {
  return (await resolveWorkspace(req)) as WorkspaceMeta;
}

function requireDemo(ws: WorkspaceMeta) {
  if (ws.mode !== 'DEMO') throw new ApiError(409, 'NOT_DEMO', 'Demo controls only work in a DEMO workspace');
}

function liveDay(): number {
  return Math.max(0, Math.min(HORIZON_DAYS, isoToDay(new Date().toISOString())));
}

function worldOf(ws: WorkspaceMeta, events: LedgerEvent[], asOfDay?: number | null): WorldView {
  return project(events, { workspace: ws, providers: providerConfig(ws), asOfDay: asOfDay ?? null, ...(ws.mode === 'LIVE' ? { liveDay: liveDay() } : {}) });
}

function stageEvent(ws: WorkspaceMeta, beat: number, day: number): LedgerEvent {
  const at = dayToIso(day, WAKE_HOUR);
  return { id: `stage:beat:${beat}`, workspaceId: ws.id, type: 'stage.beat', occurredAt: at, learnedAt: at, source: 'presenter', mode: ws.mode, payload: { beat } };
}

async function runWake(ws: WorkspaceMeta, day: number, trigger: RunView['trigger'], beat?: number) {
  return wake({ store: store(), workspace: ws, providers: serverProviders(ws), day, trigger, ...(beat !== undefined ? { beat } : {}), crash: makeCrash(store()) });
}

/** Seed a DEMO workspace: beat 0, the Day 0 launch wake. */
export async function seedDemo(ws: WorkspaceMeta): Promise<LedgerEvent[]> {
  await store().append([stageEvent(ws, 0, 0)]);
  const res = await runWake(ws, 0, 'BEAT', 0);
  return res.events;
}

/** GET /api/state fast path: when the cookie names a workspace, read its row and its ledger in parallel. */
export async function getStateFor(req: NextRequest, asOf: number | null): Promise<WorldView> {
  if (!dbConfigured()) throw new DbBlockedError();
  const raw = (await cookies()).get(COOKIE)?.value;
  if (raw && UUID_RE.test(raw) && !req.nextUrl.searchParams.get('stage')) {
    const [row, events] = await Promise.all([getWorkspaceRow(raw), store().list(raw)]);
    if (row) return getState(row, asOf, events);
  }
  return getState(await requireWorkspace(req), asOf);
}

export async function getState(ws: WorkspaceMeta, asOf: number | null, prefetched?: LedgerEvent[]): Promise<WorldView> {
  let events = prefetched ?? (await store().list(ws.id));
  if (!events.length && ws.mode === 'DEMO') events = await seedDemo(ws);
  return worldOf(ws, events, asOf);
}

export async function nextBeat(ws: WorkspaceMeta): Promise<BeatResponse> {
  requireDemo(ws);
  const events = await store().list(ws.id);
  if (incompleteRun(events)) throw new ApiError(409, 'INTERRUPTED', 'The last run was interrupted. POST /api/wake to resume it first.');
  const next = currentBeatOf(events) + 1;
  if (next >= TOTAL_BEATS) return { world: worldOf(ws, events) };
  const def = BEATS[next];
  const day = Math.max(def.day, clockDayOf(events));
  await store().append([stageEvent(ws, next, day)]);
  if (!def.wakes) return { world: worldOf(ws, await store().list(ws.id)) };
  const res = await runWake(ws, day, 'BEAT', next);
  return { world: worldOf(ws, res.events), run: res.run };
}

export async function advance(ws: WorkspaceMeta, days: number): Promise<BeatResponse> {
  requireDemo(ws);
  const events = await store().list(ws.id);
  if (incompleteRun(events)) throw new ApiError(409, 'INTERRUPTED', 'The last run was interrupted. POST /api/wake to resume it first.');
  const target = Math.min(HORIZON_DAYS, clockDayOf(events) + days);
  const res = await runWake(ws, target, 'TICK');
  return { world: worldOf(ws, res.events), run: res.run };
}

export async function resetDemo(ws: WorkspaceMeta): Promise<{ world: WorldView }> {
  requireDemo(ws);
  await store().deleteWorkspace(ws.id, { keepRow: true });
  const events = await seedDemo(ws);
  return { world: worldOf(ws, events) };
}

export async function armChaos(ws: WorkspaceMeta, afterStep: number): Promise<{ armed: true }> {
  requireDemo(ws);
  const events = await store().list(ws.id);
  const day = clockDayOf(events);
  const at = dayToIso(day, WAKE_HOUR);
  await store().append([
    { id: `chaos:armed:${randomUUID()}`, workspaceId: ws.id, type: 'chaos.armed', occurredAt: at, learnedAt: at, source: 'presenter', mode: ws.mode, payload: { afterStep } },
  ]);
  return { armed: true };
}

export async function replayWebhook(ws: WorkspaceMeta): Promise<{ duplicate: true; world: WorldView }> {
  requireDemo(ws);
  const events = await store().list(ws.id);
  const preferred = events.find((e) => e.id === externalEventId('webhook', 'msg-B03-1'));
  const webhooks = events.filter((e) => e.source === 'webhook' && (e.type === 'lead.replied' || e.type === 'lead.captured'));
  const target = preferred ?? webhooks[webhooks.length - 1];
  if (!target) throw new ApiError(409, 'NO_WEBHOOK', 'No webhook has been received yet');
  const deliveryId = `replay:${randomUUID()}`;
  const res = await store().append([{ ...target, seq: undefined, wallAt: undefined, payload: { ...target.payload, deliveryId } }]);
  const duplicate = !res.inserted.includes(target.id);
  const day = clockDayOf(events);
  const at = dayToIso(day, WAKE_HOUR);
  if (duplicate) {
    await store().append([
      {
        id: `dup:${deliveryId}`,
        workspaceId: ws.id,
        type: 'webhook.duplicate_ignored',
        occurredAt: at,
        learnedAt: at,
        source: 'webhook',
        mode: ws.mode,
        payload: { eventId: target.id, externalId: str(target.payload.externalId) ?? target.id, deliveryId, leadId: str(target.payload.leadId) ?? null, replay: true },
      },
    ]);
  }
  return { duplicate: true, world: worldOf(ws, await store().list(ws.id)) };
}

export async function wakeNow(ws: WorkspaceMeta, trigger: RunView['trigger'] = 'MANUAL'): Promise<{ world: WorldView; run: RunView }> {
  const events = await store().list(ws.id);
  const open = incompleteRun(events);
  const day = ws.mode === 'LIVE' ? liveDay() : clockDayOf(events);
  const res = await runWake(ws, day, open ? 'RESUME' : trigger);
  return { world: worldOf(ws, res.events), run: res.run };
}

export const EventBody = z.object({
  source: z.string().regex(/^[a-z0-9_-]{1,40}$/i),
  externalId: z.string().min(1).max(200),
  type: z.enum(['lead.captured', 'lead.replied', 'outcome.recorded', 'spend.recorded']),
  leadId: z.string().min(1).max(80).optional(),
  occurredAt: z.iso.datetime({ offset: true }),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export async function ingestEvent(ws: WorkspaceMeta, raw: unknown): Promise<{ duplicate: boolean; world: WorldView }> {
  const parsed = EventBody.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, 'INVALID_EVENT', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const body = parsed.data;
  const events = await store().list(ws.id);
  const learnedAt = ws.mode === 'LIVE' ? new Date().toISOString() : dayToIso(clockDayOf(events), WAKE_HOUR - 1);
  const occurredAt = new Date(body.occurredAt).toISOString();
  if (Date.parse(occurredAt) > Date.parse(learnedAt)) throw new ApiError(400, 'FUTURE_EVENT', 'occurredAt is later than the world clock');
  const id = externalEventId(body.source, body.externalId);
  const deliveryId = `api:${randomUUID()}`;
  const evt: LedgerEvent = {
    id,
    workspaceId: ws.id,
    type: body.type,
    occurredAt,
    learnedAt,
    source: body.source,
    mode: ws.mode,
    payload: { ...body.payload, ...(body.leadId ? { leadId: body.leadId } : {}), externalId: body.externalId, deliveryId },
  };
  const res = await store().append([evt]);
  const duplicate = !res.inserted.includes(id);
  if (duplicate) {
    await store().append([
      { id: `dup:${deliveryId}`, workspaceId: ws.id, type: 'webhook.duplicate_ignored', occurredAt: learnedAt, learnedAt, source: body.source, mode: ws.mode, payload: { eventId: id, externalId: body.externalId, deliveryId, leadId: body.leadId ?? null } },
    ]);
  }
  return { duplicate, world: worldOf(ws, await store().list(ws.id)) };
}

export async function health(): Promise<HealthResponse> {
  const ready = await pingDb();
  return {
    ok: ready,
    db: ready ? 'ready' : 'blocked',
    providers: providerConfig(null),
    deployment: process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null,
  };
}

export const EarlyAccessBody = z.object({
  email: z.email().max(254),
  name: z.string().trim().max(120).optional(),
  company: z.string().trim().max(160).optional(),
});

export async function earlyAccess(req: NextRequest, raw: unknown): Promise<{ ok: true }> {
  const parsed = EarlyAccessBody.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, 'INVALID_EMAIL', 'A valid email is required');
  const ws = await resolveWorkspace(req, { create: false }).catch(() => null);
  await insertEarlyAccess({ email: parsed.data.email.toLowerCase(), name: parsed.data.name || null, company: parsed.data.company || null, workspaceId: ws?.id ?? null });
  return { ok: true };
}

export async function cronWake(): Promise<{ ok: true; woken: { id: string; runId: string; state: string }[] }> {
  const live = await listLiveWorkspaces();
  const woken: { id: string; runId: string; state: string }[] = [];
  for (const ws of live) {
    const res = await runWake(ws, liveDay(), 'CRON');
    woken.push({ id: ws.id, runId: res.run.id, state: res.run.state });
  }
  return { ok: true, woken };
}

export async function readJson(req: NextRequest): Promise<unknown> {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Body must be JSON');
  }
}

export function parseAsOf(req: NextRequest): number | null {
  const v = req.nextUrl.searchParams.get('asOf');
  if (v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > HORIZON_DAYS) throw new ApiError(400, 'INVALID_AS_OF', `asOf must be an integer day from 0 to ${HORIZON_DAYS}`);
  return n;
}
