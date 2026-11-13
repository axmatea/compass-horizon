import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createCompassServer } from '../server.mjs';

test('public delivery keeps guest creation available and account access closed by default, despite stale files', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'compass-home-'));
  for (const name of ['index', 'app', 'login', 'demo', 'plan', 'studio', 'create']) await writeFile(join(root, name + '.html'), '<h1>' + name + '</h1>');
  await writeFile(join(root, 'asset.js'), 'abcdefghij');
  await writeFile(join(root, 'sitemap.xml'), '<urlset/>');
  await writeFile(join(root, '.env'), 'not-public');
  const app = createCompassServer({ env: { STATIC_ROOT: root, COMPASS_REVISION: 'test-homepage', DATABASE_URL: 'postgresql://disabled.invalid/db' } });
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const origin = 'http://127.0.0.1:' + app.server.address().port;
  const home = await fetch(origin + '/');
  assert.equal(home.status, 200); assert.equal(await home.text(), '<h1>index</h1>');
  assert.match(home.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.equal(home.headers.get('permissions-policy'), 'camera=(), microphone=(self), geolocation=()');
  assert.equal(home.headers.get('x-frame-options'), 'DENY');
  assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(origin + '/demo')).status, 200);
  assert.equal(await (await fetch(origin + '/demo')).text(), '<h1>demo</h1>');
  assert.equal((await fetch(origin + '/voice-demo')).status, 200);
  assert.equal(await (await fetch(origin + '/voice-demo')).text(), '<h1>demo</h1>');
  for (const path of ['/studio', '/studio/', '/studio?source=local']) {
    const studio = await fetch(origin + path);
    assert.equal(studio.status, 200);
    assert.equal(await studio.text(), '<h1>studio</h1>');
  }
  assert.equal((await fetch(origin + '/studio', { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(origin + '/studio', { method: 'POST' })).status, 405);
  for (const path of ['/create', '/create/', '/create?from=home']) {
    const create = await fetch(origin + path);
    assert.equal(create.status, 200);
    assert.equal(await create.text(), '<h1>create</h1>');
  }
  assert.equal((await fetch(origin + '/create', { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(origin + '/create', { method: 'POST' })).status, 405);
  const config = await fetch(origin + '/api/account/config');
  assert.equal(config.status, 200);
  assert.equal(config.headers.get('cache-control'), 'no-store');
  const accountConfig = await config.json();
  assert.equal(accountConfig.enabled, false);
  assert.equal(accountConfig.configured, false);
  assert.deepEqual(accountConfig.providers, []);
  const session = await fetch(origin + '/api/auth/get-session');
  assert.equal(session.status, 503);
  assert.equal(session.headers.get('cache-control'), 'no-store');
  assert.equal((await session.json()).code, 'AUTH_UNAVAILABLE');
  assert.equal(session.headers.get('set-cookie'), null);
  for (const path of ['/api/account/me', '/api/account/projects', '/api/account/profile', '/api/account/usage']) {
    const privateResponse = await fetch(origin + path);
    assert.equal(privateResponse.status, 503, path);
    assert.equal(privateResponse.headers.get('cache-control'), 'no-store', path);
    assert.deepEqual(await privateResponse.json(), {error:'accounts_unavailable'}, path);
  }
  assert.equal((await fetch(origin + '/workspace')).status, 404);
  for (const path of ['/app', '/app.html', '/office', '/office?workspaceInvite=old', '/login', '/login.html', '/demo/workspace', '/demo/remaster/app', '/presentation', '/presentation/finale', '/protect', '/horizon', '/studio/legacy', '/studio/legacy.html', '/studio.html', '/vision', '/acquisition', '/film.html']) {
    assert.equal((await fetch(origin + path)).status, 410, path);
  }
  for (const path of ['/api', '/api/workspaces', '/api/acquisition/state', '/api/remaster/state', '/api/waitlist', '/.env', '/unknown.html', '/unknown']) assert.equal((await fetch(origin + path)).status, 404, path);
  assert.equal((await fetch(origin + '/login', { method: 'POST' })).status, 405);
  const health = await fetch(origin + '/healthz');
  assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await health.json(), { ok: true, mode: 'public-demo', demoMode: 'examples', llmConfigured: false, revision: 'test-homepage' });
  const range = await fetch(origin + '/asset.js', { headers: { range: 'bytes=2-4' } });
  assert.equal(range.status, 206); assert.equal(await range.text(), 'cde');
  assert.equal((await fetch(origin + '/asset.js', { headers: { range: 'bytes=40-' } })).status, 416);
  assert.equal(await (await fetch(origin + '/', { method: 'HEAD' })).text(), '');
  const xml = await fetch(origin + '/sitemap.xml');
  assert.equal(xml.status, 200); assert.match(xml.headers.get('content-type'), /application\/xml/);
});

test('approved promo is a bounded faststart file with a poster and captions', async (t) => {
  const dir = fileURLToPath(new URL('../public/assets/promo/', import.meta.url));
  const video = await stat(join(dir, 'compass-promo.mp4'));
  assert.ok(video.size > 200_000 && video.size <= 10 * 1024 * 1024, video.size);
  const bytes = await readFile(join(dir, 'compass-promo.mp4'));
  const boxes = [];
  for (let offset = 0; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    if (size < 8 || offset + size > bytes.length) break;
    boxes.push(bytes.toString('ascii',offset + 4,offset + 8));
    offset += size;
  }
  assert.ok(boxes.indexOf('moov') >= 0 && boxes.indexOf('moov') < boxes.indexOf('mdat'), 'faststart metadata precedes media');
  assert.ok(bytes.includes(Buffer.from('avc1')) && bytes.includes(Buffer.from('mp4a')), 'H.264 video and AAC audio');
  const poster = await stat(join(dir, 'compass-promo.jpg'));
  assert.ok(poster.size > 10_000 && poster.size < 400_000, poster.size);
  const root = fileURLToPath(new URL('../public/', import.meta.url));
  const app = createCompassServer({ env: { STATIC_ROOT: root, COMPASS_REVISION: 'promo' } });
  t.after(() => app.close());
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const origin = 'http://127.0.0.1:' + app.server.address().port;
  const mp4 = await fetch(origin + '/assets/promo/compass-promo.mp4', { headers: { range: 'bytes=0-11' } });
  assert.equal(mp4.status, 206);
  assert.match(mp4.headers.get('content-type'), /^video\/mp4/);
  assert.match(await mp4.text(), /ftyp/);
  const captions = await fetch(origin + '/assets/promo/compass-promo.en.vtt');
  assert.equal(captions.status, 200);
  assert.match(captions.headers.get('content-type'), /text\/vtt/);
  const text = await captions.text();
  assert.match(text, /^WEBVTT/);
  assert.match(text, /Build me a premium website for an AI company/);
  const cues = [...text.matchAll(/(\d{2}):(\d{2})\.(\d{3}) --> (\d{2}):(\d{2})\.(\d{3})/g)];
  assert.equal(cues.length, 7);
  let previousEnd = 0;
  for (const cue of cues) {
    const start = Number(cue[1]) * 60000 + Number(cue[2]) * 1000 + Number(cue[3]);
    const end = Number(cue[4]) * 60000 + Number(cue[5]) * 1000 + Number(cue[6]);
    assert.ok(start >= previousEnd && end > start && end <= 40124);
    previousEnd = end;
  }
  const jpg = await fetch(origin + '/assets/promo/compass-promo.jpg');
  assert.equal(jpg.status, 200);
  assert.match(jpg.headers.get('content-type'), /^image\/jpeg/);
  const webp = await fetch(origin + '/assets/promo/compass-promo.webp');
  assert.equal(webp.status, 200);
  assert.match(webp.headers.get('content-type'), /^image\/webp/);
});
