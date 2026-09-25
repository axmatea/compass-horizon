import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createRemasterBridge, validLiveSnapshot, validRuntimeEvent } from '../server/remaster-bridge.mjs';

const token = 'synthetic-runtime-token-never-real-credentials';
const owner = { tenantId: 'tenant-a', userId: 'user-a' };
function snapshot(seq = 0, runId = 'run-a') {
  return {
    schemaVersion: 1, runId, seq, executionMode: 'live', teamSource: 'simulated', day: Math.min(seq, 60), deadlineDay: 60,
    status: 'running', phase: 'working', stressTest: false, seed: 42,
    team: Array.from({ length: 6 }, (_, n) => ({ id: `person-${n}`, name: `Synthetic ${n}`, role: 'Engineer', initials: `P${n}`, color: '#123456', skills: ['testing'] })),
    tasks: [{ id: 'task-a', title: 'Synthetic task', ownerId: 'person-0', sprint: 1, startDay: 0, dueDay: 10, completedDay: null, status: 'active', dependsOn: [] }],
    facts: [{ id: 'fact-a', text: 'Synthetic availability', personId: 'person-0', learnedDay: 0, effectiveFrom: 0, effectiveTo: 60, state: 'active', source: 'synthetic test', sourceEventId: 'source-a' }],
    memoryOps: [], decisions: [], checks: [], feed: [], receipts: [], injections: [],
    metrics: { completedTasks: 0, totalTasks: 1, conflictsDetected: 0, restores: 0, protectedFacts: 1, contextTokens: null }, outcome: null,
  };
}
const event = (seq, runId = 'run-a') => ({ id: `event-${seq}`, runId, seq, simulatedDay: Math.min(seq, 60), receivedAt: '2026-09-25T12:00:00.000Z', snapshot: snapshot(seq, runId) });
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const frame = (value) => `id: ${value.seq}\nevent: state\ndata: ${JSON.stringify(value)}\n\n`;

async function harness(t, { env: overrides = {}, getIdentity = async () => owner, fetchImpl, limits } = {}) {
  const calls = [];
  const sockets = new Set();
  let bridge;
  const server = createServer(async (req, res) => {
    if (!await bridge.handle(req, res)) { res.writeHead(404); res.end(); }
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const env = { NODE_ENV: 'test', REMASTER_LIVE_ENABLED: 'true', REMASTER_RUNTIME_URL: 'https://runtime.example.test', REMASTER_RUNTIME_TOKEN: token, BETTER_AUTH_URL: origin, ...overrides };
  bridge = createRemasterBridge({
    env, getIdentity, limits,
    fetchImpl: async (url, options) => { calls.push({ url, options }); return fetchImpl ? fetchImpl(url, options) : jsonResponse({ snapshot: snapshot() }); },
  });
  t.after(async () => {
    bridge.close();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  const request = (path, { method = 'GET', body, headers = {} } = {}) => fetch(`${origin}${path}`, {
    method, headers: { ...(method === 'POST' ? { origin, 'content-type': 'application/json' } : {}), ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }), signal: AbortSignal.timeout(5000),
  });
  const post = (path, body, headers) => request(path, { method: 'POST', body, headers });
  return { bridge, env, calls, origin, request, post };
}

test('bridge factory is fail-closed and public status never verifies identity or calls upstream', async (t) => {
  for (const env of [
    { REMASTER_LIVE_ENABLED: 'false' }, { REMASTER_LIVE_ENABLED: undefined }, { REMASTER_RUNTIME_URL: '' }, { REMASTER_RUNTIME_TOKEN: '' },
    { REMASTER_RUNTIME_URL: 'https://user:pass@runtime.example.test' }, { REMASTER_RUNTIME_URL: 'https://runtime.example.test/path' },
    { REMASTER_RUNTIME_URL: 'https://runtime.example.test?secret=x' }, { REMASTER_RUNTIME_URL: 'http://runtime.example.test' },
    { REMASTER_RUNTIME_TOKEN: 'bad\nheader' }, { BETTER_AUTH_URL: undefined }, { NODE_ENV: 'production', REMASTER_RUNTIME_URL: 'http://127.0.0.1:9999', BETTER_AUTH_URL: 'https://app.example.test' },
  ]) {
    await t.test(JSON.stringify(env), async (subtest) => {
      const host = await harness(subtest, { env, getIdentity: () => assert.fail('status/blocked configuration cannot verify identity') });
      const response = await host.request('/api/remaster/status');
      assert.equal(response.status, 200);
      assert.equal((await response.json()).status, 'BLOCKED');
      assert.equal((await host.post('/api/remaster/runs', { seed: 42, stressTest: false })).status, 503);
      assert.equal(host.calls.length, 0);
    });
  }
  const host = await harness(t, { getIdentity: () => assert.fail('status must remain public') });
  assert.equal((await (await host.request('/api/remaster/status')).json()).status, 'CONFIGURED');
  assert.match(host.bridge.status().reason, /not verified/);
  assert.equal(host.calls.length, 0);
  assert.equal(await host.bridge.handle({ url: '/api/acquisition/status' }, {}), false);
  host.bridge.close();
  assert.equal(host.bridge.status().status, 'BLOCKED');
});

test('snapshot validators reject fixture data, malformed nested DTOs and mismatched events', () => {
  assert.equal(validLiveSnapshot(snapshot(), 'run-a'), true);
  assert.equal(validRuntimeEvent(event(1), 'run-a'), true);
  const mutations = [
    (s) => { s.executionMode = 'fixture'; }, (s) => { s.stressTest = true; }, (s) => { s.teamSource = 'real'; },
    (s) => { s.seq = -1; }, (s) => { s.day = 61; }, (s) => { s.extra = 'secret'; }, (s) => { s.metrics.contextTokens = 'unknown'; },
    (s) => { s.tasks[0].ownerId = 'other-person'; }, (s) => { s.tasks[0].dependsOn = ['missing']; },
    (s) => { s.facts[0].effectiveTo = -1; }, (s) => { s.metrics.totalTasks = 50; },
    (s) => { s.receipts = [{ provider: 'Synthetic', operation: 'plan', status: 'completed', at: 'not a date' }]; },
  ];
  for (const mutate of mutations) { const s = snapshot(); mutate(s); assert.equal(validLiveSnapshot(s), false); }
  assert.equal(validLiveSnapshot(snapshot(), 'run-b'), false);
  assert.equal(validRuntimeEvent({ ...event(1), seq: 2 }, 'run-a'), false);
});

test('configured bridge requires a verified session and same-origin writes', async (t) => {
  const anonymous = await harness(t, { getIdentity: async () => null });
  assert.equal((await anonymous.request('/api/remaster/runs/run-a')).status, 401);
  assert.equal((await anonymous.post('/api/remaster/runs', { seed: 42, stressTest: false })).status, 401);
  assert.equal(anonymous.calls.length, 0);
  const host = await harness(t);
  for (const origin of ['', 'null', 'https://attacker.example.test']) {
    assert.equal((await host.post('/api/remaster/runs', { seed: 42, stressTest: false }, { origin })).status, 403);
  }
  assert.equal((await host.request('/api/remaster/runs/run-a', { headers: { 'sec-fetch-site': 'same-site' } })).status, 403);
  assert.equal(host.calls.length, 0);
});

test('only fixed paths and schema-validated commands cross the server boundary', async (t) => {
  const host = await harness(t);
  const response = await host.post('/api/remaster/runs', { seed: 42, stressTest: false }, {
    cookie: 'synthetic-session', authorization: 'Bearer client-not-authority', 'x-forwarded-host': 'attacker.test', 'x-random-header': 'never-forward',
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.deepEqual(await response.json(), { snapshot: snapshot() });
  assert.equal(host.calls[0].url, 'https://runtime.example.test/api/remaster/runs');
  assert.deepEqual(host.calls[0].options.headers, {
    authorization: `Bearer ${token}`, accept: 'application/json', 'content-type': 'application/json', 'x-compass-tenant-id': owner.tenantId, 'x-compass-user-id': owner.userId,
  });
  assert.equal(host.calls[0].options.redirect, 'error');
  assert.equal(host.calls[0].options.signal.aborted, true);
  for (const input of [{ seed: 1, stressTest: true }, { seed: 1, stressTest: false, tenantId: 'tenant-b' }, { seed: 1, stressTest: false, url: 'https://attacker.test' }]) {
    assert.equal((await host.post('/api/remaster/runs', input)).status, 400);
  }
  assert.equal((await host.post('/api/remaster/runs/run-a/commands', { commandId: 'cmd-1', type: 'reset' })).status, 400);
  assert.equal((await host.post('/api/remaster/runs/run-a/commands', { commandId: 'cmd-1', type: 'pause', userId: 'user-b' })).status, 400);
  for (const path of ['/api/remaster/runs/run-a?tenantId=tenant-b', '/api/remaster/runs/run-a/events?after=-1', '/api/remaster/runs/run-a/events?after=1&after=2']) assert.equal((await host.request(path)).status, 400);
  for (const path of ['/api/remaster/admin', '/api/remaster/runs/run-a%2Fother', '/api/remaster/runs/run-a/delete']) assert.equal((await host.request(path)).status, 404);
  assert.equal((await host.request('/api/remaster/runs/run-a', { headers: { 'x-compass-tenant-id': 'tenant-b' } })).status, 400);
  assert.equal((await host.post('/api/remaster/runs', {}, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await host.post('/api/remaster/runs', 'x'.repeat(17_000))).status, 413);
  assert.equal((await host.request('/api/remaster/runs')).status, 405);
  assert.equal(host.calls.length, 1);
  assert.equal((await host.post('/api/remaster/runs/run-a/commands', { commandId: 'cmd-1', type: 'inject_event', payload: { preset: 'deadline-shift' } })).status, 200);
  assert.equal(host.calls.length, 2);
});

test('bad upstream responses and exceptions never expose credentials or runtime details', async (t) => {
  for (const fetchImpl of [
    async () => jsonResponse({ snapshot: { ...snapshot(), executionMode: 'fixture' } }),
    async () => jsonResponse({ snapshot: snapshot(0, 'run-b') }),
    async () => jsonResponse({ snapshot: snapshot(), token }),
    async () => jsonResponse({ snapshot: { ...snapshot(), outcome: { success: false, title: token, reason: 'https://runtime.example.test' } } }),
    async () => new Response(token, { status: 500 }),
    async () => new Response('x'.repeat(513 * 1024), { headers: { 'content-type': 'application/json' } }),
    async () => { throw Object.assign(new Error(`${token} https://runtime.example.test/private`), { status: 418, code: 'RAW_UPSTREAM_ERROR' }); },
  ]) {
    const host = await harness(t, { fetchImpl });
    const response = await host.request('/api/remaster/runs/run-a');
    assert.ok([502, 503].includes(response.status));
    const text = await response.text();
    assert.ok(!text.includes(token));
    assert.ok(!text.includes('runtime.example.test'));
    assert.ok(!text.includes('RAW_UPSTREAM_ERROR'));
  }
});

test('uncertain mutating requests are not retried and timed-out requests are aborted', async (t) => {
  const host = await harness(t, { fetchImpl: async () => { throw new Error('synthetic socket failure'); } });
  const response = await host.post('/api/remaster/runs/run-a/commands', { commandId: 'once-only', type: 'pause' });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'COMMAND_UNCERTAIN');
  assert.equal(host.calls.length, 1);
  const timeout = await harness(t, { limits: { requestMs: 25 }, fetchImpl: async (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) });
  assert.equal((await timeout.request('/api/remaster/runs/run-a')).status, 503);
  assert.equal(timeout.calls[0].options.signal.aborted, true);
});

test('SSE forwards only validated state, deduplicates seq, and preserves gaps for client recovery', async (t) => {
  const payload = frame(event(1)) + frame(event(1)) + frame(event(0)) + frame(event(3));
  const host = await harness(t, { fetchImpl: async () => new Response(payload, { headers: { 'content-type': 'text/event-stream' } }) });
  const response = await host.request('/api/remaster/runs/run-a/events?after=0');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-accel-buffering'), 'no');
  const output = await response.text();
  assert.equal((output.match(/event: state/g) || []).length, 2);
  assert.match(output, /id: 1\n/);
  assert.match(output, /id: 3\n/);
  assert.equal(host.calls[0].url, 'https://runtime.example.test/api/remaster/runs/run-a/events?after=0');
});

test('cross-run or invalid SSE is closed without forwarding its data', async (t) => {
  const value = event(1, 'run-b');
  value.snapshot.outcome = { success: false, title: token, reason: 'private detail' };
  const host = await harness(t, { fetchImpl: async () => new Response(frame(value), { headers: { 'content-type': 'text/event-stream' } }) });
  const response = await host.request('/api/remaster/runs/run-a/events?after=0');
  const text = await response.text();
  assert.match(text, /event: bridge-error/);
  assert.ok(!text.includes('event: state'));
  assert.ok(!text.includes(token));
  assert.equal(host.calls[0].options.signal.aborted, true);
});

test('SSE revalidates the session and cancels upstream after sign-out', async (t) => {
  let current = owner;
  let cancelled = false;
  const host = await harness(t, {
    limits: { revalidateMs: 25, streamMs: 1000 }, getIdentity: async () => current,
    fetchImpl: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(': ready\n\n')); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } }),
  });
  const response = await host.request('/api/remaster/runs/run-a/events');
  current = null;
  assert.match(await response.text(), /SESSION_REQUIRED/);
  assert.equal(cancelled, true);
  assert.equal(host.calls[0].options.signal.aborted, true);
});

test('SSE connections are bounded and client disconnect/bridge shutdown abort upstream', async (t) => {
  let cancelled = 0;
  const host = await harness(t, {
    limits: { maxStreams: 1, streamMs: 1000 },
    fetchImpl: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(': ready\n\n')); }, cancel() { cancelled++; } }), { headers: { 'content-type': 'text/event-stream' } }),
  });
  const first = await host.request('/api/remaster/runs/run-a/events');
  assert.equal((await host.request('/api/remaster/runs/run-a/events')).status, 429);
  assert.equal(host.calls.length, 1);
  await first.body.cancel();
  for (let n = 0; n < 30 && cancelled === 0; n++) await delay(10);
  assert.equal(cancelled, 1);
  const second = await host.request('/api/remaster/runs/run-a/events');
  host.bridge.close();
  await second.text();
  assert.equal(cancelled, 2);
  assert.equal(host.calls[1].options.signal.aborted, true);
});

test('maximum SSE lifetime ends a silent upstream connection', async (t) => {
  const host = await harness(t, { limits: { streamMs: 50 }, fetchImpl: async () => new Response(new ReadableStream(), { headers: { 'content-type': 'text/event-stream' } }) });
  const response = await host.request('/api/remaster/runs/run-a/events');
  assert.equal(await response.text(), '');
  assert.equal(host.calls[0].options.signal.aborted, true);
});
