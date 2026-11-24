import assert from 'node:assert/strict';
import test from 'node:test';
import {COMPASS_ORIGIN, SESSION_COOKIE, createTransport, readSessionCookie} from '../src/transport.mjs';

const token = 'fixture_payload.signed%2B';
const sessionHeader = `${SESSION_COOKIE}=${token}; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax`;
const response = (body, status = 200, headers = {}) => Response.json(body, {status, headers});

function memory(initial = null) {
  let value = initial;
  return {get: async () => value, set: async next => {value = next;}, clear: async () => {value = null;}};
}

test('capture only exact secure, host-only COMPASS session from native Set-Cookie headers', () => {
  const joined = new Headers({'set-cookie': 'analytics=opaque; expires=Wed, 21 Oct 2026 07:28:00 GMT, ' + sessionHeader});
  assert.equal(readSessionCookie(joined), token);
  for (const invalid of [
    'unrelated=not-a-session; Secure; HttpOnly',
    `${SESSION_COOKIE}=value; Secure`,
    `${SESSION_COOKIE}=value; HttpOnly`,
    `${SESSION_COOKIE}=value; Secure; HttpOnly`,
    `${SESSION_COOKIE}=value; Secure; HttpOnly; Path=/; Domain=mycompass.world`,
    `${SESSION_COOKIE}=value; Secure; HttpOnly; Path=/; Max-Age=0`,
    `${SESSION_COOKIE}=value with spaces; Secure; HttpOnly; Path=/`,
  ]) assert.equal(readSessionCookie(new Headers({'set-cookie': invalid})), null);
});

test('email sign-in verifies database identity before storing the same signed cookie and owner binding', async () => {
  const storage = memory();
  const calls = [];
  const api = createTransport(async (url, options) => {
    calls.push({url, options});
    assert.equal(options.headers.get('origin'), COMPASS_ORIGIN);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    if (url.endsWith('/sign-in/email')) {
      assert.equal(options.headers.get('cookie'), null);
      assert.equal(JSON.parse(options.body).email, 'fixture@example.test');
      return response({user: {id: 'unverified_response'}}, 200, {'set-cookie': sessionHeader});
    }
    if (url.endsWith('/me')) {
      assert.equal(await storage.get(), null);
      assert.equal(options.headers.get('cookie'), `${SESSION_COOKIE}=${token}`);
      assert.equal(options.headers.get('x-compass-user'), null);
      return response({userId: 'owner_fixture'});
    }
    assert.equal(options.headers.get('x-compass-user'), 'owner_fixture');
    assert.equal(options.headers.get('cookie'), `${SESSION_COOKIE}=${token}`);
    return response({applications: []});
  }, storage);
  assert.deepEqual(await api.signIn('fixture@example.test', 'fixture-password'), {userId: 'owner_fixture'});
  assert.equal(await storage.get(), token);
  assert.deepEqual(await api.request('/api/account/apps'), {applications: []});
  assert.equal(calls.length, 3);
});

test('protected routes require a prior session and reject foreign, encoded, redirect and unknown routes', async () => {
  const storage = memory(token);
  let calls = 0;
  const api = createTransport(async (url) => {
    calls++;
    if (url.endsWith('/me')) return response({userId: 'fixture_owner'});
    return Response.redirect('https://example.test/');
  }, storage);
  await assert.rejects(api.request('/api/account/apps'), {code: 'sign_in_required'});
  await api.restore();
  for (const path of ['https://example.test/api/account/apps', '//example.test/api/account/apps', '/api/account/apps?next=foreign',
    '/api/account/apps/%2e%2e', '/api/account/admin', '/workspace', '/api/auth/sign-in/social']) {
    await assert.rejects(api.request(path), {code: 'invalid_request'});
  }
  assert.equal(calls, 1);
  await assert.rejects(api.request('/api/account/apps'), {code: 'invalid_response'});
});

test('stale signed sessions clear the secure store and cannot make another protected request', async () => {
  const storage = memory(token);
  let calls = 0;
  const api = createTransport(async url => {
    calls++;
    return url.endsWith('/me') ? response({userId: 'fixture_owner'}) : response({error: 'sign_in_required'}, 401);
  }, storage);
  await api.restore();
  await assert.rejects(api.request('/api/account/apps'), {code: 'sign_in_required'});
  assert.equal(await storage.get(), null);
  await assert.rejects(api.request('/api/account/apps'), {code: 'sign_in_required'});
  assert.equal(calls, 2);
});

test('expired rehydration returns signed out and an offline sign-out clears credentials locally', async () => {
  const expired = memory(token);
  const expiredApi = createTransport(async () => response({error: 'sign_in_required'}, 401), expired);
  assert.equal(await expiredApi.restore(), null);
  assert.equal(await expired.get(), null);

  const stored = memory(token);
  const offline = createTransport(async url => {
    if (url.endsWith('/me')) return response({userId: 'fixture_owner'});
    throw new Error('fixture offline');
  }, stored);
  await offline.restore();
  await assert.rejects(offline.signOut(), /fixture offline/);
  assert.equal(await stored.get(), null);
});

test('bounded mobile requests preserve idempotency, optimistic validation and image bytes', async () => {
  const storage = memory(token);
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  const api = createTransport(async (url, options) => {
    if (url.endsWith('/me')) return response({userId: 'fixture_owner'});
    if (url.endsWith('/assets')) {
      assert.deepEqual(options.body, bytes);
      assert.equal(options.headers.get('x-compass-app-version'), '5');
      assert.equal(options.headers.get('content-type'), 'image/png');
      return response({application: {version: 6}});
    }
    if (url.endsWith('/plan')) {
      assert.equal(JSON.parse(options.body).platform, 'cross-platform');
      assert.equal(options.headers.get('idempotency-key'), 'synthetic-mobile-plan-key');
      return response({manifest: {title: 'Synthetic mobile project'}});
    }
    assert.equal(JSON.parse(options.body).expectedUpdatedAt, '2026-11-24T17:00:00.000Z');
    return response({error: 'project_version_conflict'}, 409);
  }, storage);
  await api.restore();
  await api.request('/api/account/apps/plan', {method: 'POST', key: 'synthetic-mobile-plan-key', json: {text: 'Build a project', platform: 'cross-platform'}});
  await api.request('/api/account/apps/app_123/assets', {method: 'POST', bytes, mime: 'image/png', appVersion: 5});
  await assert.rejects(api.request('/api/account/projects', {method: 'POST', json: {projectId: 'p_123', expectedUpdatedAt: '2026-11-24T17:00:00.000Z'}}),
    {code: 'project_version_conflict'});
  assert.equal(await storage.get(), token);
});
