import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createCompassServer } from '../server.mjs';

test('homepage-only delivery retires old pages even if stale files exist', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'compass-home-'));
  for (const name of ['index', 'app', 'login', 'demo']) await writeFile(join(root, name + '.html'), '<h1>' + name + '</h1>');
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
  for (const path of ['/app', '/app.html', '/office', '/office?workspaceInvite=old', '/login', '/login.html', '/demo/workspace', '/demo/remaster/app', '/presentation', '/presentation/finale', '/protect', '/horizon', '/studio', '/vision', '/acquisition', '/voice-demo', '/film.html']) {
    assert.equal((await fetch(origin + path)).status, 410, path);
  }
  for (const path of ['/api', '/api/auth/get-session', '/api/workspaces', '/api/acquisition/state', '/api/remaster/state', '/api/waitlist', '/.env', '/unknown.html', '/unknown']) assert.equal((await fetch(origin + path)).status, 404, path);
  assert.equal((await fetch(origin + '/login', { method: 'POST' })).status, 405);
  const health = await fetch(origin + '/healthz');
  assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await health.json(), { ok: true, mode: 'public-demo', llmConfigured: false, revision: 'test-homepage' });
  const range = await fetch(origin + '/asset.js', { headers: { range: 'bytes=2-4' } });
  assert.equal(range.status, 206); assert.equal(await range.text(), 'cde');
  assert.equal((await fetch(origin + '/asset.js', { headers: { range: 'bytes=40-' } })).status, 416);
  assert.equal(await (await fetch(origin + '/', { method: 'HEAD' })).text(), '');
  const xml = await fetch(origin + '/sitemap.xml');
  assert.equal(xml.status, 200); assert.match(xml.headers.get('content-type'), /application\/xml/);
});
