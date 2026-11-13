import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, rm, stat, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createAccountAuth } from '../account/auth.mjs';

const password = 'Synthetic staging password 42!';

async function fixture(t, extra = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'compass-account-test-'));
  let auth;
  const server = createServer(async (req, res) => {
    try { if (!await auth.handleNode(req, res)) { res.statusCode = 404; res.end(); } }
    catch { res.statusCode = 500; res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const env = { NODE_ENV: 'test', COMPASS_ACCOUNT_MODE: 'staging', COMPASS_ACCOUNT_ORIGIN: extra.secureOrigin ? origin.replace('http:', 'https:') : origin,
    COMPASS_ACCOUNT_DATABASE: join(directory, 'account.sqlite'), BETTER_AUTH_SECRET: randomBytes(32).toString('base64url'), ...extra.env };
  auth = createAccountAuth({ env, ...extra.options });
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await auth.close();
    await rm(directory, { recursive: true, force: true });
  });
  await auth.ready;
  const request = (path, { method = 'GET', body, cookie, headers = {}, redirect = 'manual' } = {}) => fetch(origin + path, {
    method, redirect, headers: {
      ...(method === 'POST' ? { origin: env.COMPASS_ACCOUNT_ORIGIN, 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}), ...headers,
    }, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
  const restart = async () => {
    await auth.close();
    auth = createAccountAuth({ env, ...extra.options });
    await auth.ready;
    return auth;
  };
  return { auth, origin, env, directory, request, restart };
}

function cookieFor(response) {
  return response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
}

async function register(request, name = 'One') {
  const response = await request('/api/auth/sign-up/email', { method: 'POST', body: { name: `Tester ${name}`, email: `${name.toLowerCase()}@compass.test`, password } });
  assert.equal(response.status, 200, await response.clone().text());
  const cookie = cookieFor(response);
  assert.match(cookie, /compass-account-staging\.session_token=/);
  return { response, cookie, body: await response.json() };
}

test('account auth is off by default and does not create any database', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'compass-disabled-auth-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'must-not-exist.sqlite');
  const auth = createAccountAuth({ env: { COMPASS_ACCOUNT_DATABASE: path } });
  await auth.ready;
  assert.equal(auth.publicConfig().enabled, false);
  assert.equal(auth.publicConfig().configured, false);
  assert.equal(auth.database, null);
  assert.equal(await auth.getIdentity(new Headers({ cookie: 'fake=anything' })), null);
  await assert.rejects(access(path));
  await auth.close();
});

test('missing/unsafe staging config fails closed without touching a file', async t => {
  for (const env of [
    { COMPASS_ACCOUNT_MODE: 'staging' },
    { NODE_ENV: 'production', COMPASS_ACCOUNT_MODE: 'staging', COMPASS_ACCOUNT_ORIGIN: 'http://127.0.0.1:9000' },
    { COMPASS_ACCOUNT_MODE: 'staging', COMPASS_ACCOUNT_ORIGIN: 'https://example.test/path' },
    { COMPASS_ACCOUNT_MODE: 'staging', COMPASS_ACCOUNT_ORIGIN: 'https://user:pass@example.test' },
    { COMPASS_ACCOUNT_MODE: 'staging', COMPASS_ACCOUNT_ORIGIN: 'https://example.test', BETTER_AUTH_SECRET: 'short', COMPASS_ACCOUNT_DATABASE: '/tmp/unopened.sqlite' },
    ...['https://mycompass.world', 'https://www.mycompass.world', 'https://MYCOMPASS.WORLD.'].map(origin => ({
      NODE_ENV: 'production', COMPASS_ACCOUNT_MODE: 'staging', COMPASS_ACCOUNT_ORIGIN: origin,
      BETTER_AUTH_SECRET: randomBytes(32).toString('base64url'), COMPASS_ACCOUNT_DATABASE: '/tmp/unopened-primary.sqlite',
    })),
  ]) {
    const auth = createAccountAuth({ env });
    await auth.ready;
    assert.equal(auth.publicConfig().configured, false);
    assert.equal(auth.database, null);
    await auth.close();
  }
  const { request } = await fixture(t, { env: { BETTER_AUTH_SECRET: '' } });
  const response = await request('/api/auth/get-session');
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { error: 'Account sign-in is not configured.', code: 'AUTH_UNAVAILABLE' });
});

test('real Better Auth registration uses private DB, hashed passwords and HttpOnly host-only cookies', async t => {
  const { auth, request, env } = await fixture(t);
  assert.deepEqual(auth.publicConfig(), { enabled: true, configured: true, provider: 'better-auth', providers: ['email'], emailMode: 'test', origin: env.COMPASS_ACCOUNT_ORIGIN, secretMode: 'configured' });
  const { response, cookie, body } = await register(request);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const sessionCookie = response.headers.getSetCookie().find(value => value.includes('session_token='));
  assert.match(sessionCookie, /HttpOnly/i);
  assert.match(sessionCookie, /SameSite=Lax/i);
  assert.ok(!/Domain=/i.test(sessionCookie));
  const identity = await auth.getIdentity(new Headers({ cookie }));
  assert.equal(identity.userId, body.user.id);
  assert.ok(identity.sessionId);
  const account = auth.database.prepare('SELECT password FROM compass_account_identity WHERE userId = ?').get(identity.userId);
  assert.ok(account.password.length > 40);
  assert.notEqual(account.password, password);
  assert.equal((await stat(env.COMPASS_ACCOUNT_DATABASE)).mode & 0o777, 0o600);
  assert.ok(!JSON.stringify(auth.publicConfig()).includes(env.BETTER_AUTH_SECRET));
});

test('real sign-in rejects a wrong password and logout revokes the database session', async t => {
  const { auth, request } = await fixture(t);
  const { cookie } = await register(request);
  const wrong = await request('/api/auth/sign-in/email', { method: 'POST', body: { email: 'one@compass.test', password: 'Wrong password 123!' } });
  assert.equal(wrong.status, 401);
  const login = await request('/api/auth/sign-in/email', { method: 'POST', body: { email: 'one@compass.test', password } });
  assert.equal(login.status, 200);
  const loginCookie = cookieFor(login);
  assert.ok(await auth.getIdentity(new Headers({ cookie: loginCookie })));
  const out = await request('/api/auth/sign-out', { method: 'POST', body: {}, cookie: loginCookie });
  assert.equal(out.status, 200);
  assert.equal(await auth.getIdentity(new Headers({ cookie: loginCookie })), null);
  assert.ok(await auth.getIdentity(new Headers({ cookie })), 'signout revokes the requested session, not a separate valid session');
});

test('expired database sessions, forged cookies, Bearer tokens and owner headers cannot authenticate', async t => {
  const { auth, request } = await fixture(t);
  const { cookie } = await register(request);
  const identity = await auth.getIdentity(new Headers({ cookie }));
  assert.equal(await auth.getIdentity(new Headers({ authorization: 'Bearer fabricated', 'x-user-id': identity.userId })), null);
  assert.equal(await auth.getIdentity(new Headers({ cookie: 'compass-account-staging.session_token=forged' })), null);
  assert.equal(await auth.getIdentity(new Headers({ cookie, origin: 'https://attacker.test' })), null);
  auth.database.prepare('UPDATE compass_account_session SET expiresAt = ? WHERE id = ?').run(0, identity.sessionId);
  assert.equal(await auth.getIdentity(new Headers({ cookie })), null);
});

test('two accounts have independent server identities; forged client identifiers are ignored', async t => {
  const { auth, request } = await fixture(t);
  const one = await register(request, 'One'), two = await register(request, 'Two');
  const first = await auth.getIdentity(new Headers({ cookie: one.cookie, 'x-user-id': two.body.user.id }));
  const second = await auth.getIdentity(new Headers({ cookie: two.cookie, 'x-user-id': one.body.user.id }));
  assert.equal(first.userId, one.body.user.id);
  assert.equal(second.userId, two.body.user.id);
  assert.notEqual(first.userId, second.userId);
  assert.notEqual(first.sessionId, second.sessionId);
  const duplicate = await request('/api/auth/sign-up/email', { method: 'POST', body: { name: 'Duplicate', email: 'one@compass.test', password } });
  assert.ok([200, 422].includes(duplicate.status));
  assert.equal(auth.database.prepare('SELECT COUNT(*) AS count FROM compass_account_user').get().count, 2);
});

test('cross-site mutations, origin/Host forgery and unconfigured routes are rejected before signup', async t => {
  const { auth, request, origin } = await fixture(t);
  const body = { name: 'Tester', email: 'origin@compass.test', password };
  for (const headers of [{ origin: 'https://attacker.test' }, { origin: 'null' }, { origin: '' }, { 'sec-fetch-site': 'cross-site' }]) {
    const response = await request('/api/auth/sign-up/email', { method: 'POST', headers, body });
    assert.equal(response.status, 403, JSON.stringify(headers));
  }
  const forgedHost = await new Promise((resolve, reject) => {
    const req = httpRequest(origin + '/api/auth/sign-up/email', { method: 'POST', headers: { host: 'attacker.test', origin, 'content-type': 'application/json' } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject); req.end(JSON.stringify(body));
  });
  assert.equal(forgedHost, 403);
  assert.equal(auth.database.prepare('SELECT COUNT(*) AS count FROM compass_account_user').get().count, 0);
  for (const path of ['/api/auth/request-password-reset', '/api/auth/sign-in/social', '/api/auth/delete-user', '/api/auth/callback/google']) {
    assert.equal((await request(path, { method: 'POST', body: {} })).status, 404);
  }
  assert.equal((await request('/api/auth/sign-up/email')).status, 405);
  assert.equal((await request('/api/unrelated')).status, 404);
});

test('no-delivery staging permits only .test registration and enforces library password/body limits', async t => {
  const { auth, request } = await fixture(t);
  const real = await request('/api/auth/sign-up/email', { method: 'POST', body: { name: 'Real', email: 'someone@example.com', password, emailVerified: true } });
  assert.equal(real.status, 403);
  assert.equal(auth.database.prepare('SELECT COUNT(*) AS count FROM compass_account_user').get().count, 0);
  const weak = await request('/api/auth/sign-up/email', { method: 'POST', body: { name: 'Weak', email: 'weak@compass.test', password: 'short' } });
  assert.equal(weak.status, 400);
  assert.equal((await request('/api/auth/sign-up/email', { method: 'POST', body: '{broken' })).status, 400);
  assert.equal((await request('/api/auth/sign-up/email', { method: 'POST', body: 'x'.repeat(17_000) })).status, 413);
  assert.equal((await request('/api/auth/sign-up/email', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415);
});

test('configured email delivery verifies a real library token and requires verification before sign-in', async t => {
  const messages = [];
  const { auth, request } = await fixture(t, { options: { sendEmail: async message => { messages.push(message); } } });
  assert.equal(auth.publicConfig().emailMode, 'verification');
  const signup = await request('/api/auth/sign-up/email', { method: 'POST', body: { name: 'Mail tester', email: 'mail@example.test', password } });
  assert.equal(signup.status, 200);
  assert.ok(!cookieFor(signup).includes('session_token='));
  assert.ok(messages.some(message => message.kind === 'verify-email'));
  const unverified = await request('/api/auth/sign-in/email', { method: 'POST', body: { email: 'mail@example.test', password } });
  assert.equal(unverified.status, 403);
  const verifyUrl = messages.find(message => message.kind === 'verify-email').text.match(/https?:\/\/\S+/)[0];
  const verify = await request(new URL(verifyUrl).pathname + new URL(verifyUrl).search, { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.ok([200, 302].includes(verify.status), await verify.clone().text());
  const login = await request('/api/auth/sign-in/email', { method: 'POST', body: { email: 'mail@example.test', password } });
  assert.equal(login.status, 200);
  const cookie = cookieFor(login);
  assert.ok(await auth.getIdentity(new Headers({ cookie })));
  const reset = await request('/api/auth/request-password-reset', { method: 'POST', body: { email: 'mail@example.test' } });
  assert.equal(reset.status, 200);
  assert.ok(messages.some(message => message.kind === 'reset-password'));
  const resetUrl = messages.find(message => message.kind === 'reset-password').text.match(/https?:\/\/\S+/)[0];
  const token = new URL(resetUrl).pathname.split('/').pop();
  const resetEntry = await request(new URL(resetUrl).pathname + new URL(resetUrl).search, { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(resetEntry.status, 302, await resetEntry.clone().text());
  assert.equal((await request('/api/auth/reset-password', { method: 'POST', headers: { origin: 'https://mail.example.test', 'sec-fetch-site': 'cross-site' },
    body: { token, newPassword: 'An attacker must not reset this password!' } })).status, 403);
  const resetPassword = await request('/api/auth/reset-password', { method: 'POST', body: { token, newPassword: 'Replacement synthetic password 73!' } });
  assert.equal(resetPassword.status, 200, await resetPassword.clone().text());
  assert.equal(await auth.getIdentity(new Headers({ cookie })), null, 'password reset revokes previous sessions');
  assert.equal((await request('/api/auth/sign-in/email', { method: 'POST', body: { email: 'mail@example.test', password: 'Replacement synthetic password 73!' } })).status, 200);
});

test('HTTPS configuration emits Secure cookies without sharing them with subdomains', async t => {
  const { request } = await fixture(t, { secureOrigin: true });
  const { response } = await register(request);
  const cookie = response.headers.getSetCookie().find(value => value.includes('session_token='));
  assert.match(cookie, /; Secure(?:;|$)/i);
  assert.match(cookie, /; HttpOnly(?:;|$)/i);
  assert.ok(!/Domain=/i.test(cookie));
});

test('provider names require complete server credentials and never expose credential values', async t => {
  const { auth, request } = await fixture(t, { env: {
    GOOGLE_CLIENT_ID: 'synthetic-google-client', GOOGLE_CLIENT_SECRET: 'synthetic-google-secret',
    GITHUB_CLIENT_ID: 'incomplete-github-client',
  } });
  assert.deepEqual(auth.publicConfig().providers, ['email', 'google']);
  assert.ok(!JSON.stringify(auth.publicConfig()).includes('synthetic-google'));
  assert.equal((await request('/api/auth/sign-in/social', { method: 'POST', body: { provider: 'github' } })).status, 400);
  assert.equal((await request('/api/auth/callback/github')).status, 404);
});

test('a failing database is denied instead of becoming a guest session', async t => {
  const { auth, request } = await fixture(t);
  const { cookie } = await register(request);
  auth.database.close();
  await assert.rejects(auth.getIdentity(new Headers({ cookie })), error => error.status === 503 && error.code === 'AUTH_UNAVAILABLE');
});

test('disposable staging storage has a real SQLite size cap and an atomic test-account cap', async t => {
  const { auth, request } = await fixture(t);
  const pageSize = auth.database.prepare('PRAGMA page_size').get().page_size;
  const maxPages = auth.database.prepare('PRAGMA max_page_count').get().max_page_count;
  assert.equal(pageSize * maxPages, 64 * 1024 * 1024);
  const { body } = await register(request);
  const user = auth.database.prepare('SELECT * FROM compass_account_user WHERE id = ?').get(body.user.id);
  const columns = Object.keys(user);
  const insert = auth.database.prepare(`INSERT INTO compass_account_user (${columns.map(name => `"${name}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
  for (let index = 1; index < 50; index++) {
    const value = { ...user, id: `synthetic_user_${index}`, email: `cap_${index}@compass.test` };
    insert.run(...columns.map(name => value[name]));
  }
  const over = { ...user, id: 'synthetic_user_over', email: 'over@compass.test' };
  assert.throws(() => insert.run(...columns.map(name => over[name])), /staging_account_limit/);
  const response = await request('/api/auth/sign-up/email', { method: 'POST', body: { name: 'Over cap', email: 'over_http@compass.test', password } });
  assert.equal(response.status, 429);
  assert.equal((await response.json()).code, 'STAGING_ACCOUNT_LIMIT');
  assert.equal(auth.database.prepare('SELECT count(*) AS count FROM compass_account_user').get().count, 50);
});

test('an explicitly ephemeral QA secret rotates across instances without exposing its value', async t => {
  const context = await fixture(t, { env: { BETTER_AUTH_SECRET: undefined, COMPASS_ACCOUNT_EPHEMERAL_SECRET: '1' } });
  assert.equal(context.auth.publicConfig().configured, true);
  assert.equal(context.auth.publicConfig().secretMode, 'ephemeral');
  const { cookie } = await register(context.request);
  assert.ok(await context.auth.getIdentity(new Headers({ cookie })));
  const next = await context.restart();
  assert.equal(next.publicConfig().configured, true);
  assert.equal(await next.getIdentity(new Headers({ cookie })), null, 'a fresh random signing key must reject the prior instance cookie');
  const login = await context.request('/api/auth/sign-in/email', { method: 'POST', body: { email: 'one@compass.test', password } });
  assert.equal(login.status, 200);
  assert.ok(await next.getIdentity(new Headers({ cookie: cookieFor(login) })), 'stored synthetic account can sign in again');
  assert.deepEqual(Object.keys(next.publicConfig()).sort(), ['configured', 'emailMode', 'enabled', 'origin', 'provider', 'providers', 'secretMode']);
});

test('an explicitly configured fixed secret wins and retains its session after restart', async t => {
  const context = await fixture(t, { env: { COMPASS_ACCOUNT_EPHEMERAL_SECRET: '1' } });
  assert.equal(context.auth.publicConfig().secretMode, 'configured');
  const { cookie } = await register(context.request);
  const before = await context.auth.getIdentity(new Headers({ cookie }));
  const next = await context.restart();
  assert.equal(next.publicConfig().secretMode, 'configured');
  assert.deepEqual(await next.getIdentity(new Headers({ cookie })), before);
});

test('ephemeral opt-in cannot enable a missing-secret real-provider or primary-domain configuration', async t => {
  const base = { COMPASS_ACCOUNT_MODE: 'staging', COMPASS_ACCOUNT_EPHEMERAL_SECRET: '1',
    COMPASS_ACCOUNT_ORIGIN: 'https://preview.example.test', COMPASS_ACCOUNT_DATABASE: '/tmp/compass-ephemeral-must-not-open.sqlite' };
  for (const env of [
    { ...base, COMPASS_ACCOUNT_MODE: 'off' },
    { ...base, COMPASS_ACCOUNT_ORIGIN: 'https://mycompass.world' },
    { ...base, COMPASS_ACCOUNT_ORIGIN: 'https://www.mycompass.world.' },
    { ...base, COMPASS_ACCOUNT_DATABASE: 'relative.sqlite' },
    { ...base, COMPASS_ACCOUNT_ORIGIN: 'http://public.example.test' },
    { ...base, BETTER_AUTH_SECRET: '' },
    { ...base, BETTER_AUTH_SECRET: 'short' },
    { ...base, GOOGLE_CLIENT_ID: 'synthetic-google', GOOGLE_CLIENT_SECRET: 'synthetic-google-secret' },
    { ...base, COMPASS_ACCOUNT_EMAIL_WEBHOOK_URL: 'https://delivery.example.test/send' },
  ]) {
    const auth = createAccountAuth({ env });
    await auth.ready;
    assert.equal(auth.publicConfig().configured, false);
    assert.equal(auth.publicConfig().secretMode, null);
    assert.equal(auth.database, null);
    await auth.close();
  }
});
