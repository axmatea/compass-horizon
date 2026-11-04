import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, sep, extname } from 'node:path';

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp4': 'video/mp4',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
const retired = /^\/(?:app|office|login|demo|voice-demo|presentation|present|story|protect|studio|horizon|vision|acquisition|live|film)(?:\/|\.|$)/;
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export function createCompassServer({ env = process.env } = {}) {
  const root = resolve(env.STATIC_ROOT || fileURLToPath(new URL('./dist/', import.meta.url)));
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    const text = (status, message) => {
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : message);
    };
    if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); text(405, 'Method not allowed'); return; }
    try {
      const url = new URL(req.url, 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);
      if (env.NODE_ENV === 'production' && req.headers.host === 'www.mycompass.world') {
        res.writeHead(308, { Location: `https://mycompass.world${url.pathname}${url.search}` }).end(); return;
      }
      if (pathname === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ ok: true, mode: 'homepage-only',
          revision: env.RAILWAY_GIT_COMMIT_SHA || env.COMPASS_REVISION || 'local' })); return;
      }
      if (pathname === '/api' || pathname.startsWith('/api/')) { text(404, 'No application API is available.'); return; }
      const normalized = pathname.replace(/\/$/, '') || '/';
      if (retired.test(normalized)) { text(410, 'This section has been retired. Visit the COMPASS homepage at /.'); return; }
      const page = normalized === '/' || normalized === '/index.html';
      if (!page && (pathname.endsWith('.html') || pathname.split('/').some(part => part.startsWith('.')) || !types[extname(pathname)])) {
        text(404, 'Not found'); return;
      }
      const file = resolve(root, '.' + (page ? '/index.html' : pathname));
      if (!file.startsWith(root + sep)) { text(403, 'Forbidden'); return; }
      const info = await stat(file);
      if (!info.isFile()) { text(404, 'Not found'); return; }
      const headers = { 'Content-Type': types[extname(file)], 'Cache-Control': 'public, max-age=0, must-revalidate',
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
    } catch { if (!res.headersSent) text(404, 'Not found'); else res.destroy(); }
  });
  return { server, async close() {
    const stopped = server.listening ? new Promise(resolve => server.close(resolve)) : Promise.resolve();
    server.closeIdleConnections(); await stopped;
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = createCompassServer();
  app.server.listen(Number(process.env.PORT || 8770), '0.0.0.0', () => console.log('COMPASS homepage ready'));
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; await app.close(); process.exit(0); };
  process.on('SIGTERM', () => void stop()); process.on('SIGINT', () => void stop());
}
