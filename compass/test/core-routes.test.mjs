import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createCompassServer } from '../server.mjs';
import { createIdentityService } from '../server/auth-service.mjs';

test('core-only server keeps real routes and retires every demo, even stale HTML', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'compass-core-'));
  for (const name of ['index', 'app', 'login', 'protect', 'story', 'office']) await writeFile(join(root, `${name}.html`), `<h1>${name}</h1>`);
  await writeFile(join(root, '.env'), 'not-public');
  await writeFile(join(root, 'bundle.js'), 'abcdefghij');
  const identity = await createIdentityService({ env: {} });
  const workspaces = { status: () => ({ status: 'BLOCKED' }), handle: async () => false, close: async () => {} };
  const app = await createCompassServer({ env: { STATIC_ROOT: root, COMPASS_REVISION: 'test-core' }, identity, workspaces });
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  for (const [path, name] of [['/', 'index'], ['/app', 'app'], ['/login', 'login']]) {
    const r = await fetch(origin + path); assert.equal(r.status, 200); assert.equal(await r.text(), `<h1>${name}</h1>`);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  }
  const redirect = await fetch(`${origin}/office?workspaceInvite=example`, { redirect: 'manual' });
  assert.equal(redirect.status, 308); assert.equal(redirect.headers.get('location'), '/app?workspaceInvite=example');
  for (const path of ['/presentation', '/presentation/finale', '/presentation/legacy', '/present.html', '/story', '/story.html', '/protect', '/protect.html', '/studio/tour', '/horizon', '/vision', '/demo', '/demo/remaster/app', '/demo/workspace', '/voice-demo', '/live.html', '/acquisition/app']) {
    const r = await fetch(origin + path); assert.equal(r.status, 410, path); assert.doesNotMatch(await r.text(), /<h1>/);
  }
  for (const path of ['/.env', '/missing.html', '/office.html', '/api/voice', '/api/remaster/state', '/api/acquisition/runs']) assert.equal((await fetch(origin + path)).status, 404, path);
  const health = await (await fetch(origin + '/healthz')).json();
  assert.deepEqual(health, { ok: true, revision: 'test-core', auth: 'blocked', workspaces: 'BLOCKED' });
  assert.equal((await fetch(origin + '/api/auth/get-session')).status, 503);
  assert.equal((await fetch(origin + '/api/auth/status')).status, 200);
  assert.equal((await fetch(origin + '/api/acquisition/accept-invite', { method: 'POST' })).status, 503);
  const range = await fetch(origin + '/bundle.js', { headers: { range: 'bytes=2-4' } });
  assert.equal(range.status, 206); assert.equal(await range.text(), 'cde');
  assert.equal((await fetch(origin + '/bundle.js', { headers: { range: 'bytes=20-' } })).status, 416);
  assert.equal(await (await fetch(origin + '/app', { method: 'HEAD' })).text(), '');
  assert.equal((await fetch(origin + '/app', { method: 'POST' })).status, 405);
});

test('identity wrapper preserves existing auth handlers without acquisition workers', async (t) => {
  let invoked = 0, closed = false;
  const pool = { end: async () => { closed = true; } };
  const identity = await createIdentityService({ env: {}, pool, initialize: async () => ({
    getIdentity: async () => ({ userId: 'existing-user' }),
    handle: async (_req, res) => { invoked++; res.writeHead(200).end('existing-auth'); return true; },
  }) });
  const workspaces = { status: () => ({ status: 'READY' }), handle: async () => false, close: async () => {} };
  const app = await createCompassServer({ env: {}, identity, workspaces });
  t.after(() => app.close()); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const url = `http://127.0.0.1:${app.server.address().port}`;
  assert.deepEqual(await identity.getIdentity({}), { userId: 'existing-user' });
  for (const path of ['/api/auth/get-session', '/api/acquisition/accept-invite']) assert.equal(await (await fetch(url + path)).text(), 'existing-auth');
  assert.equal(invoked, 2);
  assert.equal((await fetch(url + '/api/auth/status', { method: 'POST' })).status, 405);
  await identity.close(); assert.equal(closed, false, 'injected pool is owned by caller');
});
