import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { LiveTransport, parseLiveSnapshot, parseRuntimeEvent } from './live.ts';

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
const runtimeEvent = (seq, runId = 'run-a') => ({ id: `event-${seq}`, runId, seq, simulatedDay: Math.min(seq, 60), receivedAt: '2026-09-25T12:00:00.000Z', snapshot: snapshot(seq, runId) });
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

class Source extends EventTarget {
  constructor(url, options) { super(); this.url = url; this.options = options; this.closed = false; }
  close() { this.closed = true; }
  send(type, data, lastEventId = '') {
    this.dispatchEvent(new MessageEvent(type, { data: typeof data === 'string' ? data : JSON.stringify(data), lastEventId }));
  }
  state(seq, runId = 'run-a') { this.send('state', runtimeEvent(seq, runId), String(seq)); }
}
function clock() {
  const pending = new Map();
  let next = 0;
  return {
    pending,
    setTimeoutImpl(fn, ms) { const id = ++next; pending.set(id, { fn, ms }); return id; },
    clearTimeoutImpl(id) { pending.delete(id); },
    runNext() {
      const item = [...pending.entries()].sort((a, b) => a[1].ms - b[1].ms)[0];
      assert.ok(item, 'expected a scheduled reconnect');
      pending.delete(item[0]); item[1].fn();
    },
  };
}
function harness(t, custom = {}) {
  const timers = clock();
  const calls = [];
  const sources = [];
  const updates = [];
  const transport = new LiveTransport({
    ...timers, reconnectDelayMs: 5, maxReconnectAttempts: 2,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (custom.fetchImpl) return custom.fetchImpl(url, options);
      return response(url.endsWith('/status') ? { status: 'CONFIGURED', reason: 'Synthetic test only' } : { snapshot: snapshot() });
    },
    eventSourceFactory: (url, options) => { const source = new Source(url, options); sources.push(source); return source; },
    ...(custom.signal ? { signal: custom.signal } : {}),
  });
  transport.subscribe((update) => updates.push(update));
  t.after(() => transport.dispose());
  return { transport, calls, sources, updates, timers };
}
async function settled(predicate) {
  for (let n = 0; n < 50 && !predicate(); n++) await turn();
  assert.ok(predicate(), 'asynchronous transport work did not settle');
}
const start = (transport) => transport.start({ seed: 42, stressTest: true });

test('live constructor and subscribe perform no requests; start is explicit and disables stress mode', async (t) => {
  const h = harness(t);
  assert.equal(h.transport.getSnapshot(), null);
  assert.equal(h.calls.length, 0);
  assert.equal(h.sources.length, 0);
  await assert.rejects(h.transport.command({ commandId: 'before-start', type: 'pause' }), { code: 'NO_RUN' });
  await start(h.transport);
  assert.deepEqual(h.calls.map((call) => call.url), ['/api/remaster/status', '/api/remaster/runs']);
  assert.deepEqual(JSON.parse(h.calls[1].options.body), { seed: 42, stressTest: false });
  assert.equal(h.calls[1].options.credentials, 'same-origin');
  assert.equal(h.sources[0].url, '/api/remaster/runs/run-a/events?after=0');
  assert.deepEqual(h.sources[0].options, { withCredentials: true });
  h.sources[0].send('open', '');
  assert.equal(h.updates.at(-1).status, 'connected');
  assert.equal(h.transport.getSnapshot().executionMode, 'live');
  assert.equal(h.transport.advanceTime, undefined);
});

test('strict validation covers nested DTOs, references, enums, metrics and cross-run identity', () => {
  assert.deepEqual(parseLiveSnapshot(snapshot()), snapshot());
  assert.deepEqual(parseRuntimeEvent(runtimeEvent(1), 'run-a'), runtimeEvent(1));
  const mutations = [
    (s) => { s.executionMode = 'fixture'; }, (s) => { s.stressTest = true; }, (s) => { s.teamSource = 'real'; },
    (s) => { s.schemaVersion = 2; }, (s) => { s.seq = NaN; }, (s) => { s.seq = '1'; }, (s) => { s.day = 61; },
    (s) => { s.team.pop(); }, (s) => { s.team[1].id = s.team[0].id; }, (s) => { s.tasks[0].ownerId = 'not-on-team'; },
    (s) => { s.tasks[0].dependsOn = ['task-a']; }, (s) => { s.metrics.totalTasks = 200; }, (s) => { s.metrics.contextTokens = -1; },
    (s) => { s.memoryOps = [{ id: 'op-a', day: 0, op: 'archive', factIds: ['missing'], why: 'Synthetic' }]; },
    (s) => { s.receipts = [{ provider: 'Synthetic', operation: 'plan', status: 'success', at: 'yesterday' }]; },
    (s) => { s.privateToken = 'must-not-be-part-of-DTO'; }, (s) => { s.tasks[0].unknown = true; },
  ];
  for (const mutate of mutations) { const value = snapshot(); mutate(value); assert.throws(() => parseLiveSnapshot(value), { code: 'INVALID_RUNTIME_STATE' }); }
  assert.throws(() => parseLiveSnapshot(snapshot(), 'run-b'));
  assert.throws(() => parseRuntimeEvent(runtimeEvent(1, 'run-b'), 'run-a'));
  assert.throws(() => parseRuntimeEvent({ ...runtimeEvent(1), seq: 2 }, 'run-a'));
});

test('blocked configuration never creates a run or falls back to fixtures', async (t) => {
  const h = harness(t, { fetchImpl: async () => response({ status: 'BLOCKED', reason: 'Not configured' }) });
  await assert.rejects(start(h.transport), /blocked/);
  assert.equal(h.calls.length, 1);
  assert.equal(h.transport.getSnapshot(), null);
  assert.equal(h.sources.length, 0);
  assert.equal(h.updates.at(-1).status, 'blocked');
});

test('duplicate/older SSE sequences are ignored and consumer mutations cannot alter authority', async (t) => {
  const h = harness(t);
  await start(h.transport);
  h.transport.subscribe(() => { throw new Error('Synthetic UI listener error'); });
  const source = h.sources[0];
  source.state(1); source.state(1); source.state(0);
  assert.deepEqual(h.updates.filter((update) => update.kind === 'state').map((update) => update.snapshot.seq), [0, 1]);
  const clone = h.transport.getSnapshot();
  clone.seq = 900;
  clone.team[0].name = 'tampered';
  assert.equal(h.transport.getSnapshot().seq, 1);
  assert.notEqual(h.transport.getSnapshot().team[0].name, 'tampered');
  assert.equal(h.calls.length, 2);
});

test('cross-run and fixture-labelled SSE close the stream without applying state', async (t) => {
  for (const value of [runtimeEvent(1, 'run-b'), { ...runtimeEvent(1), snapshot: { ...snapshot(1), executionMode: 'fixture' } }]) {
    const h = harness(t);
    await start(h.transport);
    h.sources[0].send('state', value, '1');
    assert.equal(h.transport.getSnapshot().seq, 0);
    assert.equal(h.sources[0].closed, true);
    assert.equal(h.updates.at(-1).status, 'blocked');
    assert.equal(h.calls.length, 2);
  }
});

test('sequence gaps refetch authoritative state before reopening with the recovered cursor', async (t) => {
  const recovered = snapshot(4);
  recovered.team[0].name = 'Authoritative refetch';
  const h = harness(t, { fetchImpl: async (url) => response(url.endsWith('/status') ? { status: 'CONFIGURED', reason: 'Synthetic' } : { snapshot: url.endsWith('/run-a') ? recovered : snapshot() }) });
  await start(h.transport);
  h.sources[0].state(4);
  await settled(() => h.sources.length === 2);
  assert.equal(h.sources[0].closed, true);
  assert.equal(h.calls[2].options.method, 'GET');
  assert.equal(h.calls[2].url, '/api/remaster/runs/run-a');
  assert.equal(h.transport.getSnapshot().team[0].name, 'Authoritative refetch');
  assert.equal(h.sources[1].url, '/api/remaster/runs/run-a/events?after=4');
  assert.deepEqual(h.updates.filter((update) => update.kind === 'state').map((update) => update.snapshot.seq), [0, 4]);
});

test('reconnect closes native auto-retry and performs a GET before opening another SSE', async (t) => {
  const h = harness(t, { fetchImpl: async (url) => response(url.endsWith('/status') ? { status: 'CONFIGURED', reason: 'Synthetic' } : { snapshot: snapshot(url.endsWith('/run-a') ? 2 : 0) }) });
  await start(h.transport);
  h.sources[0].send('error', '');
  assert.equal(h.sources[0].closed, true);
  assert.equal(h.updates.at(-1).status, 'reconnecting');
  h.timers.runNext();
  await settled(() => h.sources.length === 2);
  assert.equal(h.calls.at(-1).options.method, 'GET');
  assert.equal(h.sources[1].url, '/api/remaster/runs/run-a/events?after=2');
  assert.equal(h.calls.filter((call) => call.options.method === 'POST').length, 1);
});

test('failed read-only reconnects have bounded retries, never repeat POST, and eventually block', async (t) => {
  const h = harness(t, { fetchImpl: async (url) => {
    if (url.endsWith('/run-a')) throw new Error('synthetic read failure');
    return response(url.endsWith('/status') ? { status: 'CONFIGURED', reason: 'Synthetic' } : { snapshot: snapshot() });
  } });
  await start(h.transport);
  h.sources[0].send('error', '');
  h.timers.runNext();
  await settled(() => h.calls.length === 3 && [...h.timers.pending.values()].some((timer) => timer.ms === 10));
  h.timers.runNext();
  await settled(() => h.updates.at(-1).status === 'blocked');
  assert.equal(h.calls.length, 4);
  assert.equal(h.timers.pending.size, 0);
  assert.equal(h.calls.filter((call) => call.options.method === 'POST').length, 1);
});

test('uncertain command is sent exactly once, refetches state, reports uncertainty, and blocks duplicate IDs', async (t) => {
  const h = harness(t, { fetchImpl: async (url) => {
    if (url.endsWith('/commands')) throw new Error('synthetic ambiguous connection failure');
    return response(url.endsWith('/status') ? { status: 'CONFIGURED', reason: 'Synthetic' } : { snapshot: snapshot(url.endsWith('/run-a') ? 2 : 0) });
  } });
  await start(h.transport);
  const command = { commandId: 'one-command', type: 'pause' };
  await assert.rejects(h.transport.command(command), { code: 'COMMAND_UNCERTAIN' });
  assert.equal(h.transport.getSnapshot().seq, 2);
  assert.equal(h.calls.filter((call) => call.url.endsWith('/commands')).length, 1);
  assert.equal(h.calls.at(-1).options.method, 'GET');
  assert.match(h.updates.at(-1).message, /refetched; no retry/);
  assert.equal(h.updates.at(-1).status, 'blocked');
  await assert.rejects(h.transport.command(command), { code: 'COMMAND_ALREADY_SENT' });
  assert.equal(h.calls.length, 4);
});

test('failed command recovery retains only known state and does not invent a mutation', async (t) => {
  const h = harness(t, { fetchImpl: async (url) => {
    if (url.endsWith('/commands') || url.endsWith('/run-a')) return response({ error: 'private upstream detail' }, 503);
    return response(url.endsWith('/status') ? { status: 'CONFIGURED', reason: 'Synthetic' } : { snapshot: snapshot() });
  } });
  await start(h.transport);
  await assert.rejects(h.transport.command({ commandId: 'one-command', type: 'pause' }), /could not be refetched/);
  assert.equal(h.transport.getSnapshot().seq, 0);
  assert.equal(h.transport.getSnapshot().status, 'running');
  assert.equal(h.timers.pending.size, 0);
  assert.ok(h.sources.every((source) => source.closed));
  assert.ok(!h.updates.at(-1).message.includes('private upstream detail'));
});

test('uncertain creation never retries a mutating POST or invents a recoverable run ID', async (t) => {
  const h = harness(t, { fetchImpl: async (url) => {
    if (!url.endsWith('/status')) throw new Error('synthetic creation timeout');
    return response({ status: 'CONFIGURED', reason: 'Synthetic' });
  } });
  await assert.rejects(start(h.transport), { code: 'START_UNCERTAIN' });
  assert.equal(h.calls.length, 2);
  assert.equal(h.transport.getSnapshot(), null);
  assert.equal(h.sources.length, 0);
  assert.equal(h.timers.pending.size, 0);
});

test('session termination from the bridge closes events and does not reconnect', async (t) => {
  const h = harness(t);
  await start(h.transport);
  h.sources[0].send('bridge-error', { code: 'SESSION_REQUIRED' });
  assert.equal(h.sources[0].closed, true);
  assert.equal(h.updates.at(-1).status, 'blocked');
  assert.equal(h.timers.pending.size, 0);
});

test('dispose cancels reconnect timers and removes listeners from closed sources', async (t) => {
  const h = harness(t);
  await start(h.transport);
  h.sources[0].send('error', '');
  assert.equal(h.timers.pending.size, 1);
  h.transport.dispose();
  h.transport.dispose();
  assert.equal(h.timers.pending.size, 0);
  const count = h.updates.length;
  h.sources[0].state(1);
  assert.equal(h.updates.length, count);
  assert.equal(h.sources[0].closed, true);
  await assert.rejects(start(h.transport), { code: 'DISPOSED' });
});

test('external abort cancels pending fetch, clears timers, and ignores late work', async (t) => {
  const controller = new AbortController();
  let pendingSignal;
  const h = harness(t, { signal: controller.signal, fetchImpl: async (url, options) => {
    if (url.endsWith('/status')) return response({ status: 'CONFIGURED', reason: 'Synthetic' });
    pendingSignal = options.signal;
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  } });
  const work = start(h.transport);
  const rejected = assert.rejects(work);
  await settled(() => pendingSignal !== undefined);
  const updates = h.updates.length;
  controller.abort();
  await rejected;
  assert.equal(pendingSignal.aborted, true);
  assert.equal(h.updates.length, updates);
  assert.equal(h.timers.pending.size, 0);
  assert.equal(h.sources.length, 0);
});
