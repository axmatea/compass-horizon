import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createCompassServer } from '../server.mjs';

const password = 'Account integration password 84!';
const configuredOrigin = 'http://localhost:8779';

async function fixture(t, enabled = true) {
  const root = await mkdtemp(join(tmpdir(), 'compass-account-api-'));
  const assets=join(root,'public');await mkdir(assets);
  await Promise.all(['index', 'demo', 'create', 'studio', 'plan'].map(name => writeFile(join(assets, `${name}.html`), `<!doctype html><h1>${name}</h1>`)));
  const env = { NODE_ENV: 'test', STATIC_ROOT: assets, BUILDER_STEP_MS: '0', COMPASS_DEMO_MODE: 'examples',
    ...(enabled ? { COMPASS_ACCOUNT_MODE: 'staging', COMPASS_ACCOUNT_ORIGIN: configuredOrigin,
      COMPASS_ACCOUNT_DATABASE: join(root, 'isolated.sqlite'), BETTER_AUTH_SECRET: randomBytes(32).toString('base64url') } : {}),
  };
  let app = createCompassServer({ env });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  let networkOrigin = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
  // Send actual HTTP through the complete server, simulating the exact Host
  // and Origin that the trusted Railway ingress supplies to the application.
  const request = (path, { method = 'GET', body, cookie, headers = {} } = {}) => new Promise((resolve, reject) => {
    const req = httpRequest(networkOrigin + path, { method, headers: {
      host: new URL(configuredOrigin).host,
      ...(!['GET', 'HEAD'].includes(method) ? { origin: configuredOrigin, 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}), ...headers,
    } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) responseHeaders.append(key, item);
        }
        resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: responseHeaders }));
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
  await request('/api/account/config');
  const restart = async () => {
    await app.close();
    app = createCompassServer({ env });
    app.server.listen(0, '127.0.0.1');
    await once(app.server, 'listening');
    networkOrigin = `http://127.0.0.1:${app.server.address().port}`;
    assert.equal((await (await request('/api/account/config')).json()).configured, true);
  };
  return { get app() { return app; }, request, restart };
}

async function account(request, name) {
  const response = await request('/api/auth/sign-up/email', { method: 'POST', body: { name, email: `${name}@compass.test`, password } });
  assert.equal(response.status, 200, await response.clone().text());
  const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  assert.match(cookie, /session_token=/);
  const me = await request('/api/account/me', { cookie });
  assert.equal(me.status, 200);
  return { cookie, ...await me.json() };
}

function revision(result) {
  return { id: 'revision_1', at: new Date().toISOString(), prompt: 'Build a minimal real estate website called Forma Estates.',
    number: 1, plan: { intent: result.intent, version: result.version },
    render: { html: result.html, version: result.version, pending: [] }, source: result.source, placeholder: result.placeholder };
}

async function turn(request, user, input, key = 'operation_initial_1234') {
  return request('/api/account/turn', { method: 'POST', cookie: user.cookie, headers: { 'idempotency-key': key }, body: input });
}

test('accounts are disabled by default while the public builder remains available', async t => {
  const { request } = await fixture(t, false);
  const config = await (await request('/api/account/config')).json();
  assert.equal(config.enabled, false);
  assert.equal(config.configured, false);
  assert.equal(config.persistence, 'unavailable');
  assert.equal((await request('/api/account/me')).status, 503);
  assert.equal((await request('/api/auth/get-session')).status, 503);
  assert.equal((await request('/workspace')).status, 404);
  assert.equal((await request('/demo')).status, 200);
  const publicBuild = await request('/api/site/turn', { method: 'POST', body: { text: 'A white website for a bakery' } });
  assert.equal(publicBuild.status, 200);
  assert.equal((await publicBuild.json()).source, 'prepared');
});

test('profile preferences belong to the verified account and reject arbitrary fields', async t => {
  const { request } = await fixture(t);
  const one = await account(request, 'one'), two = await account(request, 'two');
  assert.notEqual(one.userId, two.userId);
  const first = await request('/api/account/profile', { method: 'PUT', cookie: one.cookie,
    body: { owner: two.userId, preferences: { projectType: 'website', visualDirection: 'editorial' } } });
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { preferences: { projectType: 'website', visualDirection: 'editorial' } });
  assert.deepEqual(await (await request('/api/account/profile', { cookie: two.cookie })).json(), { preferences: {} });
  const bad = await request('/api/account/profile', { method: 'PUT', cookie: one.cookie, body: { preferences: { visualDirection: 'unknown', admin: true } } });
  assert.equal(bad.status, 400);
  assert.equal((await request('/api/account/profile')).status, 401);
  assert.equal((await request('/api/account/profile', { cookie: one.cookie, headers: { origin: 'https://attacker.test' } })).status, 403);
  assert.equal((await request('/api/account/profile', { method: 'PUT', cookie: one.cookie, headers: { origin: '' }, body: { preferences: {} } })).status, 403);
});

test('private builds are owner-scoped, idempotent and inaccessible through public session URLs', async t => {
  const { request } = await fixture(t);
  const one = await account(request, 'one'), two = await account(request, 'two');
  const input = { text: 'Build a premium real estate website called Forma Estates.' };
  const built = await turn(request, one, input);
  assert.equal(built.status, 200, await built.clone().text());
  assert.equal(built.headers.get('cache-control'), 'no-store');
  const result = await built.json();
  assert.match(result.html, /Forma Estates/);
  const replay = await turn(request, one, input);
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), result);
  const conflict = await turn(request, one, { text: 'Build a different bakery site.' });
  assert.equal(conflict.status, 409);
  const guessed = await turn(request, two, { text: 'Make it darker.', sessionId: result.sessionId }, 'operation_other_12345');
  assert.equal(guessed.status, 404);
  assert.equal((await request('/api/site/session/' + result.sessionId + '/page')).status, 404);
  const publicProbe = await request('/api/site/turn', { method: 'POST', body: { sessionId: result.sessionId, text: 'Make it lighter.' } });
  assert.equal(publicProbe.status, 200);
  const publicResult = await publicProbe.json();
  assert.notEqual(publicResult.sessionId, result.sessionId);
  assert.doesNotMatch(publicResult.html, /Forma Estates/);
  const missingKey = await request('/api/account/turn', { method: 'POST', cookie: one.cookie, body: { text: 'Make it darker.' } });
  assert.equal(missingKey.status, 400);
  const noCookie = await turn(request, { cookie: '' }, input, 'operation_missing_123');
  assert.equal(noCookie.status, 401);
  const refined = await turn(request, one, { text: 'Make it darker.', sessionId: result.sessionId }, 'operation_refine_1234');
  assert.equal(refined.status, 200);
  const changed = await refined.json();
  assert.equal(changed.intent.theme, 'dark');
  assert.ok(changed.version > result.version);
  const usage = await (await request('/api/account/usage', { cookie: one.cookie })).json();
  assert.equal(usage.billingEnabled, false);
  assert.equal(usage.creditsEnabled, false);
  assert.equal(usage.currencyCost, null);
  assert.equal(usage.operations.find(item => item.status === 'succeeded').count, 2, 'replay does not duplicate operations');
  const otherUsage = await (await request('/api/account/usage', { cookie: two.cookie })).json();
  assert.deepEqual(otherUsage.operations, [{ status: 'failed', count: 1 }]);
  assert.deepEqual(otherUsage.attempts, [], 'a guessed private id makes no model request');
});

test('project save/list/reopen/delete isolate owners and reject active HTML', async t => {
  const { request } = await fixture(t);
  const one = await account(request, 'one'), two = await account(request, 'two');
  const result = await (await turn(request, one, { text: 'Build a minimal real estate website called Forma Estates.' })).json();
  const payload = { name: 'Forma Estates', revisions: [revision(result)], owner: two.userId };
  const saved = await request('/api/account/projects', { method: 'POST', cookie: one.cookie, body: payload });
  assert.equal(saved.status, 200, await saved.clone().text());
  const { project } = await saved.json();
  assert.ok(project.id.startsWith('p_'));
  assert.equal((await (await request('/api/account/projects', { cookie: one.cookie })).json()).projects.length, 1);
  assert.deepEqual((await (await request('/api/account/projects', { cookie: two.cookie })).json()).projects, []);
  assert.deepEqual((await (await request('/api/account/projects/' + project.id, { cookie: one.cookie })).json()).project, project);
  assert.equal((await request('/api/account/projects/' + project.id, { cookie: two.cookie })).status, 404);
  assert.equal((await request('/api/account/projects/' + project.id, { method: 'DELETE', cookie: two.cookie })).status, 404);
  assert.equal((await request('/api/account/projects', { method: 'POST', cookie: two.cookie, body: { ...payload, projectId: project.id } })).status, 404);
  const hostile = revision(result);
  hostile.render.html = '<!doctype html><html><body><script>alert(1)</script></body></html>';
  assert.equal((await request('/api/account/projects', { method: 'POST', cookie: one.cookie, body: { name: 'Unsafe', revisions: [hostile] } })).status, 400);
  hostile.render.html = '<!doctype html><html><body><a href="&#106;avascript:alert(1)">Open</a></body></html>';
  assert.equal((await request('/api/account/projects', { method: 'POST', cookie: one.cookie, body: { name: 'Encoded link', revisions: [hostile] } })).status, 400);
  assert.equal((await request('/api/account/projects/' + project.id, { method: 'DELETE', cookie: one.cookie })).status, 200);
  assert.equal((await request('/api/account/projects/' + project.id, { cookie: one.cookie })).status, 404);
  assert.deepEqual((await (await request('/api/account/projects', { cookie: one.cookie })).json()).projects, []);
});

test('successful build receipts survive a profile change and a server restart without repeating generation', async t => {
  const { request, restart } = await fixture(t);
  const one = await account(request, 'one'), two = await account(request, 'two');
  const initialInput = { text: 'Build a premium real estate website called Forma Estates.' };
  const initial = await (await turn(request, one, initialInput)).json();
  const refineInput = { text: 'Make it darker.', sessionId: initial.sessionId };
  const refinedResponse = await turn(request, one, refineInput, 'operation_refine_1234');
  assert.equal(refinedResponse.status, 200);
  const refined = await refinedResponse.json();
  const profile = await request('/api/account/profile', { method: 'PUT', cookie: one.cookie, body: { preferences: { visualDirection: 'editorial' } } });
  assert.equal(profile.status, 200);
  const beforeRestart = await turn(request, one, refineInput, 'operation_refine_1234');
  assert.equal(beforeRestart.status, 200);
  assert.deepEqual(await beforeRestart.json(), refined, 'preferences added later must not change the original receipt');
  const savedResponse = await request('/api/account/projects', { method: 'POST', cookie: one.cookie, body: { name: 'Forma after refinement', revisions: [revision(refined)] } });
  assert.equal(savedResponse.status, 200);
  const { project } = await savedResponse.json();

  await restart();
  assert.equal((await (await request('/api/account/me', { cookie: one.cookie })).json()).userId, one.userId);
  for (const [input, key, expected] of [[initialInput, 'operation_initial_1234', initial], [refineInput, 'operation_refine_1234', refined]]) {
    const replay = await turn(request, one, input, key);
    assert.equal(replay.status, 200, await replay.clone().text());
    assert.deepEqual(await replay.json(), expected, 'the persisted result is returned even though the old runtime no longer exists');
  }
  const other = await turn(request, two, refineInput, 'operation_refine_1234');
  assert.equal(other.status, 404);
  assert.deepEqual(await other.json(), { error: 'session_not_found' });
  assert.equal((await request('/api/site/session/' + initial.sessionId + '/page')).status, 404);
  assert.deepEqual((await (await request('/api/account/projects/' + project.id, { cookie: one.cookie })).json()).project, project);
  const usage = await (await request('/api/account/usage', { cookie: one.cookie })).json();
  assert.deepEqual(usage.operations, [{ status: 'succeeded', count: 2 }], 'receipt replays create no new operations');
  assert.deepEqual(usage.attempts, [], 'prepared replay requires no provider calls');
});

test('an open workspace cannot act under a different account after shared cookies change', async t => {
  const { request } = await fixture(t);
  const one = await account(request, 'one'), two = await account(request, 'two');
  const built = await turn(request, one, { text: 'Build a premium real estate website called Forma Estates.' });
  assert.equal(built.status, 200);
  const result = await built.json();
  const staleHeaders = { 'x-compass-user': one.userId };
  for (const [path, options] of [
    ['/api/account/me', {}],
    ['/api/account/turn', { method: 'POST', headers: { 'idempotency-key': 'stale_workspace_12345' }, body: { text: 'An entirely new site for a studio.' } }],
    ['/api/account/projects', { method: 'POST', body: { name: 'Stale private page', revisions: [revision(result)] } }],
  ]) {
    const response = await request(path, { ...options, cookie: two.cookie, headers: { ...options.headers, ...staleHeaders } });
    assert.equal(response.status, 403, path);
    assert.deepEqual(await response.json(), { error: 'account_changed' });
  }
  assert.deepEqual((await (await request('/api/account/usage', { cookie: two.cookie })).json()).operations, []);
  assert.deepEqual((await (await request('/api/account/projects', { cookie: two.cookie })).json()).projects, []);
  const valid = await request('/api/account/me', { cookie: two.cookie, headers: { 'x-compass-user': two.userId } });
  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).userId, two.userId, 'the header is checked against the cookie; it never supplies identity');
});
