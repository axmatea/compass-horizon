import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createCompassServer } from '../server.mjs';

test('homepage-only delivery retires old pages even if stale files exist', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'compass-home-'));
  for (const name of ['index', 'app', 'login', 'demo', 'plan', 'studio']) await writeFile(join(root, name + '.html'), '<h1>' + name + '</h1>');
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
  for (const path of ['/app', '/app.html', '/office', '/office?workspaceInvite=old', '/login', '/login.html', '/demo/workspace', '/demo/remaster/app', '/presentation', '/presentation/finale', '/protect', '/horizon', '/studio/legacy', '/studio/legacy.html', '/studio.html', '/vision', '/acquisition', '/film.html']) {
    assert.equal((await fetch(origin + path)).status, 410, path);
  }
  for (const path of ['/api', '/api/auth/get-session', '/api/workspaces', '/api/acquisition/state', '/api/remaster/state', '/api/waitlist', '/.env', '/unknown.html', '/unknown']) assert.equal((await fetch(origin + path)).status, 404, path);
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

test('bundled walkthrough is a small faststart file with a poster and captions', async (t) => {
  const dir = fileURLToPath(new URL('../public/assets/demo/', import.meta.url));
  const video = await stat(join(dir, 'compass-walkthrough.mp4'));
  assert.ok(video.size > 200_000 && video.size <= 6 * 1024 * 1024, video.size);
  const poster = await stat(join(dir, 'compass-walkthrough.jpg'));
  assert.ok(poster.size > 10_000 && poster.size < 400_000, poster.size);
  const root = fileURLToPath(new URL('../public/', import.meta.url));
  const app = createCompassServer({ env: { STATIC_ROOT: root, COMPASS_REVISION: 'walkthrough' } });
  t.after(() => app.close());
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const origin = 'http://127.0.0.1:' + app.server.address().port;
  const mp4 = await fetch(origin + '/assets/demo/compass-walkthrough.mp4', { headers: { range: 'bytes=0-11' } });
  assert.equal(mp4.status, 206);
  assert.match(mp4.headers.get('content-type'), /^video\/mp4/);
  assert.match(await mp4.text(), /ftyp/);
  const captions = await fetch(origin + '/assets/demo/compass-walkthrough.vtt');
  assert.equal(captions.status, 200);
  assert.match(captions.headers.get('content-type'), /text\/vtt/);
  const text = await captions.text();
  assert.match(text, /^WEBVTT/);
  assert.match(text, /barbershop/i);
  assert.match(text, /dark/i);
  const jpg = await fetch(origin + '/assets/demo/compass-walkthrough.jpg');
  assert.equal(jpg.status, 200);
  assert.match(jpg.headers.get('content-type'), /^image\/jpeg/);
});
