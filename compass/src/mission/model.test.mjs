import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCESSIBILITY_TASK_ID, createMission, missionReducer } from './model.ts';

test('demo is populated immediately with the existing fictional team', () => {
  const state = createMission();
  assert.equal(state.snapshot.tasks.length, 4);
  assert.deepEqual(state.snapshot.members.map(member => member.userId), ['maya', 'leo']);
  assert.equal(state.snapshot.materials.length, 2);
  assert.equal(state.snapshot.ai.status, 'BLOCKED');
  assert.equal(state.step, 'ready');
});

test('inspection and proposal are required before approval changes the plan', () => {
  let state = createMission();
  assert.equal(missionReducer(state, { type: 'approve' }), state);
  assert.equal(missionReducer(state, { type: 'propose' }), state);
  state = missionReducer(state, { type: 'inspect' });
  assert.equal(state.step, 'inspected');
  assert.equal(missionReducer(state, { type: 'approve' }), state);
  state = missionReducer(state, { type: 'propose' });
  assert.equal(state.snapshot.tasks.length, 4);
  assert.equal(state.step, 'proposed');
  state = missionReducer(state, { type: 'approve' });
  assert.equal(state.step, 'approved');
  assert.equal(state.snapshot.tasks.length, 5);
  assert.equal(state.snapshot.tasks.at(-1).assigneeId, 'maya');
  assert.equal(state.snapshot.tasks.at(-1).status, 'todo');
});

test('repeat inspection, proposal, and approval never duplicate or regress a confirmed task', () => {
  let state = createMission();
  for (let i = 0; i < 10; i++) {
    for (const type of ['inspect', 'propose', 'approve']) state = missionReducer(state, { type });
  }
  assert.equal(state.snapshot.tasks.filter(task => task.id === ACCESSIBILITY_TASK_ID).length, 1);
  assert.equal(state.step, 'approved');
});

test('task movement is immutable, repeat safe, and preserves source evidence', () => {
  const original = createMission();
  const changed = missionReducer(original, { type: 'move', id: 't3', status: 'doing' });
  assert.equal(original.snapshot.tasks.find(task => task.id === 't3').status, 'todo');
  assert.equal(changed.snapshot.tasks.find(task => task.id === 't3').status, 'doing');
  assert.equal(changed.snapshot.tasks.find(task => task.id === 't3').version, 2);
  assert.equal(changed.snapshot.materials, original.snapshot.materials);
  assert.equal(missionReducer(changed, { type: 'move', id: 't3', status: 'doing' }), changed);
  assert.equal(missionReducer(changed, { type: 'move', id: 'missing', status: 'doing' }), changed);
  assert.equal(missionReducer(changed, { type: 'move', id: 't3', status: 'invalid' }), changed);
});

test('reset restores all original tasks and the machine gate without mutating the seed', () => {
  let state = createMission();
  for (const type of ['inspect', 'propose', 'approve']) state = missionReducer(state, { type });
  state = missionReducer(state, { type: 'move', id: 't1', status: 'todo' });
  const reset = missionReducer(state, { type: 'reset' });
  assert.deepEqual(reset.snapshot, createMission().snapshot);
  assert.equal(reset.step, 'ready');
  assert.equal(state.snapshot.tasks.length, 5);
  assert.equal(createMission().snapshot.tasks.length, 4);
});
