import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createCompassBackend } from '../server/app.mjs';
import { createToolRegistry } from '../server/tools/registry.mjs';
import { createMockRestaurantSearch } from '../server/tools/mock-restaurant-search.mjs';
import { scriptedInterpreter, DINNER_SCRIPT, T1, T2, sleep } from './helpers.mjs';

const FAKE_KEY = 'nb-test-SECRET-should-never-appear';
let server, base;

before(async () => {
  const backend = createCompassBackend({
    env: { NEBIUS_API_KEY: FAKE_KEY, BOSON_API_KEY: 'boson-SECRET-never' },
    interpreter: scriptedInterpreter(DINNER_SCRIPT),
    tools: createToolRegistry([createMockRestaurantSearch({ delayMs: 200 })]),
    logger: { error() {} },
  });
  server = createServer((req, res) => backend.handleApi(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('health exposes presence flags only, never secrets', async () => {
  const res = await fetch(`${base}/api/health`);
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.ok(!text.includes('SECRET'));
  const j = JSON.parse(text);
  assert.equal(j.nebius.configured, true);
  assert.equal(j.boson.configured, true);
  assert.equal(j.voiceRequested, 'auto');
  assert.equal(j.voice.provider, 'boson'); // no GRADIUM_API_KEY in this test env
  assert.equal(j.llm.configured, true);
});

test('voice providers: boson active when key configured, browser is fallback', async () => {
  const j = await (await fetch(`${base}/api/voice/providers`)).json();
  assert.equal(j.active, 'boson');
  assert.equal(j.fallback, 'browser');
  const boson = j.providers.find((p) => p.name === 'boson');
  assert.equal(boson.verifiedContract, true);
  assert.equal(boson.liveVerified, false);
  assert.ok(!JSON.stringify(j).includes('SECRET'));
  assert.equal((await post('/api/voice/tts', { text: 'hi' })).status, 501);
});

test('POST /api/turn JSON contract + interruption over HTTP', async () => {
  const { sessionId } = await (await post('/api/session', {})).json();
  const p1 = post('/api/turn', { sessionId, text: T1 }).then((r) => r.json());
  await sleep(60);
  const p2 = post('/api/turn', { sessionId, text: T2 }).then((r) => r.json());
  const [r1, r2] = await Promise.all([p1, p2]);

  for (const k of ['sessionId', 'state', 'patch', 'reply', 'toolResult']) assert.ok(k in r2, `contract key ${k}`);
  assert.equal(r2.sessionId, sessionId);
  assert.equal(r1.superseded, true);
  assert.equal(r2.state.intent.time, '20:00');
  assert.equal(r2.state.intent.location, 'Palo Alto');
  assert.equal(r2.state.intent.cuisine, 'Italian');
  assert.deepEqual(r2.patch.find((p) => p.field === 'time'), { field: 'time', from: '19:00', to: '20:00', status: 'active', change: 'updated' });
  assert.equal(r2.toolResult.result.query.location, 'Palo Alto');
  assert.ok(r2.events.some((e) => e.type === 'action_invalidated'), 'invalidation visible in turn 2 events');

  const s = await (await fetch(`${base}/api/session/${sessionId}`)).json();
  assert.equal(s.state.version, 2);
});

test('POST /api/turn streams SSE events then a result', async () => {
  const res = await post('/api/turn', { text: T1 }, { Accept: 'text/event-stream' });
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const raw = await res.text();
  const events = raw.split('\n\n').map((b) => /^event: (\S+)\ndata: (.*)$/m.exec(b)).filter(Boolean).map((m) => ({ type: m[1], data: JSON.parse(m[2]) }));
  const types = events.map((e) => e.type);
  for (const t of ['reasoning_status', 'state_patch', 'tool_call', 'say', 'tool_result', 'done', 'result']) assert.ok(types.includes(t), t);
  assert.equal(types.at(-1), 'result');
  assert.equal(events.at(-1).data.state.intent.time, '19:00');
});

test('session events stream sees events from all turns', async () => {
  const { sessionId } = await (await post('/api/session', {})).json();
  const ac = new AbortController();
  const res = await fetch(`${base}/api/session/${sessionId}/events`, { signal: ac.signal });
  const reader = res.body.getReader();
  let buf = '';
  const turn = post('/api/turn', { sessionId, text: T1 });
  const deadline = Date.now() + 2000;
  while (!buf.includes('event: tool_result') && Date.now() < deadline) buf += new TextDecoder().decode((await reader.read()).value);
  await turn;
  ac.abort();
  assert.ok(buf.includes('event: state'));
  assert.ok(buf.includes('event: state_patch'));
  assert.ok(buf.includes('event: tool_result'));
});

test('input validation', async () => {
  assert.equal((await post('/api/turn', { text: '' })).status, 400);
  assert.equal((await post('/api/turn', { text: 'x'.repeat(501) })).status, 400);
  assert.equal((await fetch(`${base}/api/turn`, { method: 'POST', body: 'hi' })).status, 415);
  assert.equal((await fetch(`${base}/api/session/nope`)).status, 404);
  assert.equal((await fetch(`${base}/api/unknown`)).status, 404);
  const r = await (await post('/api/turn', { sessionId: 'bad id!', text: T1 })).json();
  assert.notEqual(r.sessionId, 'bad id!', 'invalid session ids are replaced');
});

test('missing Nebius key returns 503 with fallback reply', async () => {
  const b = createCompassBackend({ env: {}, logger: { error() {} } });
  const srv = createServer((req, res) => b.handleApi(req, res));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/turn`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: T1 }) });
  srv.close();
  assert.equal(res.status, 503);
  assert.match((await res.json()).reply, /didn't catch/);
});

test('F1: unknown sessionId -> fresh session with sessionReset:true (JSON and SSE)', async () => {
  const r = await (await post('/api/turn', { sessionId: 's_deadbeef', text: T1 })).json();
  assert.equal(r.sessionReset, true);
  assert.notEqual(r.sessionId, 's_deadbeef');
  assert.equal(r.state.version, 1);
  const again = await (await post('/api/turn', { sessionId: r.sessionId, text: T2 })).json();
  assert.equal('sessionReset' in again, false, 'known session: no flag');
  assert.equal(again.state.intent.time, '20:00');
  const fresh = await (await post('/api/turn', { text: T1 })).json();
  assert.equal('sessionReset' in fresh, false, 'no sessionId sent: new session is not a reset');
  const sse = await (await post('/api/turn', { sessionId: 'gone', text: T1 }, { Accept: 'text/event-stream' })).text();
  assert.match(sse, /^event: session_reset$/m);
  const result = JSON.parse(/event: result\ndata: (.*)/.exec(sse)[1]);
  assert.equal(result.sessionReset, true);
});
