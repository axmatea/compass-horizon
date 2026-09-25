import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRuntime, scriptedInterpreter, DINNER_SCRIPT, T1, T2, sleep } from './helpers.mjs';

test('interruption: 8pm Palo Alto correction mid-search patches state and rescopes the action', async () => {
  const { runtime } = makeRuntime({ toolDelayMs: 200 });
  const session = runtime.createSession();
  const seen = [];
  runtime.subscribe(session.id, (e) => seen.push(e));

  const turn1 = runtime.runTurn(session.id, T1);
  await sleep(50); // search from turn 1 is now in flight
  const running = session.state.actions.filter((a) => a.status === 'running');
  assert.equal(running.length, 1, 'turn 1 search in flight');
  assert.deepEqual(running[0].args, { cuisine: 'Italian', location: null, date: 'tomorrow', time: '19:00' });

  const turn2 = runtime.runTurn(session.id, T2);
  const [r1, r2] = await Promise.all([turn1, turn2]);

  // Final state: patched, not restarted.
  assert.deepEqual(r2.state.intent, { task: 'schedule dinner', date: 'tomorrow', time: '20:00', location: 'Palo Alto', cuisine: 'Italian', party_size: null });
  assert.equal(r2.state.version, 2);
  const byField = Object.fromEntries(r2.patch.map((p) => [p.field, p]));
  assert.equal(byField.time.from, '19:00');
  assert.equal(byField.time.to, '20:00');
  assert.equal(byField.time.status, 'active');
  assert.equal(byField.location.change, 'added');
  for (const f of ['task', 'date', 'cuisine']) assert.equal(byField[f].status, 'kept');

  // Old action invalidated and aborted, exactly one replacement with new args.
  const [a1, a2] = r2.state.actions;
  assert.equal(r2.state.actions.length, 2);
  assert.equal(a1.status, 'invalidated');
  assert.deepEqual(a1.invalidatedBy.fields.sort(), ['location', 'time']);
  assert.equal(a2.status, 'done');
  assert.deepEqual(a2.args, { cuisine: 'Italian', location: 'Palo Alto', date: 'tomorrow', time: '20:00' });

  // Turn 1 does not speak a stale answer; turn 2 does.
  assert.equal(r1.superseded, true);
  assert.equal(r1.reply, null);
  assert.equal(r2.superseded, false);
  assert.equal(r2.toolResult.tool, 'mock_restaurant_search');
  assert.equal(r2.toolResult.mock, true);
  assert.equal(r2.toolResult.result.results.length, 3);
  assert.match(r2.reply, /^Moved to 8 PM\. Three Italian spots near Palo Alto for 8 PM\./);

  // Event stream is observable and ordered.
  const types = seen.map((e) => e.type);
  assert.equal(types.filter((t) => t === 'tool_call').length, 2);
  assert.equal(types.filter((t) => t === 'tool_result').length, 1, 'stale result never emitted');
  const inv = seen.find((e) => e.type === 'action_invalidated');
  assert.equal(inv.actionId, a1.id);
  assert.ok(types.indexOf('action_invalidated') < types.lastIndexOf('tool_call'), 'invalidate before re-plan');
  for (const t of ['reasoning_status', 'state_patch', 'say', 'done']) assert.ok(types.includes(t), t);
});

test('change to an unrelated field reuses the in-flight action (no re-run)', async () => {
  const { runtime } = makeRuntime({ toolDelayMs: 150 });
  const session = runtime.createSession();
  const t1 = runtime.runTurn(session.id, T1);
  await sleep(30);
  const t2 = runtime.runTurn(session.id, 'We are four people.');
  const [r1, r2] = await Promise.all([t1, t2]);
  assert.equal(r2.state.intent.party_size, 4);
  assert.equal(r2.state.actions.length, 1, 'no new action planned');
  assert.equal(r2.state.actions[0].status, 'running', 'turn 2 returned while search still in flight');
  const final = runtime.getSession(session.id).state;
  assert.equal(final.actions.length, 1);
  assert.equal(final.actions[0].status, 'done');
  assert.equal(r1.superseded, false);
  assert.ok(r1.toolResult);
});

test('re-plan reuses a completed action when args are unchanged', async () => {
  const { runtime } = makeRuntime({ toolDelayMs: 10 });
  const s = runtime.createSession();
  await runtime.runTurn(s.id, T1);
  const again = await runtime.runTurn(s.id, T1); // restating the same intent
  assert.equal(again.state.version, 1, 'no-op restatement');
  assert.equal(again.state.actions.length, 1, 'no duplicate action');
  assert.ok(again.toolResult);
});

test('interpretations are serialized per session even when the model is slow', async () => {
  const interpreter = scriptedInterpreter(DINNER_SCRIPT, { delayMs: 40 });
  const { runtime } = makeRuntime({ toolDelayMs: 20, interpreter });
  const s = runtime.createSession();
  await Promise.all([runtime.runTurn(s.id, T1), runtime.runTurn(s.id, T2)]);
  assert.deepEqual(interpreter.calls.map((c) => c.version), [0, 1], 'turn 2 saw turn 1 state');
});

test('interpreter failure leaves state unchanged and returns a fallback reply', async () => {
  const { runtime } = makeRuntime();
  const s = runtime.createSession();
  const r = await runtime.runTurn(s.id, 'mumble');
  assert.equal(r.state.version, 0);
  assert.equal(r.error, 'parse');
  assert.match(r.reply, /didn't catch/);
  assert.ok(r.events.some((e) => e.type === 'error'));
});

test('tool that needs a missing field waits instead of running', async () => {
  const interpreter = scriptedInterpreter({ 'find a place': { tool: 'mock_restaurant_search', reply: 'What cuisine?' } });
  const { runtime } = makeRuntime({ interpreter });
  const s = runtime.createSession();
  const r = await runtime.runTurn(s.id, 'find a place');
  assert.equal(r.state.actions.length, 0);
  assert.equal(r.reply, 'What cuisine?');
  assert.ok(r.events.some((e) => e.stage === 'waiting_for_fields'));
});

import { validateInterpretation, createGlmInterpreter } from '../server/agent/interpreter.mjs';

test('interpreter accepts flat model output and drops unknown keys', () => {
  const v = validateInterpretation({ task: 'schedule dinner', time: '19:00', mood: 'x' });
  assert.deepEqual(v.set, { task: 'schedule dinner', time: '19:00' });
  const w = validateInterpretation({ set: { time: '20:00' }, unset: ['bogus', 'location'], tool: 'mock_restaurant_search', reply: 'ok' });
  assert.deepEqual(w, { set: { time: '20:00' }, unset: ['location'], tool: 'mock_restaurant_search', reply: 'ok' });
});

test('interpreter retries once on a transient timeout', async () => {
  let n = 0;
  const llm = { chat: async () => { n++; if (n === 1) { const e = new Error('t'); e.code = 'timeout'; throw e; } return { message: { tool_calls: [{ function: { name: 'update_intent', arguments: '{"set":{"time":"20:00"},"unset":[],"tool":"None","reply":"ok"}' } }] }, latencyMs: 5 }; } };
  const out = await createGlmInterpreter(llm, { modes: ['required'] }).interpret({ state: { intent: {} }, text: 'x', tools: [] });
  assert.equal(n, 2);
  assert.ok(out.retried >= 1);
  assert.equal(out.set.time, '20:00');
  assert.equal(out.tool, null, '"None" string treated as no tool');
});

test('interpreter falls back from "required" to "auto" when the forced call is empty (sequential)', async () => {
  const modes = [];
  const llm = { chat: async ({ toolChoice }) => {
    modes.push(toolChoice);
    if (toolChoice === 'required') return { message: { tool_calls: [{ function: { name: 'update_intent', arguments: '{}' } }] }, latencyMs: 5 };
    return { message: { tool_calls: [{ function: { name: 'update_intent', arguments: '{"set":{"date":"next week"},"unset":[],"tool":null,"reply":"Moved to next week."}' } }] }, latencyMs: 7 };
  } };
  const out = await createGlmInterpreter(llm, { parallel: false }).interpret({ state: { intent: {} }, text: 'Can we change it for next week?', tools: [] });
  assert.deepEqual(modes, ['required', 'auto']);
  assert.equal(out.set.date, 'next week');
  assert.equal(out.latencyMs, 12);
});

test('interpreter runs modes in parallel: first meaningful wins, empty one ignored, loser aborted', async () => {
  const aborted = [];
  const llm = { chat: ({ toolChoice, signal }) => new Promise((resolve) => {
    signal?.addEventListener('abort', () => aborted.push(toolChoice));
    const ms = toolChoice === 'required' ? 10 : 40;
    const args = toolChoice === 'required' ? '{}' : '{"set":{"date":"next week"},"unset":[],"tool":null,"reply":"ok"}';
    setTimeout(() => resolve({ message: { tool_calls: [{ function: { name: 'update_intent', arguments: args } }] }, latencyMs: ms }), ms);
  }) };
  const out = await createGlmInterpreter(llm).interpret({ state: { intent: {} }, text: 'x', tools: [] });
  assert.equal(out.mode, 'auto');
  assert.equal(out.set.date, 'next week');
  const llm2 = { chat: ({ toolChoice, signal }) => new Promise((resolve, reject) => {
    signal?.addEventListener('abort', () => { aborted.push(toolChoice); reject(Object.assign(new Error('a'), { code: 'aborted' })); });
    const ms = toolChoice === 'required' ? 10 : 400;
    setTimeout(() => resolve({ message: { tool_calls: [{ function: { name: 'update_intent', arguments: '{"set":{"time":"20:00"},"unset":[],"tool":null,"reply":"ok"}' } }] }, latencyMs: ms }), ms);
  }) };
  const t0 = Date.now();
  const out2 = await createGlmInterpreter(llm2).interpret({ state: { intent: {} }, text: 'x', tools: [] });
  assert.equal(out2.mode, 'required');
  assert.ok(Date.now() - t0 < 200, 'did not wait for the slow mode');
  assert.ok(aborted.includes('auto'), 'slow mode aborted');
});
