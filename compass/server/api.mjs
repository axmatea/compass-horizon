// HTTP API for COMPASS. Mounted by server.mjs under /api/*.
//
// Contract (COMPASS_MASTER section 5, frozen once agreed):
//   POST /api/turn {sessionId?, text}
//     Accept: application/json  -> {sessionId, turnId, state, patch, reply, toolResult, superseded, events}
//                                  (+ sessionReset:true only when the sent sessionId was unknown; SSE: event session_reset)
//     Accept: text/event-stream -> SSE, one event per agent event, then `event: result` with the JSON above
//   POST /api/session              -> {sessionId, state}
//   GET  /api/session/:id          -> {state}
//   GET  /api/session/:id/events   -> SSE of all session events (all turns), for the live UI
//   Website domain, identical contract under /api/site/… (turn, session, session/:id, session/:id/events),
//   plus GET /api/site/session/:id/page -> the rendered page (HTML, strict CSP, session-lifetime only).
//   GET  /api/health               -> presence flags only, never secrets
//   GET  /api/voice/providers      -> voice provider capabilities
//   GET  /api/voice/client.js      -> browser voice client (Boson realtime, browser fallback)
//   GET  /api/voice/pcm-worklet.js -> AudioWorklet (mic capture, playback with instant flush)
//   GET  /api/voice/console        -> dev console to talk to COMPASS (not the product UI)
//   WS   /api/voice/realtime       -> realtime voice bridge (server/voice/ws-server.mjs)
import { readFileSync } from 'node:fs';

const VOICE_ASSETS = {
  '/api/voice/client.js': ['compass-voice.js', 'text/javascript; charset=utf-8'],
  '/api/voice/pcm-worklet.js': ['pcm-worklet.js', 'text/javascript; charset=utf-8'],
  '/api/voice/console': ['console.html', 'text/html; charset=utf-8'],
};
const assetCache = new Map();
function voiceAsset(path) {
  const spec = VOICE_ASSETS[path];
  if (!spec) return null;
  if (!assetCache.has(path)) assetCache.set(path, readFileSync(new URL(`./voice/browser/${spec[0]}`, import.meta.url)));
  return { body: assetCache.get(path), type: spec[1] };
}
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
// Generated pages: no scripts, no network, no frames. Inline styles only.
const PAGE_HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'", 'X-Frame-Options': 'SAMEORIGIN', 'X-Robots-Tag': 'noindex' };
const MAX_BODY = 16 * 1024;
const MAX_TEXT = 500;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function send(res, status, body) {
  res.writeHead(status, JSON_HEADERS).end(JSON.stringify(body));
}

async function readJson(req) {
  const type = req.headers['content-type'] || '';
  if (!/application\/json/i.test(type)) throw Object.assign(new Error('Content-Type must be application/json'), { status: 415 });
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Body too large'), { status: 413 });
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

function createRateLimiter({ perMinute, now = () => Date.now() }) {
  const buckets = new Map();
  return (key) => {
    const t = now();
    const b = buckets.get(key) || { tokens: perMinute, at: t };
    b.tokens = Math.min(perMinute, b.tokens + ((t - b.at) / 60_000) * perMinute);
    b.at = t;
    if (buckets.size > 10_000) buckets.clear();
    buckets.set(key, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  };
}

function openSse(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(': compass\n\n');
  return (type, data) => { if (!res.writableEnded) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); };
}

const publicState = (s) => s; // state holds no secrets; single place to filter later

export function createApiHandler({ runtime, siteRuntime = null, health, voice, turnsPerMinute = 30, logger = console }) {
  const allowTurn = createRateLimiter({ perMinute: turnsPerMinute });
  const domains = [['/api', runtime], ...(siteRuntime ? [['/api/site', siteRuntime]] : [])];

  /** Session + turn routes for one runtime under `prefix`. Returns true when handled. */
  async function domainRoutes(prefix, rt, req, res, path, method) {
    if (path === `${prefix}/session` && method === 'POST') {
      const s = rt.createSession();
      send(res, 201, { sessionId: s.id, state: publicState(s.state) });
      return true;
    }

    const m = new RegExp(`^${prefix.replace(/\//g, '\\/')}\\/session\\/([^/]+)(\\/events|\\/page)?$`).exec(path);
    if (m && method === 'GET') {
      const id = decodeURIComponent(m[1]);
      const s = ID_RE.test(id) && rt.getSession(id);
      if (!s) { send(res, 404, { error: 'session_not_found' }); return true; }
      if (m[2] === '/page') {
        const r = rt.render(id);
        if (!r) { send(res, 404, { error: 'no_page' }); return true; }
        res.writeHead(200, PAGE_HEADERS).end(r.html);
        return true;
      }
      if (!m[2]) { send(res, 200, { state: publicState(s.state) }); return true; }
      const write = openSse(res);
      write('state', { state: publicState(s.state) });
      const r = rt.render(id);
      if (r) write('render', { type: 'render', sessionId: id, version: s.state.version, at: new Date().toISOString(), stage: 'resume', html: r.html, pending: r.pending, highlight: [], placeholder: r.placeholder });
      const off = rt.subscribe(id, (ev) => write(ev.type, ev));
      const beat = setInterval(() => res.write(': ping\n\n'), 15_000);
      req.on('close', () => { clearInterval(beat); off(); });
      return true;
    }

    if (path === `${prefix}/turn` && method === 'POST') {
      if (!allowTurn(req.socket.remoteAddress || 'unknown')) { send(res, 429, { error: 'rate_limited' }); return true; }
      const body = await readJson(req);
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text) { send(res, 400, { error: 'text_required' }); return true; }
      if (text.length > MAX_TEXT) { send(res, 400, { error: 'text_too_long', max: MAX_TEXT }); return true; }
      // F1: a client that sends a sessionId we no longer know (expired, server restarted,
      // redeploy mid-demo) gets a fresh session AND an explicit sessionReset:true so the UI
      // can say the previous plan was lost instead of silently starting over.
      const requested = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : null;
      let sessionId = requested && ID_RE.test(requested) && rt.getSession(requested) ? requested : null;
      const sessionReset = Boolean(requested) && !sessionId;
      if (!sessionId) sessionId = rt.createSession().id;
      const resetInfo = sessionReset ? { sessionReset: true } : {};

      const wantsSse = /text\/event-stream/i.test(req.headers.accept || '');
      if (wantsSse) {
        const write = openSse(res);
        if (sessionReset) write('session_reset', { type: 'session_reset', sessionId, reason: 'unknown_session' });
        const result = await rt.runTurn(sessionId, text, { onEvent: (ev) => write(ev.type, ev) });
        const { events, ...rest } = result;
        write('result', { ...rest, ...resetInfo, state: publicState(rest.state) });
        res.end();
        return true;
      }
      const result = await rt.runTurn(sessionId, text);
      const status = result.error === 'not_configured' ? 503 : 200;
      const { events, ...rest } = result;
      // JSON callers of the website domain get the page too (large); everyone else keeps events.
      send(res, status, rt.domain?.render ? { ...rest, ...resetInfo, state: publicState(rest.state), page: rt.render(sessionId)?.html ?? null } : { ...result, ...resetInfo, state: publicState(result.state) });
      return true;
    }
    return false;
  }

  return async function handleApi(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '');
    const method = req.method;
    try {
      if (path === '/api/health' && method === 'GET') return send(res, 200, { ok: true, ...health() });

      if (method === 'GET' && VOICE_ASSETS[path]) {
        const a = voiceAsset(path);
        res.writeHead(200, { 'Content-Type': a.type, 'Cache-Control': 'no-cache' });
        return res.end(a.body);
      }

      if (path === '/api/voice/providers' && method === 'GET') return send(res, 200, { providers: voice.list(), active: voice.activeName, fallback: voice.fallback });

      // Longest prefix first so /api/site/... never falls into /api/session/...
      for (const [prefix, rt] of [...domains].sort((a, b) => b[0].length - a[0].length)) {
        if (path === prefix || path.startsWith(`${prefix}/`)) {
          if (await domainRoutes(prefix, rt, req, res, path, method)) return;
          if (prefix !== '/api') return send(res, 404, { error: 'not_found' });
        }
      }

      if (path.startsWith('/api/voice/')) return send(res, 501, { error: 'voice_endpoint_not_implemented', provider: voice.activeName });

      return send(res, 404, { error: 'not_found' });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) logger.error('[api]', req.method, path, err?.code || err?.name, String(err?.message || '').slice(0, 200));
      if (!res.headersSent) return send(res, status, { error: status >= 500 ? 'internal_error' : err.message });
      res.end();
    }
  };
}
