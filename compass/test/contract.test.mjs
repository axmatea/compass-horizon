// Guards the frozen /api/turn v1 contract (COMPASS_MASTER §15) using the recorded
// live fixture that FRONTEND and VIDEO copy verbatim (§16).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FIELDS } from '../server/state/intent.mjs';

const fx = JSON.parse(readFileSync(new URL('./fixtures/dinner-turns.json', import.meta.url), 'utf8'));
const EVENT_TYPES = ['reasoning_status', 'state_patch', 'action_invalidated', 'tool_call', 'tool_result', 'say', 'error', 'done'];
const T1 = 'Schedule dinner tomorrow at 7 and find an Italian restaurant.';
const T2 = 'Actually make it 8. Somewhere near Palo Alto.';

test('fixture is the two canonical turns, recorded over HTTP with status 200', () => {
  assert.equal(fx.contract, 'COMPASS /api/turn v1');
  assert.deepEqual(fx.turns.map((t) => t.request.text), [T1, T2]);
  assert.deepEqual(fx.turns.map((t) => t.status), [200, 200]);
  assert.equal(fx.turns[0].request.sessionId, fx.turns[1].request.sessionId);
});

test('fixture response bodies match v1 top-level shape', () => {
  for (const { response: r } of fx.turns) {
    assert.deepEqual(Object.keys(r).sort(), ['events', 'patch', 'reply', 'sessionId', 'state', 'superseded', 'toolResult', 'turnId']);
    assert.deepEqual(Object.keys(r.state).sort(), ['actions', 'history', 'intent', 'sessionId', 'status', 'updatedAt', 'version']);
    assert.deepEqual(Object.keys(r.state.intent).sort(), [...FIELDS].sort());
    assert.ok(['idle', 'thinking', 'acting', 'ready', 'error'].includes(r.state.status));
    for (const p of r.patch) {
      assert.ok(FIELDS.includes(p.field));
      assert.ok(['active', 'kept'].includes(p.status));
      if (p.status === 'active') assert.ok(['added', 'updated', 'removed'].includes(p.change));
      else assert.equal('change' in p, false);
    }
    if (r.state.intent.time) assert.match(r.state.intent.time, /^\d{2}:\d{2}$/);
    for (const e of r.events) assert.ok(EVENT_TYPES.includes(e.type), e.type);
  }
});

test('after T2: task/date/cuisine KEPT, time 19:00 -> 20:00 active/updated, location null -> Palo Alto active/added', () => {
  const t2 = fx.turns[1].response;
  const by = Object.fromEntries(t2.patch.map((p) => [p.field, p]));
  assert.match(by.task.to, /dinner/);
  assert.deepEqual(by.task, { field: 'task', from: by.task.to, to: by.task.to, status: 'kept' });
  assert.deepEqual(by.date, { field: 'date', from: 'tomorrow', to: 'tomorrow', status: 'kept' });
  assert.deepEqual(by.cuisine, { field: 'cuisine', from: 'Italian', to: 'Italian', status: 'kept' });
  assert.deepEqual(by.time, { field: 'time', from: '19:00', to: '20:00', status: 'active', change: 'updated' });
  assert.deepEqual(by.location, { field: 'location', from: null, to: 'Palo Alto', status: 'active', change: 'added' });
  assert.equal(t2.state.version, 2);
  assert.deepEqual(t2.state.intent, { task: by.task.to, date: 'tomorrow', time: '20:00', location: 'Palo Alto', cuisine: 'Italian', party_size: null });
});

test('T1 is superseded; its search is invalidated and re-planned once with the new args', () => {
  const [t1, t2] = fx.turns.map((t) => t.response);
  assert.equal(t1.superseded, true);
  assert.equal(t1.reply, null);
  assert.equal(t1.toolResult, null);
  assert.equal(t2.superseded, false);
  const [old, fresh] = t2.state.actions;
  assert.equal(t2.state.actions.length, 2);
  assert.equal(old.status, 'invalidated');
  assert.deepEqual(old.invalidatedBy.fields.sort(), ['location', 'time']);
  assert.equal(fresh.status, 'done');
  assert.deepEqual(fresh.args, { cuisine: 'Italian', location: 'Palo Alto', date: 'tomorrow', time: '20:00' });
  assert.equal(t2.toolResult.mock, true);
  assert.equal(t2.toolResult.result.results.length, 3);
  const types = t2.events.map((e) => e.type);
  assert.ok(types.includes('action_invalidated'));
  assert.ok(types.indexOf('action_invalidated') < types.lastIndexOf('tool_call'));
});
