// Contract-v1 adapter only. Vincent owns execution, persistence, idempotency,
// and tenant ownership enforcement; configuration does not verify those duties.
const PREFIX = '/api/remaster';
const BODY_LIMIT = 16 * 1024;
const RESPONSE_LIMIT = 512 * 1024;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const presets = ['sarah-leave', 'deadline-shift', 'dependency-delay'];
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const string = (v) => typeof v === 'string' && v.length > 0 && v.length <= 8192;
const id = (v) => typeof v === 'string' && ID.test(v);
const integer = (v) => Number.isSafeInteger(v) && v >= 0;
const day = (v) => integer(v) && v <= 60;
const calendarDay = (v) => integer(v) && v <= 365;
const bool = (v) => typeof v === 'boolean';
const one = (...values) => (v) => values.includes(v);
const optional = (check) => (v) => v === undefined || check(v);
const nullable = (check) => (v) => v === null || check(v);
const list = (check, max = 2000) => (v) => Array.isArray(v) && v.length <= max && v.every(check);
const shape = (fields) => (v) => record(v) && Object.keys(v).every((key) => Object.hasOwn(fields, key)) && Object.entries(fields).every(([key, check]) => check(v[key]));
const timestamp = (v) => typeof v === 'string' && v.length <= 40 && /^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
const ids = list(id);
const person = shape({ id, name: string, role: string, initials: string, color: string, skills: list(string, 100) });
const task = shape({ id, title: string, ownerId: id, sprint: (v) => integer(v) && v >= 1 && v <= 6, startDay: calendarDay, dueDay: calendarDay, completedDay: nullable(day), status: one('planned', 'active', 'blocked', 'done'), dependsOn: ids });
const fact = shape({ id, text: string, personId: nullable(id), learnedDay: day, effectiveFrom: calendarDay, effectiveTo: calendarDay, state: one('active', 'folded', 'archived'), source: string, sourceEventId: id });
const memory = shape({ id, day, op: one('keep', 'fold', 'archive', 'promote', 'restore'), factIds: ids, why: string });
const decision = shape({ id, day, summary: string, before: optional(string), after: optional(string), evidenceIds: ids, state: one('proposed', 'applied', 'prevented') });
const check = shape({ id, day, doer: string, shadow: string, verdict: one('same', 'divergence', 'inconclusive', 'restored'), factIds: ids, summary: string });
const receipt = shape({ provider: string, operation: string, status: one('completed', 'blocked', 'failed'), at: timestamp, model: optional(string) });
const log = shape({ id, day, kind: string, title: string, detail: string, evidenceIds: ids });
const snapshotShape = shape({
  schemaVersion: one(1), runId: id, seq: integer, executionMode: one('live'), teamSource: one('simulated'),
  day, deadlineDay: (v) => calendarDay(v) && v > 0, status: one('idle', 'running', 'paused', 'completed', 'blocked'),
  phase: one('planning', 'working', 'night', 'checking', 'restoring', 'finished'), stressTest: one(false), seed: integer,
  team: list(person, 6), tasks: list(task, 1000), facts: list(fact), memoryOps: list(memory), decisions: list(decision),
  checks: list(check), feed: list(log), receipts: list(receipt, 1000), injections: list(one(...presets), 100),
  metrics: shape({ completedTasks: integer, totalTasks: integer, conflictsDetected: integer, restores: integer, protectedFacts: integer, contextTokens: nullable(integer) }),
  outcome: nullable(shape({ success: bool, title: string, reason: string })),
});

export function validLiveSnapshot(value, runId) {
  if (!snapshotShape(value) || (runId && value.runId !== runId) || value.team.length !== 6) return false;
  for (const rows of [value.team, value.tasks, value.facts, value.memoryOps, value.decisions, value.checks, value.feed]) {
    if (new Set(rows.map((row) => row.id)).size !== rows.length) return false;
  }
  const people = new Set(value.team.map((row) => row.id));
  const tasks = new Set(value.tasks.map((row) => row.id));
  const facts = new Set(value.facts.map((row) => row.id));
  if (value.tasks.some((row) => !people.has(row.ownerId) || row.startDay > row.dueDay || row.dependsOn.some((dependency) => dependency === row.id || !tasks.has(dependency)))) return false;
  if (value.facts.some((row) => (row.personId !== null && !people.has(row.personId)) || row.effectiveFrom > row.effectiveTo)) return false;
  if ([...value.memoryOps, ...value.checks].some((row) => row.factIds.some((factId) => !facts.has(factId)))) return false;
  return value.metrics.totalTasks === value.tasks.length && value.metrics.completedTasks === value.tasks.filter((row) => row.status === 'done').length;
}

export function validRuntimeEvent(value, runId) {
  return shape({ id, runId: id, seq: integer, simulatedDay: day, receivedAt: timestamp, snapshot: (v) => validLiveSnapshot(v, runId) })(value)
    && value.runId === runId && value.snapshot.runId === runId && value.seq === value.snapshot.seq && value.simulatedDay === value.snapshot.day;
}

class BridgeError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function failure(status, code, message) { return new BridgeError(status, code, message); }
const unavailable = () => failure(503, 'RUNTIME_UNAVAILABLE', 'Live runtime is unavailable. No fallback was used.');
const invalidResponse = () => failure(502, 'RUNTIME_INVALID_RESPONSE', 'Live runtime returned an incompatible response.');
const badRequest = () => failure(400, 'INVALID_REQUEST', 'Invalid remaster request.');

function originValue(value, production) {
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw badRequest();
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && !production && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw badRequest();
  return url.origin;
}

function configuration(env, getIdentity) {
  if (env.REMASTER_LIVE_ENABLED !== 'true') return { status: 'BLOCKED', reason: 'Live runtime is disabled.' };
  if (!env.REMASTER_RUNTIME_URL || !env.REMASTER_RUNTIME_TOKEN || typeof getIdentity !== 'function') return { status: 'BLOCKED', reason: 'Live runtime or session verification is not configured.' };
  try {
    const production = env.NODE_ENV === 'production';
    const runtimeOrigin = originValue(env.REMASTER_RUNTIME_URL, production);
    const appOrigin = originValue(env.BETTER_AUTH_URL, production);
    if (!/^[A-Za-z0-9._~+\/-]+=*$/.test(env.REMASTER_RUNTIME_TOKEN) || env.REMASTER_RUNTIME_TOKEN.length > 8192) throw badRequest();
    if (runtimeOrigin === appOrigin) throw badRequest();
    return { status: 'CONFIGURED', reason: 'Contract-v1 bridge configured; runtime compatibility, availability, and tenant ownership enforcement are not verified.', runtimeOrigin, appOrigin, token: env.REMASTER_RUNTIME_TOKEN };
  } catch { return { status: 'BLOCKED', reason: 'Live runtime configuration is invalid.' }; }
}

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(payload));
}

async function requestBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw failure(415, 'JSON_REQUIRED', 'A JSON request is required.');
  if (Number(req.headers['content-length']) > BODY_LIMIT) { req.resume(); throw failure(413, 'BODY_TOO_LARGE', 'Request body is too large.'); }
  let size = 0;
  const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += Buffer.byteLength(chunk);
    if (size > BODY_LIMIT) { req.resume(); throw failure(413, 'BODY_TOO_LARGE', 'Request body is too large.'); }
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw badRequest(); }
}

async function readResponse(response) {
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '') || Number(response.headers.get('content-length')) > RESPONSE_LIMIT || !response.body) throw invalidResponse();
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > RESPONSE_LIMIT) throw invalidResponse();
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { throw invalidResponse(); } finally { await reader.cancel().catch(() => {}); }
}

function routeFor(path, search) {
  if (path === `${PREFIX}/runs`) return { method: 'POST', kind: 'start', path };
  const match = path.match(/^\/api\/remaster\/runs\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})(?:\/(commands|events))?$/);
  if (!match) return null;
  const kind = match[2] === 'commands' ? 'command' : match[2] === 'events' ? 'events' : 'snapshot';
  if (kind === 'events') {
    if ([...search.keys()].some((key) => key !== 'after') || search.getAll('after').length > 1) throw badRequest();
    const after = search.get('after') ?? '0';
    if (!/^(0|[1-9]\d*)$/.test(after) || !integer(Number(after))) throw badRequest();
    return { method: 'GET', kind, runId: match[1], path: `${path}?after=${after}` };
  }
  return { method: kind === 'command' ? 'POST' : 'GET', kind, runId: match[1], path };
}

function safePayload(value, config) {
  const text = JSON.stringify(value);
  return !text.includes(config.token) && !text.includes(config.runtimeOrigin);
}

/** Fixed upstream /api/remaster paths; never a general proxy or agent backend.
 * limits may only tighten built-in bounds (useful for deterministic tests).
 */
export function createRemasterBridge({ env = process.env, getIdentity, fetchImpl = globalThis.fetch, limits = {} } = {}) {
  const config = configuration(env, getIdentity);
  const bounded = (value, fallback, minimum) => Number.isFinite(value) ? Math.max(minimum, Math.min(fallback, value)) : fallback;
  const requestMs = bounded(limits.requestMs, 30_000, 25);
  const streamMs = bounded(limits.streamMs, 300_000, 50);
  const revalidateMs = bounded(limits.revalidateMs, 15_000, 25);
  const maxStreams = bounded(limits.maxStreams, 50, 1);
  const maxUserStreams = bounded(limits.maxUserStreams, 2, 1);
  const pending = new Set();
  const streams = new Map();
  let closed = false;
  const status = () => closed ? { status: 'BLOCKED', reason: 'Live runtime bridge is closed.' } : { status: config.status, reason: config.reason };

  async function identity(req) {
    let timer;
    try {
      const value = await Promise.race([
        Promise.resolve().then(() => getIdentity(req)),
        new Promise((_, reject) => { timer = setTimeout(() => reject(unavailable()), requestMs); }),
      ]);
      if (value === null || value === undefined) throw failure(401, 'SESSION_REQUIRED', 'An invited application session is required.');
      if (!id(value.tenantId) || !id(value.userId)) throw unavailable();
      return { tenantId: value.tenantId, userId: value.userId };
    } catch (error) {
      if (error instanceof BridgeError && error.code === 'SESSION_REQUIRED') throw error;
      throw failure(503, 'SESSION_UNAVAILABLE', 'Session verification is unavailable.');
    } finally { clearTimeout(timer); }
  }

  async function stream(response, req, res, route, owner, controller) {
    if (!/^text\/event-stream(?:\s*;|$)/i.test(response.headers.get('content-type') || '') || !response.body) throw invalidResponse();
    const reader = response.body.getReader();
    let ended = false;
    let verifying = false;
    const end = (code) => {
      if (ended) return;
      ended = true;
      if (!res.destroyed && !res.writableEnded) {
        if (code) res.write(`event: bridge-error\ndata: ${JSON.stringify({ code, error: 'Live stream closed. Resynchronize before continuing.' })}\n\n`);
        res.end();
      }
      controller.abort();
      void reader.cancel().catch(() => {});
    };
    const abort = () => end();
    controller.signal.addEventListener('abort', abort, { once: true });
    const lifespan = setTimeout(() => end(), streamMs);
    const revalidate = setInterval(async () => {
      if (verifying || ended) return;
      verifying = true;
      try {
        const current = await identity(req);
        if (current.tenantId !== owner.tenantId || current.userId !== owner.userId) end('SESSION_REQUIRED');
      } catch { end('SESSION_REQUIRED'); } finally { verifying = false; }
    }, revalidateMs);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' });
    res.flushHeaders?.();
    let buffer = '';
    let seq = Number(new URL(route.path, config.runtimeOrigin).searchParams.get('after'));
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const write = async (value) => {
      if (ended || res.destroyed) return;
      if (res.write(value)) return;
      await new Promise((resolve) => {
        const done = () => { res.off('drain', done); controller.signal.removeEventListener('abort', done); resolve(); };
        res.once('drain', done);
        controller.signal.addEventListener('abort', done, { once: true });
        if (controller.signal.aborted) done();
      });
    };
    try {
      while (!ended) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        if (Buffer.byteLength(buffer) > RESPONSE_LIMIT) throw invalidResponse();
        // Normalize only complete CRLF pairs, including pairs split across reads.
        buffer = buffer.replace(/\r\n/g, '\n');
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0 && !ended) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          let eventName = 'message';
          let eventId;
          const data = [];
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim();
            else if (line.startsWith('id:')) eventId = line.slice(3).trim();
            else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
            else if (line && !line.startsWith(':')) throw invalidResponse();
          }
          if (!data.length) { await write(': heartbeat\n\n'); continue; }
          if (eventName !== 'state') throw invalidResponse();
          const value = JSON.parse(data.join('\n'));
          if (!validRuntimeEvent(value, route.runId) || eventId !== String(value.seq) || !safePayload(value, config)) throw invalidResponse();
          if (value.seq <= seq) continue;
          seq = value.seq;
          await write(`id: ${seq}\nevent: state\ndata: ${JSON.stringify(value)}\n\n`);
        }
      }
    } catch {
      if (!controller.signal.aborted) end('RUNTIME_INVALID_RESPONSE');
    } finally {
      clearTimeout(lifespan);
      clearInterval(revalidate);
      controller.signal.removeEventListener('abort', abort);
      end();
      await reader.cancel().catch(() => {});
    }
  }

  async function handle(req, res) {
    const raw = req.url || '/';
    let url;
    try { url = new URL(raw, 'http://bridge.invalid'); } catch { return false; }
    const path = url.pathname;
    if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return false;
    let controller;
    let timer;
    let disconnect;
    let streamKey;
    let sentMutation = false;
    try {
      if (raw.split('?')[0] !== path || raw.includes('#')) throw badRequest();
      if (path === `${PREFIX}/status`) {
        if (req.method !== 'GET') throw failure(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
        json(res, 200, status());
        return true;
      }
      const route = routeFor(path, url.searchParams);
      if (!route) throw failure(404, 'NOT_FOUND', 'Remaster endpoint not found.');
      if (req.method !== route.method) throw failure(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
      if (route.kind !== 'events' && url.search) throw badRequest();
      if (closed || config.status !== 'CONFIGURED') throw failure(503, 'LIVE_BLOCKED', 'Live runtime is blocked. No fallback was used.');
      const origin = req.headers.origin;
      const site = req.headers['sec-fetch-site'];
      if ((origin !== undefined && origin !== config.appOrigin) || (req.method === 'POST' && origin !== config.appOrigin) || (site && !['same-origin', 'none'].includes(site))) throw failure(403, 'INVALID_ORIGIN', 'A same-origin request is required.');
      if (['x-compass-tenant-id', 'x-compass-user-id', 'x-tenant-id', 'x-user-id'].some((key) => req.headers[key] !== undefined)) throw badRequest();
      const owner = await identity(req);
      let body;
      if (route.method === 'POST') {
        body = await requestBody(req);
        const valid = route.kind === 'start'
          ? shape({ seed: integer, stressTest: one(false) })(body)
          : shape({ commandId: id, type: one('pause', 'resume') })(body) || shape({ commandId: id, type: one('inject_event'), payload: shape({ preset: one(...presets) }) })(body);
        if (!valid) throw badRequest();
      }
      if (res.destroyed || req.aborted) return true;
      if (closed) throw unavailable();
      if (route.kind === 'events') {
        const key = `${owner.tenantId}:${owner.userId}`;
        const count = [...streams.values()].filter((value) => value === key).length;
        if (streams.size >= maxStreams || count >= maxUserStreams) throw failure(429, 'STREAM_LIMIT', 'Live stream connection limit reached.');
        streamKey = {};
        streams.set(streamKey, key);
      }
      controller = new AbortController();
      pending.add(controller);
      disconnect = () => controller.abort();
      req.once('aborted', disconnect);
      res.once('close', disconnect);
      timer = setTimeout(() => controller.abort(), requestMs);
      sentMutation = route.method === 'POST';
      const response = await fetchImpl(`${config.runtimeOrigin}${route.path}`, {
        method: route.method, redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: {
          authorization: `Bearer ${config.token}`, accept: route.kind === 'events' ? 'text/event-stream' : 'application/json',
          'x-compass-tenant-id': owner.tenantId, 'x-compass-user-id': owner.userId,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (controller.signal.aborted) { await response.body?.cancel().catch(() => {}); throw unavailable(); }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        if (!sentMutation && response.status === 404) throw failure(404, 'RUN_NOT_FOUND', 'Live run is not available.');
        throw unavailable();
      }
      if (route.kind === 'events') {
        clearTimeout(timer);
        await stream(response, req, res, route, owner, controller);
      } else {
        const payload = await readResponse(response);
        if (!shape({ snapshot: (v) => validLiveSnapshot(v, route.runId) })(payload) || !safePayload(payload, config)) throw invalidResponse();
        if (controller.signal.aborted) throw unavailable();
        if (!res.destroyed) json(res, 200, payload);
      }
    } catch (error) {
      if (!res.destroyed && !res.headersSent) {
        const safe = sentMutation ? failure(503, 'COMMAND_UNCERTAIN', 'The operation may have been applied. Refetch state before deciding what to do; no retry was sent.')
          : error instanceof BridgeError ? error : unavailable();
        json(res, safe.status, { error: safe.message, code: safe.code });
      } else if (!res.destroyed) res.end();
    } finally {
      clearTimeout(timer);
      if (disconnect) { req.off('aborted', disconnect); res.off('close', disconnect); }
      if (controller) { controller.abort(); pending.delete(controller); }
      if (streamKey) streams.delete(streamKey);
    }
    return true;
  }

  return { handle, status, close() { closed = true; for (const controller of pending) controller.abort(); } };
}
