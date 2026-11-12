import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, sep, extname } from 'node:path';
import { clarifyDemo, planDemo, demoVideoUrl, llmStatus, fallbackRun, MAX_INTENT } from './demo-api.mjs';
import { submitEarlyAccess } from './early-access.mjs';
import { applyHomepage } from './homepage.mjs';
import { createSiteBuilder, publicTurn, sessionIdFrom, MAX_TEXT } from './builder/index.mjs';

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp4': 'video/mp4',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
const retired = /^\/(?:app|office|login|demo|voice-demo|presentation|present|story|protect|studio|horizon|vision|acquisition|live|film)(?:\/|\.|$)/;
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; media-src 'self' https:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action mailto:; frame-ancestors 'none'; frame-src 'self' https:";

function clientAddress(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim().slice(0, 80);
  return req.socket?.remoteAddress || 'local';
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32768) return { error: 'too_large' };
    chunks.push(chunk);
  }
  try { return { value: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }; }
  catch { return { error: 'bad_json' }; }
}

export function createCompassServer({ env = process.env, fetchImpl = fetch } = {}) {
  // A stored provider key is not consent to enable generation. The public
  // application stays on prepared examples until live mode is explicit.
  env = { ...env, COMPASS_DEMO_MODE: env.COMPASS_DEMO_MODE === 'live' ? 'live' : 'examples' };
  const root = resolve(env.STATIC_ROOT || fileURLToPath(new URL('./dist/', import.meta.url)));
  const buckets = new Map();
  const windowMs = Math.min(Math.max(Number(env.DEMO_RATE_WINDOW_MS) || 600000, 1000), 3600000);
  const limit = Math.min(Math.max(Number(env.DEMO_RATE_LIMIT) || 30, 1), 200);
  const hit = ip => {
    const now = Date.now();
    const fresh = (buckets.get(ip) || []).filter(stamp => now - stamp < windowMs);
    if (fresh.length >= limit) {
      buckets.set(ip, fresh);
      return { limited: true, retryAfter: Math.max(1, Math.ceil((fresh[0] + windowMs - now) / 1000)) };
    }
    fresh.push(now);
    buckets.set(ip, fresh);
    if (buckets.size > 5000) buckets.clear();
    return { limited: false };
  };
  const site = createSiteBuilder({ env, fetchImpl });
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
    const text = (status, message) => {
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : message);
    };
    const json = (status, body, extra = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(body));
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);
      if (env.NODE_ENV === 'production' && req.headers.host === 'www.mycompass.world') {
        res.writeHead(308, { Location: `https://mycompass.world${url.pathname}${url.search}` }).end(); return;
      }
      if (pathname === '/healthz') {
        json(200, { ok: true, mode: 'public-demo', demoMode: env.COMPASS_DEMO_MODE, llmConfigured: llmStatus(env),
          revision: env.RAILWAY_GIT_COMMIT_SHA || env.COMPASS_REVISION || 'local' }); return;
      }
      if (pathname === '/api/config' && req.method === 'GET') { json(200, { demoVideoUrl: demoVideoUrl(env) }); return; }
      if (pathname === '/api/early-access') {
        if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); text(405, 'Method not allowed'); return; }
        const gate = hit(clientAddress(req));
        if (gate.limited) { json(429, { ok: false, stored: false, error: 'rate_limited' }, { 'Retry-After': String(gate.retryAfter) }); return; }
        const body = await readJson(req);
        if (body.error) { json(400, { ok: false, stored: false, error: body.error }); return; }
        const result = await submitEarlyAccess(body.value, { env, fetchImpl });
        json(result.status, result.body); return;
      }
      if (pathname === '/api/site/turn' && req.method === 'POST') {
        const gate = hit(clientAddress(req));
        const body = await readJson(req);
        if (body.error) { json(400, { error: body.error, limit: MAX_TEXT }); return; }
        const text = typeof body.value?.text === 'string' ? body.value.text.trim() : '';
        if (!text) { json(400, { error: 'text_required', limit: MAX_TEXT }); return; }
        if (text.length > MAX_TEXT) { json(400, { error: 'text_too_long', limit: MAX_TEXT }); return; }
        const requested = sessionIdFrom(body.value?.sessionId, site.runtime);
        if (gate.limited) {
          const fallback = publicTurn(await site.runtime.runTurn(requested.sessionId, text, { localOnly: true }), { limited: true, sessionReset: requested.reset });
          json(429, { error: 'rate_limited', fallback }, { 'Retry-After': String(gate.retryAfter) });
          return;
        }
        const wantsSse = /text\/event-stream/i.test(req.headers.accept || '');
        if (wantsSse) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
          res.write(': compass\n\n');
          const write = (type, data) => { if (!res.writableEnded) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); };
          if (requested.reset) write('session_reset', { type: 'session_reset', reason: 'unknown_session' });
          const result = await site.runtime.runTurn(requested.sessionId, text, { onEvent: (event) => write(event.type, event) });
          write('result', publicTurn(result, { sessionReset: requested.reset }));
          res.end();
          return;
        }
        const result = publicTurn(await site.runtime.runTurn(requested.sessionId, text), { sessionReset: requested.reset });
        json(200, result);
        return;
      }
      const pageMatch = pathname.match(/^\/api\/site\/session\/([A-Za-z0-9_-]{1,64})\/page$/);
      if (pageMatch && req.method === 'GET') {
        const view = site.runtime.render(pageMatch[1]);
        if (!view?.html) { text(404, 'Not found'); return; }
        res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'self'");
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader('X-Robots-Tag', 'noindex');
        const body = Buffer.from(view.html);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': body.length });
        res.end(req.method === 'HEAD' ? undefined : body);
        return;
      }
      if (pathname === '/api/demo/clarify' || pathname === '/api/demo/plan') {
        if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); text(405, 'Method not allowed'); return; }
        const gate = hit(clientAddress(req));
        if (gate.limited) { json(429, { error: 'rate_limited', fallback: fallbackRun() }, { 'Retry-After': String(gate.retryAfter) }); return; }
        const body = await readJson(req);
        if (body.error) { json(400, { error: body.error, limit: MAX_INTENT }); return; }
        const input = body.value || {};
        const result = pathname.endsWith('/clarify')
          ? await clarifyDemo({ intent: input.intent, exampleId: input.exampleId, env, fetchImpl })
          : await planDemo({ intent: input.intent, exampleId: input.exampleId, answers: input.answers, env, fetchImpl });
        json(result.ok ? 200 : 400, result); return;
      }
      if (pathname === '/api' || pathname.startsWith('/api/')) { text(404, 'No application API is available.'); return; }
      if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); text(405, 'Method not allowed'); return; }
      const normalized = pathname.replace(/\/$/, '') || '/';
      if (normalized === '/demo' || normalized === '/voice-demo') { await serveFile(req, res, root, '/demo.html', text); return; }
      if (normalized === '/plan') { await serveFile(req, res, root, '/plan.html', text); return; }
      if (retired.test(normalized)) { text(410, 'This section has been retired. Visit the COMPASS homepage at /.'); return; }
      const page = normalized === '/' || normalized === '/index.html';
      if (page) { await serveHtml(req, res, root, '/index.html', env, text); return; }
      if (pathname.endsWith('.html') || pathname.split('/').some(part => part.startsWith('.')) || !types[extname(pathname)]) {
        text(404, 'Not found'); return;
      }
      await serveFile(req, res, root, pathname, text);
    } catch { if (!res.headersSent) text(404, 'Not found'); else res.destroy(); }
  });
  return { server, async close() {
    const stopped = server.listening ? new Promise(resolve => server.close(resolve)) : Promise.resolve();
    server.closeIdleConnections(); await stopped;
  } };
}

async function serveHtml(req, res, root, pathname, env, text) {
  const file = resolve(root, '.' + pathname);
  if (!file.startsWith(root + sep) && file !== root) { text(403, 'Forbidden'); return; }
  let html;
  try { html = await readFile(file, 'utf8'); }
  catch { text(404, 'Not found'); return; }
  if (pathname === '/index.html') html = applyHomepage(html, env);
  const body = Buffer.from(html);
  res.writeHead(200, { 'Content-Type': types['.html'], 'Cache-Control': 'public, max-age=0, must-revalidate', 'Content-Length': body.length });
  res.end(req.method === 'HEAD' ? undefined : body);
}

async function serveFile(req, res, root, pathname, text) {
  const file = resolve(root, '.' + pathname);
  if (!file.startsWith(root + sep) && file !== root) { text(403, 'Forbidden'); return; }
  const info = await stat(file);
  if (!info.isFile()) { text(404, 'Not found'); return; }
  const headers = { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=0, must-revalidate',
    'Accept-Ranges': 'bytes' };
  let start = 0, end = info.size - 1, status = 200;
  if (req.headers.range && req.method === 'GET') {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!match || (!match[1] && !match[2])) { res.setHeader('Content-Range', `bytes */${info.size}`); text(416, 'Invalid range'); return; }
    if (!match[1]) start = Math.max(0, info.size - Number(match[2]));
    else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) {
      res.setHeader('Content-Range', `bytes */${info.size}`); text(416, 'Invalid range'); return;
    }
    status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
  }
  headers['Content-Length'] = info.size === 0 ? 0 : end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD' || info.size === 0) { res.end(); return; }
  const stream = createReadStream(file, { start, end });
  stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = createCompassServer();
  app.server.listen(Number(process.env.PORT || 8770), '0.0.0.0', () => console.log('COMPASS ready'));
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; await app.close(); process.exit(0); };
  process.on('SIGTERM', () => void stop()); process.on('SIGINT', () => void stop());
}
