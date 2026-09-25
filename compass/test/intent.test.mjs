import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, applyUpdate, addAction, updateAction, invalidateActions, findReusableAction, normalizeTime, normalizeLocation } from '../server/state/intent.mjs';

test('normalizeTime handles spoken and model formats', () => {
  assert.equal(normalizeTime('7', { task: 'schedule dinner' }), '19:00');
  assert.equal(normalizeTime('8', { task: 'schedule dinner' }), '20:00');
  assert.equal(normalizeTime('8:00 PM'), '20:00');
  assert.equal(normalizeTime('8 p.m.'), '20:00');
  assert.equal(normalizeTime('20:00'), '20:00');
  assert.equal(normalizeTime('7', { task: 'coffee' }), '07:00');
  assert.equal(normalizeTime('12 am'), '00:00');
  // explicit zero-padded 24h is never shifted to PM ("8 in the morning" for a dinner)
  assert.equal(normalizeTime('08:00', { task: 'schedule dinner' }), '08:00');
  assert.equal(normalizeTime('7:30', { task: 'schedule dinner' }), '19:30');
  assert.equal(normalizeTime('soonish'), null);
  assert.equal(normalizeTime('25:00'), null);
});

test('normalizeLocation strips filler the model adds', () => {
  assert.equal(normalizeLocation('Palo Alto, CA (nearby area)'), 'Palo Alto');
  assert.equal(normalizeLocation('somewhere near Palo Alto'), 'Palo Alto');
  assert.equal(normalizeLocation('  '), null);
});

// Canonical COMPASS scenario (COMPASS_MASTER section 1).
test('mutable intent: 7pm Italian -> "make it 8, near Palo Alto" patches, not restarts', () => {
  let s = createState('s1');

  // Turn 1: "Schedule dinner tomorrow at 7 and find an Italian restaurant."
  const t1 = applyUpdate(s, { set: { task: 'Schedule dinner', date: 'tomorrow', time: '7', cuisine: 'italian' } }, { turnId: 't1' });
  s = t1.state;
  assert.deepEqual(s.intent, { task: 'schedule dinner', date: 'tomorrow', time: '19:00', location: null, cuisine: 'Italian', party_size: null });
  assert.equal(s.version, 1);

  // An in-flight search depends on cuisine/location/date/time; an unrelated action depends only on task.
  s = addAction(s, { id: 'a1', tool: 'search', args: { cuisine: 'Italian', location: null, time: '19:00' }, dependsOn: ['cuisine', 'location', 'date', 'time'] });
  s = updateAction(s, 'a1', { status: 'running' });
  s = addAction(s, { id: 'a2', tool: 'note', args: { task: 'schedule dinner' }, dependsOn: ['task'] });
  s = updateAction(s, 'a2', { status: 'done', result: { ok: true } });

  // Turn 2: "Actually make it 8. Somewhere near Palo Alto." Model sends only changed fields.
  const t2 = applyUpdate(s, { set: { time: '8', location: 'somewhere near Palo Alto' } }, { turnId: 't2' });
  s = t2.state;
  assert.deepEqual(s.intent, { task: 'schedule dinner', date: 'tomorrow', time: '20:00', location: 'Palo Alto', cuisine: 'Italian', party_size: null });
  assert.equal(s.version, 2, 'version increments');
  assert.deepEqual(t2.changed.sort(), ['location', 'time']);

  const byField = Object.fromEntries(t2.patch.map((p) => [p.field, p]));
  assert.deepEqual(byField.time, { field: 'time', from: '19:00', to: '20:00', status: 'active', change: 'updated' });
  assert.deepEqual(byField.location, { field: 'location', from: null, to: 'Palo Alto', status: 'active', change: 'added' });
  for (const f of ['task', 'date', 'cuisine']) assert.equal(byField[f].status, 'kept', `${f} kept`);

  const inv = invalidateActions(s, t2.changed);
  s = inv.state;
  assert.deepEqual(inv.invalidated.map((i) => i.id), ['a1'], 'only the dependent action is invalidated');
  assert.equal(s.actions.find((a) => a.id === 'a1').status, 'invalidated');
  assert.equal(s.actions.find((a) => a.id === 'a2').status, 'done', 'unaffected action survives');
  assert.equal(findReusableAction(s, 'note', { task: 'schedule dinner' })?.id, 'a2');
  assert.equal(findReusableAction(s, 'search', { cuisine: 'Italian', location: null, time: '19:00' }), null);
});

test('restating an unchanged value is a no-op (no version bump, no invalidation)', () => {
  let s = applyUpdate(createState('s'), { set: { task: 'schedule dinner', time: '19:00' } }).state;
  const r = applyUpdate(s, { set: { time: '7 pm' } });
  assert.equal(r.changed.length, 0);
  assert.equal(r.state.version, s.version);
});

test('explicit cuisine change is applied; unknown fields and bad values rejected', () => {
  let s = applyUpdate(createState('s'), { set: { task: 'schedule dinner', cuisine: 'Italian' } }).state;
  const r = applyUpdate(s, { set: { cuisine: 'sushi', mood: 'fancy', time: 'whenever' } });
  assert.equal(r.state.intent.cuisine, 'Sushi');
  assert.deepEqual(r.rejected.map((x) => x.field).sort(), ['mood', 'time']);
  assert.equal(r.state.intent.time, null);
});

test('unset removes a field', () => {
  let s = applyUpdate(createState('s'), { set: { location: 'Palo Alto' } }).state;
  const r = applyUpdate(s, { unset: ['location'] });
  assert.equal(r.state.intent.location, null);
  assert.deepEqual(r.patch.find((p) => p.field === 'location'), { field: 'location', from: 'Palo Alto', to: null, status: 'active', change: 'removed' });
  assert.deepEqual(r.changed, ['location']);
});

test('applyUpdate is pure', () => {
  const s = createState('s');
  const snapshot = structuredClone(s);
  applyUpdate(s, { set: { task: 'x' } });
  assert.deepEqual(s, snapshot);
});
