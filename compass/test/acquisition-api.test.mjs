import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { Pool } from 'pg';
import { createAcquisition } from '../server/acquisition/api.mjs';
import { createInvite } from '../scripts/acquisition-invite.mjs';

const databaseURL = process.env.ACQUISITION_TEST_DATABASE_URL;
const syntheticPassword = 'Synthetic-HTTP-integration-password-842!';

function providerGuard() {
  const calls = [];
  const providers = {
    status: () => ['research', 'extract', 'metrics'].map((operation) => ({
      name: `Test ${operation}`, operation, status: 'BLOCKED', reason: 'External calls forbidden in integration tests.',
    })),
  };
  for (const operation of ['research', 'extract', 'metrics']) {
    providers[operation] = async () => {
      calls.push(operation);
      throw new Error('An integration test attempted a provider operation.');
    };
  }
  return { calls, providers };
}

async function serve({ pool, overrides = {} } = {}) {
  const guard = providerGuard();
  let app;
  const sockets = new Set();
  const server = createServer(async (req, res) => {
    try {
      if (await app.handle(req, res)) return;
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'No route in test harness.' }));
    } catch {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unexpected test harness failure.' }));
    }
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  let origin;
  // Exercise the real upgrade authorizer without starting any speech bridge.
  // The harness returns HTTP status only; it never upgrades to a provider socket.
  server.on('upgrade', async (req, socket) => {
    let status = 200;
    let payload;
    try {
      const runtime = await app.authorizeVoice(req, new URL(req.url, origin));
      payload = { authorized: Boolean(runtime) };
    } catch (error) {
      status = error.status || 500;
      payload = { error: error.message };
    }
    const body = JSON.stringify(payload);
    socket.end(`HTTP/1.1 ${status} Test Result\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
  const env = {
    NODE_ENV: 'test', BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
    ACQUISITION_SPONSOR_CALLS_ENABLED: 'false', ACQUISITION_VOICE_ENABLED: 'false',
    ...overrides,
  };
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try { await app?.close(); } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    }
  };
  try {
    // No auth injection: the real createAuth initializes on the same pg pool.
    app = await createAcquisition({ pool, env, providers: guard.providers, startWorker: false });
  } catch (error) { await close(); throw error; }

  const request = async (path, { method = 'GET', body, cookie, headers = {} } = {}) => {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: {
        ...(!['GET', 'HEAD'].includes(method) ? { origin, 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}), ...headers,
      },
      ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10_000),
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
  const post = (path, body, options = {}) => request(path, { ...options, method: 'POST', body });
  const voice = ({ cookie, leadId = randomUUID(), headers = {} } = {}) => new Promise((resolve, reject) => {
    const req = httpRequest(`${origin}/api/voice/realtime?domain=acquisition&leadId=${encodeURIComponent(leadId)}`, {
      headers: { origin, Connection: 'Upgrade', Upgrade: 'websocket', ...(cookie ? { cookie } : {}), ...headers },
      agent: false,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); } catch (error) { reject(error); }
      });
      res.on('error', reject);
    });
    req.setTimeout(10_000, () => req.destroy(new Error('Voice authorization timed out.')));
    req.on('error', reject);
    req.end();
  });
  return { app, env, origin, request, post, voice, close, providerCalls: guard.calls };
}

function expectError(response, status) {
  assert.equal(response.status, status, JSON.stringify(response.body));
  assert.equal(typeof response.body.error, 'string');
  assert.notEqual(response.body.ok, true);
  return response;
}

function within(promise, milliseconds) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('HTTP stream did not close in time.')), milliseconds); }),
  ]).finally(() => clearTimeout(timer));
}

test('HTTP without PostgreSQL fails closed, including early-access requests', { timeout: 20_000 }, async (t) => {
  const host = await serve();
  t.after(() => host.close());
  const status = await host.request('/api/acquisition/status');
  assert.equal(status.status, 200);
  assert.equal(status.body.database, 'blocked');
  assert.equal(status.body.billingEnabled, false);
  assert.equal(status.body.sponsorCallsEnabled, false);
  assert.equal(status.body.voice.status, 'blocked');
  for (const path of ['/api/acquisition/state', '/api/acquisition/metrics', '/api/auth/get-session']) {
    expectError(await host.request(path), 503);
  }
  for (const [path, input] of [
    ['/api/early-access', { email: 'no-database@example.test', consent: true }],
    ['/api/acquisition/accept-invite', { email: 'no-database@example.test', token: randomBytes(32).toString('base64url'), name: 'Synthetic', password: syntheticPassword }],
    ['/api/auth/sign-in/email', { email: 'no-database@example.test', password: syntheticPassword }],
  ]) expectError(await host.post(path, input), 503);
  expectError(await host.voice(), 503);
  assert.deepEqual(host.providerCalls, []);
});

test('HTTP acquisition with real PostgreSQL and Better Auth', {
  skip: databaseURL ? false : 'Set ACQUISITION_TEST_DATABASE_URL to an expendable PostgreSQL database.',
  timeout: 120_000,
}, async (t) => {
  const schema = `acq_api_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: databaseURL, connectionTimeoutMillis: 5000 });
  let pool;
  let host;
  t.after(async () => {
    try { await host?.close(); } finally {
      try { await pool?.end(); } finally {
        try { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await admin.end(); }
      }
    }
  });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  // Every auth/store/worker query is confined to our random schema. Never public.
  pool = new Pool({ connectionString: databaseURL, options: `-c search_path=${schema}`, max: 8, connectionTimeoutMillis: 5000 });
  host = await serve({ pool });
  const a = { email: 'http-tenant-a@example.test', name: 'Synthetic HTTP Tenant A' };
  const b = { email: 'http-tenant-b@example.test', name: 'Synthetic HTTP Tenant B' };
  const getState = async (person, suffix = '', headers = {}) => {
    const response = await host.request(`/api/acquisition/state${suffix}`, { cookie: person.cookie, headers });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return response.body;
  };
  const signIn = async (person) => {
    const response = await host.post('/api/auth/sign-in/email', { email: person.email, password: syntheticPassword });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    person.cookie = response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ');
    assert.match(person.cookie, /session_token=/);
    const session = await host.request('/api/auth/get-session', { cookie: person.cookie });
    person.userId = session.body.user.id;
    person.tenantId = (await pool.query('SELECT id FROM acq_tenants WHERE user_id = $1', [person.userId])).rows[0].id;
  };

  await t.test('readiness is public but workspace, metrics, collections, and SSE require sessions', async () => {
    const status = await host.request('/api/acquisition/status');
    assert.equal(status.status, 200);
    assert.equal(status.body.database, 'ready');
    assert.equal(status.body.billingEnabled, false);
    assert.equal(status.body.sponsorCallsEnabled, false);
    assert.equal(status.body.voice.status, 'blocked');
    assert.ok(!JSON.stringify(status.body).includes(host.env.BETTER_AUTH_SECRET));
    for (const path of ['state', 'metrics', 'projects', 'experiments', 'leads', 'runs', 'events']) {
      expectError(await host.request(`/api/acquisition/${path}`), 401);
    }
    const spoof = await host.request('/api/acquisition/state', {
      headers: { 'x-tenant-id': randomUUID(), 'x-user-id': randomUUID(), authorization: 'Bearer forged', cookie: 'tenantId=forged' },
    });
    expectError(spoof, 401);
    assert.equal((await host.request('/api/auth/get-session')).body, null);
  });

  await t.test('signup stays blocked and only approved invites create accounts through HTTP', async () => {
    const before = (await pool.query('SELECT count(*)::int AS n FROM acq_auth_users')).rows[0].n;
    expectError(await host.post('/api/auth/sign-up/email', { ...a, password: syntheticPassword }), 404);
    expectError(await host.post('/api/auth/change-email', { newEmail: b.email }), 404);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM acq_auth_users')).rows[0].n, before);
    for (const person of [a, b]) {
      const invite = await createInvite({ pool, email: person.email });
      const response = await host.post('/api/acquisition/accept-invite', { token: invite.token, email: person.email, name: person.name, password: syntheticPassword });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.deepEqual(response.body, { ok: true });
      assert.deepEqual(response.headers.getSetCookie(), []);
      await signIn(person);
    }
    assert.notEqual(a.userId, b.userId);
    assert.notEqual(a.tenantId, b.tenantId);
    const empty = await getState(a);
    assert.equal(empty.project, null);
    assert.deepEqual(empty.leads, []);
    assert.equal(empty.mode, 'LIVE');
  });

  await t.test('same-origin, JSON, and body-size checks reject writes before mutation', async () => {
    const input = { name: 'Must not be saved', goal: 'Origin boundary' };
    for (const origin of ['', 'null', 'https://attacker.example.test', `${host.origin}.attacker.test`]) {
      expectError(await host.post('/api/acquisition/projects', input, { cookie: a.cookie, headers: { origin } }), 403);
    }
    const noOrigin = await fetch(`${host.origin}/api/acquisition/projects`, {
      method: 'POST', headers: { cookie: a.cookie, 'content-type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(5000),
    });
    assert.equal(noOrigin.status, 403);
    await noOrigin.text();
    expectError(await host.post('/api/acquisition/projects', input, { cookie: a.cookie, headers: { 'content-type': 'text/plain' } }), 415);
    expectError(await host.post('/api/acquisition/projects', '{invalid', { cookie: a.cookie }), 400);
    expectError(await host.post('/api/acquisition/projects', 'x'.repeat(17_000), { cookie: a.cookie }), 413);
    expectError(await host.post('/api/early-access', { email: 'csrf@example.test', consent: true }, { headers: { origin: 'https://attacker.example.test' } }), 403);
    assert.equal((await getState(a)).project, null);
  });

  await t.test('two tenants create projects, experiments, leads, and evidence; updates persist', async () => {
    for (const person of [a, b]) {
      const project = await host.post('/api/acquisition/projects', { name: person.name, goal: 'Synthetic qualification', rules: { minBudget: 5000, maxTimelineDays: 90 } }, { cookie: person.cookie });
      assert.equal(project.status, 200, JSON.stringify(project.body));
      person.projectId = project.body.state.project.id;
      const experiment = await host.post('/api/acquisition/experiments', { name: `Experiment ${person.name}`, hypothesis: 'Synthetic response', audience: 'Synthetic owners', message: 'Synthetic test message' }, { cookie: person.cookie });
      assert.equal(experiment.status, 201, JSON.stringify(experiment.body));
      person.experimentId = experiment.body.state.experiments[0].id;
      const lead = await host.post('/api/acquisition/leads', {
        name: `Lead ${person.name}`, experimentId: person.experimentId, problem: 'Synthetic workflow',
        decisionMaker: true, businessFit: true, budget: person === a ? null : 7000, timelineDays: 30,
      }, { cookie: person.cookie });
      assert.equal(lead.status, 201, JSON.stringify(lead.body));
      person.leadId = lead.body.state.leads[0].id;
    }
    assert.equal((await getState(a)).leads[0].fields.budget, null);
    const event = {
      source: 'synthetic-http', externalId: randomUUID(), leadId: a.leadId,
      occurredAt: new Date(Date.now() + 1000).toISOString(), fields: { budget: 8000 },
    };
    const evidence = await host.post('/api/acquisition/events', event, { cookie: a.cookie });
    assert.equal(evidence.status, 200, JSON.stringify(evidence.body));
    assert.equal(evidence.body.duplicate, false);
    assert.equal(evidence.body.state.leads[0].qualification.status, 'QUALIFIED');
    const replay = await host.post('/api/acquisition/events', event, { cookie: a.cookie });
    assert.equal(replay.body.duplicate, true);
    assert.equal(replay.body.state.events.length, evidence.body.state.events.length);
    const update = await host.post('/api/acquisition/projects', {
      name: `${a.name} Updated`, goal: 'Updated synthetic goal', rules: { minBudget: 9000, maxTimelineDays: 90 },
    }, { cookie: a.cookie });
    assert.equal(update.status, 200);
    assert.equal(update.body.state.project.id, a.projectId);
    assert.equal(update.body.state.project.rulesVersion, 2);
    assert.equal(update.body.state.leads[0].qualification.status, 'NOT_ICP');
    assert.equal((await getState(b)).project.rulesVersion, 1);
    const unknown = await host.post('/api/acquisition/leads', { name: 'Synthetic A unattributed lead' }, { cookie: a.cookie });
    assert.equal(unknown.status, 201);
    assert.equal(unknown.body.state.leads.length, 2);
    const missing = unknown.body.state.leads.find((lead) => lead.id !== a.leadId);
    assert.equal(missing.fields.budget, null);
    assert.equal(missing.qualification.status, 'NEEDS_CONTEXT');
  });

  await t.test('foreign experiments/leads and explicit tenant or mode overrides are rejected', async () => {
    const before = await getState(a);
    expectError(await host.post('/api/acquisition/leads', { name: 'Foreign experiment', experimentId: a.experimentId }, { cookie: b.cookie }), 404);
    expectError(await host.post('/api/acquisition/events', {
      source: 'synthetic-foreign', externalId: randomUUID(), leadId: a.leadId,
      occurredAt: new Date().toISOString(), fields: { budget: 1 },
    }, { cookie: b.cookie }), 404);
    expectError(await host.post('/api/acquisition/runs', { operation: 'extract', text: 'Foreign lead text', leadId: a.leadId }, { cookie: b.cookie }), 404);
    expectError(await host.request(`/api/acquisition/leads/${a.leadId}`, { cookie: b.cookie }), 404);
    for (const [key, value] of [['tenantId', a.tenantId], ['tenant_id', a.tenantId], ['mode', 'DEMO']]) {
      expectError(await host.post('/api/acquisition/leads', { name: 'Forbidden override', [key]: value }, { cookie: b.cookie }), 400);
    }
    expectError(await host.request('/api/acquisition/leads', { method: 'DELETE', cookie: b.cookie }), 405);
    assert.deepEqual(await getState(a), before);
    assert.equal((await getState(b)).leads.length, 1);
  });

  await t.test('state, metrics, and collection reads contain only the authenticated tenant', async () => {
    const expectedCounts = new Map([[a, 2], [b, 1]]);
    for (const [person, other] of [[a, b], [b, a]]) {
      const state = await getState(person, `?tenantId=${other.tenantId}`, { 'x-tenant-id': other.tenantId, 'x-user-id': other.userId });
      assert.equal(state.project.id, person.projectId);
      assert.equal(state.leads.length, expectedCounts.get(person));
      assert.ok(!JSON.stringify(state).includes(other.leadId));
      assert.ok(!JSON.stringify(state).includes(other.projectId));
      const metrics = await host.request(`/api/acquisition/metrics?tenant_id=${other.tenantId}`, { cookie: person.cookie, headers: { 'x-tenant-id': other.tenantId } });
      assert.equal(metrics.status, 200);
      assert.equal(metrics.headers.get('cache-control'), 'no-store');
      assert.equal(metrics.body.metrics.source, 'PostgreSQL');
      assert.equal(metrics.body.metrics.totalLeads, expectedCounts.get(person));
      for (const collection of ['projects', 'experiments', 'leads']) {
        const response = await host.request(`/api/acquisition/${collection}?tenantId=${other.tenantId}`, { cookie: person.cookie });
        assert.equal(response.status, 200);
        assert.ok(!JSON.stringify(response.body).includes(other.projectId));
        assert.ok(!JSON.stringify(response.body).includes(other.experimentId));
        assert.ok(!JSON.stringify(response.body).includes(other.leadId));
      }
    }
    const publicStatus = await host.request('/api/acquisition/status');
    assert.ok(!JSON.stringify(publicStatus.body).includes(a.tenantId));
    assert.ok(!JSON.stringify(publicStatus.body).includes(a.name));
  });

  await t.test('run ownership is enforced and the disabled worker cannot call providers', async () => {
    for (const person of [a, b]) {
      const response = await host.post('/api/acquisition/runs', { operation: 'extract', text: 'Synthetic response only', leadId: person.leadId }, { cookie: person.cookie });
      assert.equal(response.status, 202, JSON.stringify(response.body));
      person.runId = response.body.run.id;
      assert.equal(response.body.run.status, 'queued');
    }
    for (const [person, other] of [[a, b], [b, a]]) {
      expectError(await host.post(`/api/acquisition/runs/${other.runId}/resume`, {}, { cookie: person.cookie }), 404);
      expectError(await host.request(`/api/acquisition/runs/${other.runId}`, { cookie: person.cookie }), 404);
      const own = await host.request(`/api/acquisition/runs?tenantId=${other.tenantId}`, { cookie: person.cookie });
      assert.equal(own.status, 200);
      assert.deepEqual(own.body.runs.map((run) => run.id), [person.runId]);
    }
    assert.equal(await host.app.worker.tick(), true);
    assert.equal(await host.app.worker.tick(), true);
    for (const person of [a, b]) {
      const run = (await getState(person)).runs[0];
      assert.equal(run.status, 'blocked');
      assert.equal(run.checkpoint, 'blocked');
      assert.equal(run.result, null);
    }
    assert.deepEqual(host.providerCalls, []);
    const resumed = await host.post(`/api/acquisition/runs/${a.runId}/resume`, {}, { cookie: a.cookie });
    assert.equal(resumed.status, 200);
    assert.equal(resumed.body.run.id, a.runId);
    assert.equal(resumed.body.run.status, 'queued');
    await host.app.worker.tick();
    assert.deepEqual(host.providerCalls, []);
  });

  await t.test('early access requires consent and returns success only after a visible commit', async () => {
    expectError(await host.post('/api/early-access', { email: 'consent-missing@example.test', consent: false }), 400);
    const email = 'durable-request@example.test';
    const observer = await pool.connect();
    try {
      const saved = await host.post('/api/early-access', { email, name: 'Synthetic Request', business: 'Synthetic Business', consent: true });
      assert.equal(saved.status, 201, JSON.stringify(saved.body));
      assert.deepEqual(saved.body, { ok: true });
      const rows = (await observer.query('SELECT email, name, business, consent FROM acq_early_access WHERE email = $1', [email])).rows;
      assert.deepEqual(rows, [{ email, name: 'Synthetic Request', business: 'Synthetic Business', consent: true }]);
    } finally { observer.release(); }
    assert.deepEqual((await host.post('/api/early-access', { email, consent: true })).body, { ok: true });
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM acq_early_access WHERE email = $1', [email])).rows[0].n, 1);
    await pool.query('ALTER TABLE acq_early_access ADD CONSTRAINT api_test_reject_new CHECK (false) NOT VALID');
    try {
      const failure = await host.post('/api/early-access', { email: 'failed-write@example.test', consent: true });
      assert.ok(failure.status >= 500 && failure.status <= 599, JSON.stringify(failure));
      assert.equal(typeof failure.body.error, 'string');
      assert.notEqual(failure.body.ok, true);
      assert.doesNotMatch(failure.body.error, /INSERT|constraint|api_test_reject_new/i);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM acq_early_access WHERE email = $1', ['failed-write@example.test'])).rows[0].n, 0);
    } finally { await pool.query('ALTER TABLE acq_early_access DROP CONSTRAINT api_test_reject_new'); }
    const retried = await host.post('/api/early-access', { email: 'failed-write@example.test', consent: true });
    assert.equal(retried.status, 201);
    const limited = await host.post('/api/early-access', { email: 'rate-rejected@example.test', consent: true }, { headers: { 'x-forwarded-for': '192.0.2.1' } });
    expectError(limited, 429);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM acq_early_access WHERE email = $1', ['rate-rejected@example.test'])).rows[0].n, 0);
  });

  await t.test('voice upgrade authorization blocks disabled spend, anonymous users, and foreign leads', async () => {
    const before = (await pool.query('SELECT count(*)::int AS n FROM acq_runs')).rows[0].n;
    expectError(await host.voice({ cookie: a.cookie, leadId: a.leadId }), 503);
    expectError(await host.voice(), 503);
    host.env.ACQUISITION_VOICE_ENABLED = 'true';
    try {
      expectError(await host.voice({ cookie: a.cookie, leadId: a.leadId }), 503);
      // Authorization only: no bridge, real credentials, worker, or provider is enabled.
      host.env.ACQUISITION_SPONSOR_CALLS_ENABLED = 'true';
      expectError(await host.voice({ leadId: a.leadId }), 401);
      expectError(await host.voice({ cookie: a.cookie, leadId: a.leadId, headers: { origin: 'https://attacker.example.test' } }), 403);
      expectError(await host.voice({ cookie: b.cookie, leadId: a.leadId }), 404);
      const allowed = await host.voice({ cookie: a.cookie, leadId: a.leadId });
      assert.equal(allowed.status, 200);
      assert.deepEqual(allowed.body, { authorized: true });
    } finally {
      host.env.ACQUISITION_VOICE_ENABLED = 'false';
      host.env.ACQUISITION_SPONSOR_CALLS_ENABLED = 'false';
    }
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM acq_runs')).rows[0].n, before);
    assert.deepEqual(host.providerCalls, []);
  });

  await t.test('a separate application instance reads durable state and the existing server session', async (subtest) => {
    const restarted = await serve({ pool, overrides: { BETTER_AUTH_SECRET: host.env.BETTER_AUTH_SECRET } });
    subtest.after(() => restarted.close());
    const response = await restarted.request('/api/acquisition/state', { cookie: a.cookie });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.project.id, a.projectId);
    assert.equal(response.body.leads.length, 2);
    assert.equal(response.body.runs[0].id, a.runId);
    assert.deepEqual(restarted.providerCalls, []);
  });

  await t.test('SSE is tenant-bound and closes after server-side sign-out', { timeout: 15_000 }, async (subtest) => {
    let req;
    let resolveFirst;
    let rejectFirst;
    const first = new Promise((resolve, reject) => { resolveFirst = resolve; rejectFirst = reject; });
    const ended = new Promise((resolve, reject) => {
      req = httpRequest(`${host.origin}/api/acquisition/events`, { headers: { cookie: a.cookie }, agent: false }, (res) => {
        try {
          assert.equal(res.statusCode, 200);
          assert.match(res.headers['content-type'], /text\/event-stream/);
        } catch (error) { rejectFirst(error); reject(error); res.resume(); return; }
        let buffer = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          buffer += chunk;
          const data = buffer.match(/event: state\ndata: ([^\n]+)\n\n/);
          if (data) {
            try { resolveFirst(JSON.parse(data[1])); } catch (error) { rejectFirst(error); }
          }
        });
        res.on('end', resolve);
        res.on('error', (error) => { rejectFirst(error); reject(error); });
      });
      req.on('error', (error) => { rejectFirst(error); reject(error); });
      req.end();
    });
    // Register the rejection handler immediately, even while waiting for first data.
    ended.catch(() => {});
    subtest.after(() => req.destroy());
    const snapshot = await within(first, 5000);
    assert.equal(snapshot.project.id, a.projectId);
    assert.ok(!JSON.stringify(snapshot).includes(b.leadId));
    const signedOut = await host.post('/api/auth/sign-out', {}, { cookie: a.cookie });
    assert.equal(signedOut.status, 200);
    await within(ended, 7000);
    expectError(await host.request('/api/acquisition/state', { cookie: a.cookie }), 401);
    assert.equal((await getState(b)).project.id, b.projectId);
    assert.deepEqual(host.providerCalls, []);
  });

  await t.test('API rate limits cannot be bypassed by spoofing forwarded client IPs', async (subtest) => {
    const limited = await serve({ pool });
    subtest.after(() => limited.close());
    for (let attempt = 0; attempt < 120; attempt++) {
      expectError(await limited.request('/api/acquisition/state', { headers: { 'x-forwarded-for': `192.0.2.${attempt % 250 + 1}` } }), 401);
    }
    expectError(await limited.request('/api/acquisition/state', { headers: { 'x-forwarded-for': '198.51.100.1' } }), 429);
    assert.deepEqual(limited.providerCalls, []);
  });
});
