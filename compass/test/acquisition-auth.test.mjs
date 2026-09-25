import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, request as nodeRequest } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { verifyPassword } from 'better-auth/crypto';
import { createAuth, normalizeInviteEmail } from '../server/acquisition/auth.mjs';
import { createInvite, main as inviteMain } from '../scripts/acquisition-invite.mjs';

const secret = randomBytes(48).toString('base64url');
const password = 'Synthetic-password-for-tests-482!';
const env = { NODE_ENV: 'test', BETTER_AUTH_URL: 'http://127.0.0.1:8770', BETTER_AUTH_SECRET: secret };

test('configuration fails closed before database access', async (t) => {
  const pool = { connect() { assert.fail('configuration must be checked first'); }, query() {} };
  await t.test('missing PostgreSQL pool', () => assert.rejects(createAuth({ env }), { code: 'AUTH_CONFIGURATION_ERROR', status: 503 }));
  for (const value of [undefined, '', 'short', ' '.repeat(40)]) {
    await t.test(`rejects absent/short/blank secret ${typeof value}:${value?.length}`, () =>
      assert.rejects(createAuth({ pool, env: { ...env, BETTER_AUTH_SECRET: value } }), { code: 'AUTH_CONFIGURATION_ERROR' }));
  }
  for (const url of [undefined, 'not a URL', 'https://example.test/path', 'https://user:pass@example.test', 'https://example.test?query', 'https://example.test/#fragment', 'http://example.test']) {
    await t.test(`rejects unsafe origin ${url}`, () => assert.rejects(createAuth({ pool, env: { ...env, BETTER_AUTH_URL: url } }), { code: 'AUTH_CONFIGURATION_ERROR' }));
  }
  await t.test('production requires HTTPS including localhost', () => assert.rejects(createAuth({ pool, env: { ...env, NODE_ENV: 'production' } }), { code: 'AUTH_CONFIGURATION_ERROR' }));
});

test('unavailable database exposes no connection details', async () => {
  const pool = { connect() { throw new Error('DO_NOT_EXPOSE_CONNECTION_DETAILS'); }, query() {} };
  await assert.rejects(createAuth({ pool, env }), (error) => error.status === 503 && error.code === 'AUTH_UNAVAILABLE' && !error.message.includes('DO_NOT_EXPOSE'));
});

test('email normalization and validation', () => {
  assert.equal(normalizeInviteEmail(' Invited.Person+test@Example.TEST '), 'invited.person+test@example.test');
  for (const value of [null, [], {}, '', 'a@', '@b.test', 'a b@c.test', 'a\nb@c.test', 'a..b@c.test', '.a@c.test', 'a@b.c', '\u00e9@b.test', '"a"@b.test', 'a'.repeat(255) + '@b.test']) {
    assert.throws(() => normalizeInviteEmail(value), { code: 'INVALID_INPUT' });
  }
});

test('invite helper stores only a hash and no account or workspace', async () => {
  const calls = [];
  const pool = { async query(sql, params) {
    calls.push({ sql, params });
    return { rows: [{ id: params[0], expires_at: new Date() }] };
  } };
  const invite = await createInvite({ pool, email: ' SYNTHETIC@Example.test ' });
  assert.match(invite.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO acq_invites/);
  assert.doesNotMatch(calls[0].sql, /acq_tenants|acq_auth_users/);
  assert.equal(calls[0].params[1], createHash('sha256').update(invite.token).digest('hex'));
  assert.equal(calls[0].params[2], 'synthetic@example.test');
  assert.ok(!calls[0].params.includes(invite.token));
  for (const expiresInHours of [0, -1, 169, 0.5, NaN]) {
    await assert.rejects(createInvite({ pool, email: 'test@example.test', expiresInHours }));
  }
  assert.equal(calls.length, 1);
});

test('manual invite CLI requires explicit confirmation and valid arguments', async () => {
  await assert.rejects(inviteMain(['--email', 'test@example.test'], {}), /--confirm-create/);
  await assert.rejects(inviteMain(['--confirm-create'], {}), /Usage/);
  await assert.rejects(inviteMain(['--confirm-create', '--email', 'test@example.test', '--unexpected'], {}), /Usage/);
  await assert.rejects(inviteMain(['--confirm-create', '--email', 'test@example.test', '--expires-hours', '0'], {}), /Expiry/);
  await assert.rejects(inviteMain(['--confirm-create', '--email', 'test@example.test'], {}), /DATABASE_URL/);
});

test('PostgreSQL: invite-only accounts, sessions, isolation, races, and rollback', {
  skip: process.env.ACQUISITION_TEST_DATABASE_URL ? false : 'Set ACQUISITION_TEST_DATABASE_URL to an expendable PostgreSQL database.',
  timeout: 120_000,
}, async (t) => {
  // Only this randomly named schema is created/dropped. Never use DATABASE_URL.
  const schema = `acq_auth_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: process.env.ACQUISITION_TEST_DATABASE_URL, connectionTimeoutMillis: 5000 });
  let pool;
  let server;
  t.after(async () => {
    if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    if (pool) await pool.end();
    try { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await admin.end(); }
  });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  pool = new Pool({ connectionString: process.env.ACQUISITION_TEST_DATABASE_URL, options: `-c search_path=${schema}`, max: 8, connectionTimeoutMillis: 5000 });
  let auth;
  server = createServer(async (req, res) => {
    try {
      if (await auth.handle(req, res)) return;
      const identity = await auth.getIdentity(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(identity));
    } catch (error) {
      res.writeHead(error.status || 500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: error.message, code: error.code }));
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const testEnv = { ...env, BETTER_AUTH_URL: origin };
  const request = async (path, { method = 'GET', body, headers = {} } = {}) => {
    const response = await fetch(`${origin}${path}`, {
      method, headers: { ...(method === 'POST' ? { origin, 'content-type': 'application/json' } : {}), ...headers },
      ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    });
    return { status: response.status, headers: response.headers, data: await response.json() };
  };
  const post = (path, body, headers) => request(path, { method: 'POST', body, headers });
  const issue = (email) => createInvite({ pool, email });
  const accept = (invite, overrides = {}) => auth.acceptInvite({ token: invite.token, email: invite.email, name: 'Synthetic Invitee', password, ...overrides });
  const counts = async (email) => (await pool.query(`SELECT
    (SELECT count(*)::int FROM acq_auth_users WHERE email = $1) AS users,
    (SELECT count(*)::int FROM acq_auth_accounts WHERE "userId" IN (SELECT id FROM acq_auth_users WHERE email = $1)) AS accounts,
    (SELECT count(*)::int FROM acq_tenants WHERE user_id IN (SELECT id FROM acq_auth_users WHERE email = $1)) AS tenants`, [email])).rows[0];
  const signIn = async (email, headers) => {
    const result = await post('/api/auth/sign-in/email', { email, password }, headers);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    const setCookies = result.headers.getSetCookie();
    assert.ok(setCookies.some((cookie) => cookie.includes('session_token=')));
    for (const cookie of setCookies) {
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /SameSite=Strict/i);
      assert.doesNotMatch(cookie, /Domain=/i);
    }
    return { result, cookie: setCookies.map((cookie) => cookie.split(';')[0]).join('; ') };
  };

  await t.test('concurrent startup uses additive migrations and leaves zero accounts', async () => {
    [auth] = await Promise.all([createAuth({ pool, env: testEnv }), createAuth({ pool, env: testEnv })]);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM acq_auth_users')).rows[0].n, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM acq_tenants')).rows[0].n, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM acq_invites')).rows[0].n, 0);
    assert.deepEqual((await request('/identity')).data, null);
    assert.equal(await auth.handle({ url: '/api/unrelated' }, {}), false);
  });

  await t.test('single-connection pool startup cannot deadlock', async () => {
    const single = new Pool({ connectionString: process.env.ACQUISITION_TEST_DATABASE_URL, options: `-c search_path=${schema}`, max: 1, connectionTimeoutMillis: 5000 });
    try { await createAuth({ pool: single, env: testEnv }); } finally { await single.end(); }
  });

  await t.test('only the three Better Auth endpoints are exposed', async () => {
    for (const path of ['/sign-up/email', '/sign-up/email/', '/sign-up%2Femail', '/forget-password', '/reset-password', '/update-user', '/change-email', '/list-sessions', '/ok']) {
      assert.equal((await post(`/api/auth${path}`, {})).status, 404, path);
    }
    assert.equal((await request('/api/auth/sign-in/email')).status, 405);
    assert.equal((await post('/api/auth/get-session', {})).status, 405);
    const session = await request('/api/auth/get-session');
    assert.equal(session.status, 200);
    assert.equal(session.data, null);
    assert.equal(session.headers.get('cache-control'), 'no-store');
    const normalized = { statusCode: 0, setHeader() {}, end() {} };
    assert.equal(await auth.handle({ url: '/unrelated/../api/auth/sign-up/email', method: 'POST' }, normalized), true);
    assert.equal(normalized.statusCode, 404);
  });

  await t.test('CSRF, origin, JSON, and bounded body checks run before authentication', async () => {
    for (const originHeader of ['', 'null', 'https://attacker.test', `${origin}.attacker.test`]) {
      assert.equal((await post('/api/auth/sign-in/email', {}, { origin: originHeader })).status, 403);
      assert.equal((await post('/api/acquisition/accept-invite', {}, { origin: originHeader })).status, 403);
    }
    const absentOrigin = await fetch(`${origin}/api/auth/sign-in/email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(absentOrigin.status, 403);
    await absentOrigin.text();
    assert.equal((await request('/api/auth/get-session', { headers: { 'sec-fetch-site': 'same-site' } })).status, 403);
    assert.equal((await post('/api/auth/sign-in/email', {}, { 'content-type': 'text/plain' })).status, 415);
    assert.equal((await post('/api/auth/sign-in/email', '{broken')).status, 400);
    assert.equal((await post('/api/auth/sign-in/email', 'x'.repeat(17_000))).status, 413);
    const chunked = await new Promise((resolve, reject) => {
      const req = nodeRequest(`${origin}/api/auth/sign-in/email`, { method: 'POST', headers: { origin, 'content-type': 'application/json' } }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
      req.write('x'.repeat(17_000));
      req.end();
    });
    assert.equal(chunked, 413);
  });

  let tenantA;
  let tenantB;
  let cookieA;
  let cookieB;
  await t.test('two email-bound invites create isolated tenants and Better Auth sessions', async () => {
    const a = await issue('a@example.test');
    const b = await issue('b@example.test');
    await assert.rejects(accept(a, { email: b.email }), { code: 'INVITE_INVALID' });
    await assert.rejects(accept(a, { password: 'short' }), { code: 'INVALID_INPUT' });
    await assert.rejects(accept(a, { token: randomBytes(32).toString('base64url') }), { code: 'INVITE_INVALID' });
    assert.deepEqual(await counts(a.email), { users: 0, accounts: 0, tenants: 0 });
    const accepted = await post('/api/acquisition/accept-invite', { ...a, email: ' A@EXAMPLE.TEST ', name: 'Tenant A', password });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
    assert.deepEqual(accepted.data, { ok: true });
    assert.deepEqual(accepted.headers.getSetCookie(), []);
    assert.deepEqual(await accept(b), { ok: true });
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM acq_auth_sessions')).rows[0].n, 0);
    const stored = (await pool.query('SELECT password FROM acq_auth_accounts LIMIT 1')).rows[0].password;
    assert.notEqual(stored, password);
    assert.equal(await verifyPassword({ hash: stored, password }), true);
    ({ cookie: cookieA } = await signIn(a.email));
    ({ cookie: cookieB } = await signIn(b.email));
    tenantA = (await request('/identity', { headers: { cookie: cookieA } })).data;
    tenantB = (await request('/identity', { headers: { cookie: cookieB } })).data;
    assert.match(tenantA.tenantId, /^[0-9a-f-]{36}$/);
    assert.notEqual(tenantA.tenantId, tenantB.tenantId);
    assert.notEqual(tenantA.userId, tenantB.userId);
    assert.deepEqual((await request(`/identity?tenantId=${tenantB.tenantId}`, { headers: { cookie: cookieA, 'x-tenant-id': tenantB.tenantId, 'x-user-id': tenantB.userId } })).data, tenantA);
    assert.equal((await request('/identity', { headers: { authorization: `Bearer ${cookieA}`, 'x-tenant-id': tenantA.tenantId } })).data, null);
    const session = (await request('/api/auth/get-session', { headers: { cookie: cookieA } })).data;
    assert.equal(session.user.id, tenantA.userId);
    await assert.rejects(accept(a), { code: 'INVITE_INVALID' });
    assert.deepEqual(await counts(a.email), { users: 1, accounts: 1, tenants: 1 });
    const used = (await pool.query('SELECT consumed_at, consumed_by, token_hash FROM acq_invites WHERE id = $1', [a.id])).rows[0];
    assert.ok(used.consumed_at);
    assert.equal(used.consumed_by, tenantA.userId);
    assert.notEqual(used.token_hash, a.token);
  });

  await t.test('sign-out invalidates server sessions immediately without affecting another tenant', async () => {
    const out = await post('/api/auth/sign-out', {}, { cookie: cookieA });
    assert.equal(out.status, 200);
    assert.ok(out.headers.getSetCookie().some((cookie) => /Max-Age=0/i.test(cookie)));
    assert.equal((await request('/identity', { headers: { cookie: cookieA } })).data, null);
    assert.equal((await request('/api/auth/get-session', { headers: { cookie: cookieA } })).data, null);
    assert.deepEqual((await request('/identity', { headers: { cookie: cookieB } })).data, tenantB);
    assert.equal((await post('/api/auth/sign-in/email', { email: 'a@example.test', password: 'Incorrect-password-482!' })).status, 401);
    const tampered = cookieB.replace(/session_token=./, 'session_token=X');
    assert.equal((await request('/identity', { headers: { cookie: tampered } })).data, null);
  });

  await t.test('expired invites never create users and cannot be replayed', async () => {
    const invite = await issue('expired@example.test');
    await pool.query("UPDATE acq_invites SET created_at = CURRENT_TIMESTAMP - INTERVAL '2 days', expires_at = CURRENT_TIMESTAMP - INTERVAL '1 day' WHERE id = $1", [invite.id]);
    await assert.rejects(accept(invite), { code: 'INVITE_INVALID' });
    assert.deepEqual(await counts(invite.email), { users: 0, accounts: 0, tenants: 0 });
  });

  await t.test('concurrent token acceptance creates exactly one account and workspace', async () => {
    const invite = await issue('race@example.test');
    const results = await Promise.allSettled([accept(invite), accept(invite)]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'INVITE_INVALID');
    assert.deepEqual(await counts(invite.email), { users: 1, accounts: 1, tenants: 1 });
  });

  await t.test('distinct invites for the same email cannot leave orphan accounts', async () => {
    const invites = await Promise.all([issue('duplicate@example.test'), issue('duplicate@example.test')]);
    const results = await Promise.allSettled(invites.map((invite) => accept(invite)));
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'INVITE_INVALID');
    assert.deepEqual(await counts(invites[0].email), { users: 1, accounts: 1, tenants: 1 });
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM acq_invites WHERE email = $1 AND consumed_at IS NULL', [invites[0].email])).rows[0].n, 1);
  });

  await t.test('workspace failure rolls back both account tables and token consumption', async () => {
    const invite = await issue('rollback@example.test');
    await pool.query('ALTER TABLE acq_tenants ADD CONSTRAINT auth_test_reject_new CHECK (false) NOT VALID');
    try {
      await assert.rejects(accept(invite), { status: 503, code: 'AUTH_UNAVAILABLE' });
      assert.deepEqual(await counts(invite.email), { users: 0, accounts: 0, tenants: 0 });
      assert.equal((await pool.query('SELECT consumed_at FROM acq_invites WHERE id = $1', [invite.id])).rows[0].consumed_at, null);
    } finally { await pool.query('ALTER TABLE acq_tenants DROP CONSTRAINT auth_test_reject_new'); }
    assert.deepEqual(await accept(invite), { ok: true });
  });

  await t.test('expiry is checked after waiting for a row lock, not just at transaction start', async () => {
    const invite = await issue('wait-expiry@example.test');
    await pool.query("UPDATE acq_invites SET expires_at = clock_timestamp() + INTERVAL '500 milliseconds' WHERE id = $1", [invite.id]);
    const blocker = await pool.connect();
    let outcome;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM acq_invites WHERE id = $1 FOR UPDATE', [invite.id]);
      outcome = assert.rejects(accept(invite), { code: 'INVITE_INVALID' });
      await delay(650);
      await blocker.query('COMMIT');
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }
    await outcome;
    assert.deepEqual(await counts(invite.email), { users: 0, accounts: 0, tenants: 0 });
  });

  await t.test('restart preserves sessions and expired server sessions are rejected', async () => {
    auth = await createAuth({ pool, env: testEnv });
    assert.deepEqual((await request('/identity', { headers: { cookie: cookieB } })).data, tenantB);
    await pool.query('UPDATE acq_auth_sessions SET "expiresAt" = CURRENT_TIMESTAMP - INTERVAL \'1 second\' WHERE "userId" = $1', [tenantB.userId]);
    assert.equal((await request('/identity', { headers: { cookie: cookieB } })).data, null);
  });

  await t.test('production cookies are Secure and URL/Host forwarding cannot relax the origin', async () => {
    auth = await createAuth({ pool, env: { ...testEnv, NODE_ENV: 'production', BETTER_AUTH_URL: 'https://compass.example.test' } });
    assert.equal((await post('/api/auth/sign-in/email', { email: 'a@example.test', password }, { origin, 'x-forwarded-host': 'compass.example.test', 'x-forwarded-proto': 'https' })).status, 403);
    const signed = await signIn('a@example.test', { origin: 'https://compass.example.test' });
    for (const cookie of signed.result.headers.getSetCookie()) {
      assert.match(cookie, /; Secure/i);
      assert.match(cookie, /^__Secure-/);
    }
    auth = await createAuth({ pool, env: testEnv });
  });

  await t.test('missing membership and database failure cannot become an identity', async () => {
    const signed = await signIn('a@example.test');
    await pool.query('DELETE FROM acq_tenants WHERE user_id = $1', [tenantA.userId]);
    assert.equal((await request('/identity', { headers: { cookie: signed.cookie } })).data, null);
    await pool.query('ALTER TABLE acq_tenants RENAME TO auth_test_hidden_tenants');
    try {
      const response = await request('/identity', { headers: { cookie: signed.cookie } });
      assert.equal(response.status, 503);
      assert.equal(response.data.code, 'AUTH_UNAVAILABLE');
      assert.doesNotMatch(response.data.error, /relation|SELECT|postgres/i);
    } finally { await pool.query('ALTER TABLE auth_test_hidden_tenants RENAME TO acq_tenants'); }
  });

  await t.test('authentication attempts are rate limited independently of spoofed proxy headers', async () => {
    auth = await createAuth({ pool, env: testEnv });
    for (let attempt = 0; attempt < 30; attempt++) {
      assert.equal((await post('/api/acquisition/accept-invite', {}, { 'x-forwarded-for': `192.0.2.${attempt}` })).status, 400);
    }
    const response = await post('/api/acquisition/accept-invite', {}, { 'x-forwarded-for': '198.51.100.1' });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '60');
  });

  await t.test('incompatible application membership schema blocks readiness', async () => {
    await pool.query('ALTER TABLE acq_tenants RENAME COLUMN user_id TO auth_test_old_user_id');
    try {
      await assert.rejects(createAuth({ pool, env: testEnv }), { status: 503, code: 'AUTH_UNAVAILABLE' });
    } finally { await pool.query('ALTER TABLE acq_tenants RENAME COLUMN auth_test_old_user_id TO user_id'); }
    await createAuth({ pool, env: testEnv });
  });
});
