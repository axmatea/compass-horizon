import test from 'node:test';
import assert from 'node:assert/strict';
import { FixtureTransport } from './fixture.ts';

const DAY = 2_000;
const LEAVE_ID = 'fact-sarah-availability';
const leave = snapshot => snapshot.facts.find(fact => fact.id === LEAVE_ID);
const visuals = snapshot => snapshot.tasks.find(task => task.id === 'launch-visuals');
const safeVisuals = snapshot => visuals(snapshot).ownerId === 'max' || visuals(snapshot).dueDay < 41;
const inject = (fixture, preset, commandId = preset) => fixture.command({ commandId, type: 'inject_event', payload: { preset } });
async function running(stressTest = false, seed = 42) {
  const fixture = new FixtureTransport({ autoTick: false });
  await fixture.start({ seed, stressTest });
  return fixture;
}

test('idle snapshot is immediately playable, typed, and explicitly a synthetic fixture', () => {
  const fixture = new FixtureTransport({ autoTick: false });
  const state = fixture.getSnapshot();
  assert.equal(state.status, 'idle');
  assert.equal(state.day, 0);
  assert.equal(state.seq, 0);
  assert.equal(state.deadlineDay, 60);
  assert.equal(state.phase, 'planning');
  assert.equal(state.seed, 42);
  assert.equal(state.executionMode, 'fixture');
  assert.equal(state.teamSource, 'simulated');
  assert.equal(state.team.length, 6);
  assert.equal(new Set(state.team.map(person => person.id)).size, 6);
  assert.equal(state.tasks.length, 12);
  assert.deepEqual([...new Set(state.tasks.map(task => task.sprint))], [1, 2, 3, 4, 5, 6]);
  assert.ok(state.tasks.every(task => task.status === 'planned' && task.completedDay === null));
  assert.ok(state.tasks.every(task => state.team.some(person => person.id === task.ownerId)));
  assert.ok(state.tasks.every(task => task.dependsOn.every(id => state.tasks.some(candidate => candidate.id === id))));
  assert.equal(state.metrics.contextTokens, null);
  assert.deepEqual(state.receipts, []);
  assert.equal(state.outcome, null);
  assert.deepEqual(state.facts, []);
});

test('subscribe immediately supplies idle state and unsubscribe stops subsequent updates', async () => {
  const fixture = new FixtureTransport({ autoTick: false });
  const updates = [];
  const unsubscribe = fixture.subscribe(update => updates.push(update));
  assert.equal(updates.length, 1);
  assert.equal(updates[0].kind, 'state');
  assert.equal(updates[0].snapshot.status, 'idle');
  await fixture.start({ seed: 42, stressTest: false });
  assert.equal(updates.at(-1).snapshot.status, 'running');
  unsubscribe();
  fixture.advanceTime(DAY);
  assert.equal(updates.length, 2);
});

test('manual clock advances exactly one working day per 2 seconds, including fractional steps', async () => {
  const fixture = await running();
  fixture.advanceTime(0);
  fixture.advanceTime(1_999.5);
  assert.equal(fixture.getSnapshot().day, 0);
  fixture.advanceTime(0.5);
  assert.equal(fixture.getSnapshot().day, 1);
  assert.equal(fixture.getSnapshot().tasks[0].status, 'active');
  fixture.advanceTime(DAY * 3);
  assert.equal(fixture.getSnapshot().day, 4);
  assert.equal(fixture.getSnapshot().tasks[0].completedDay, 4);
  assert.equal(fixture.getSnapshot().tasks[1].completedDay, null);
});

test('invalid time and run options are rejected without changing the active snapshot', async () => {
  const fixture = await running();
  fixture.advanceTime(DAY);
  const before = fixture.getSnapshot();
  for (const ms of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2000']) {
    assert.throws(() => fixture.advanceTime(ms), /Invalid fixture elapsed time/);
    assert.deepEqual(fixture.getSnapshot(), before);
  }
  for (const options of [null, {}, { seed: -1, stressTest: false }, { seed: 0.5, stressTest: false }, { seed: 2 ** 32, stressTest: false }, { seed: 42, stressTest: 'false' }]) {
    await assert.rejects(fixture.start(options));
    assert.deepEqual(fixture.getSnapshot(), before);
  }
});

test('pause freezes days, work, feed and fractional clock, and resume continues without catch-up', async () => {
  const fixture = await running();
  fixture.advanceTime(750);
  await fixture.command({ commandId: 'pause', type: 'pause' });
  const paused = fixture.getSnapshot();
  fixture.advanceTime(180_000);
  assert.deepEqual(fixture.getSnapshot(), paused);
  await fixture.command({ commandId: 'resume', type: 'resume' });
  fixture.advanceTime(1_249);
  assert.equal(fixture.getSnapshot().day, 0);
  fixture.advanceTime(1);
  assert.equal(fixture.getSnapshot().day, 1);
});

test('a listener can pause a large manual advance without banking the unused time', async () => {
  const fixture = await running();
  fixture.subscribe(update => {
    if (update.snapshot.day === 2 && update.snapshot.status === 'running') void fixture.command({ commandId: 'pause-at-2', type: 'pause' });
  });
  fixture.advanceTime(180_000);
  assert.equal(fixture.getSnapshot().day, 2);
  assert.equal(fixture.getSnapshot().status, 'paused');
  await fixture.command({ commandId: 'resume-at-2', type: 'resume' });
  fixture.advanceTime(1_999);
  assert.equal(fixture.getSnapshot().day, 2);
  fixture.advanceTime(1);
  assert.equal(fixture.getSnapshot().day, 3);
});

test('automatic clock runs at 2 seconds/day and stops for pause, completion and disposal', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const fixture = new FixtureTransport();
  t.after(() => fixture.dispose());
  await fixture.start({ seed: 42, stressTest: false });
  t.mock.timers.tick(2_000);
  assert.equal(fixture.getSnapshot().day, 1);
  await fixture.command({ commandId: 'pause', type: 'pause' });
  const paused = fixture.getSnapshot();
  t.mock.timers.tick(20_000);
  assert.deepEqual(fixture.getSnapshot(), paused);
  await fixture.command({ commandId: 'resume', type: 'resume' });
  t.mock.timers.tick(2_000);
  assert.equal(fixture.getSnapshot().day, 2);
  t.mock.timers.tick(180_000);
  const completed = fixture.getSnapshot();
  assert.equal(completed.status, 'completed');
  assert.equal(completed.day, 60);
  t.mock.timers.tick(180_000);
  assert.deepEqual(fixture.getSnapshot(), completed);
  await fixture.start({ seed: 42, stressTest: true });
  fixture.dispose();
  const disposed = fixture.getSnapshot();
  t.mock.timers.tick(180_000);
  assert.deepEqual(fixture.getSnapshot(), disposed);
});

test('autoTick false never schedules a timer and dispose is terminal but leaves readable evidence', async t => {
  const timer = t.mock.method(globalThis, 'setInterval', () => { throw new Error('Unexpected timer'); });
  const fixture = await running();
  let emissions = 0;
  fixture.subscribe(() => emissions++);
  fixture.advanceTime(DAY * 7);
  fixture.dispose();
  fixture.dispose();
  const state = fixture.getSnapshot();
  const count = emissions;
  fixture.advanceTime(180_000);
  fixture.subscribe(() => emissions++);
  assert.equal(emissions, count);
  assert.deepEqual(fixture.getSnapshot(), state);
  await assert.rejects(fixture.start({ seed: 42, stressTest: false }), /disposed/);
  await assert.rejects(inject(fixture, 'sarah-leave'), /disposed/);
  assert.equal(timer.mock.callCount(), 0);
});

test('restart gets a new run ID and clears clock, facts, receipts, outcome and command history', async () => {
  const fixture = await running(true);
  await inject(fixture, 'deadline-shift', 'reusable');
  fixture.advanceTime(180_000);
  const old = fixture.getSnapshot();
  assert.equal(old.outcome.success, false);
  await fixture.start({ seed: 42, stressTest: false });
  const fresh = fixture.getSnapshot();
  assert.notEqual(fresh.runId, old.runId);
  assert.equal(fresh.seq, 1);
  assert.equal(fresh.day, 0);
  assert.equal(fresh.deadlineDay, 60);
  assert.equal(fresh.status, 'running');
  assert.equal(fresh.outcome, null);
  for (const key of ['facts', 'checks', 'decisions', 'memoryOps', 'injections', 'receipts']) assert.deepEqual(fresh[key], []);
  assert.ok(fresh.tasks.every(task => task.completedDay === null));
  assert.equal(fresh.metrics.restores, 0);
  await inject(fixture, 'sarah-leave', 'reusable');
  assert.equal(fixture.getSnapshot().facts.length, 1);
  fixture.advanceTime(1_999);
  assert.equal(fixture.getSnapshot().day, 0);
});

test('restart while paused clears a partial day and resumes the new run from day zero', async () => {
  const fixture = await running();
  fixture.advanceTime(1_900);
  await fixture.command({ commandId: 'pause', type: 'pause' });
  await fixture.start({ seed: 42, stressTest: false });
  fixture.advanceTime(100);
  assert.equal(fixture.getSnapshot().day, 0);
  assert.equal(fixture.getSnapshot().status, 'running');
});

test('exact command retries have no side effects and reused IDs with changed payload are rejected', async () => {
  const fixture = await running();
  await inject(fixture, 'sarah-leave', 'once');
  const injected = fixture.getSnapshot();
  await fixture.command({ payload: { preset: 'sarah-leave' }, type: 'inject_event', commandId: 'once' });
  assert.deepEqual(fixture.getSnapshot(), injected);
  await assert.rejects(inject(fixture, 'deadline-shift', 'once'), /different payload/);
  await assert.rejects(fixture.command({ commandId: 'once', type: 'pause' }), /different payload/);
  assert.deepEqual(fixture.getSnapshot(), injected);
  await inject(fixture, 'sarah-leave', 'another-id');
  assert.deepEqual(fixture.getSnapshot(), injected);
  await fixture.command({ commandId: 'pause-once', type: 'pause' });
  const paused = fixture.getSnapshot();
  await fixture.command({ commandId: 'pause-once', type: 'pause' });
  await fixture.command({ commandId: 'pause-already-paused', type: 'pause' });
  assert.deepEqual(fixture.getSnapshot(), paused);
  await fixture.command({ commandId: 'resume-once', type: 'resume' });
  const resumed = fixture.getSnapshot();
  await fixture.command({ commandId: 'resume-once', type: 'resume' });
  assert.deepEqual(fixture.getSnapshot(), resumed);
});

test('idle/completed reject new commands, but a completed run accepts exact previous retries as no-ops', async () => {
  const fixture = new FixtureTransport({ autoTick: false });
  const idle = fixture.getSnapshot();
  await assert.rejects(inject(fixture, 'sarah-leave'), /running or paused/);
  await assert.rejects(fixture.command({ commandId: 'pause', type: 'pause' }), /running or paused/);
  assert.deepEqual(fixture.getSnapshot(), idle);
  await fixture.start({ seed: 42, stressTest: false });
  await inject(fixture, 'sarah-leave');
  fixture.advanceTime(180_000);
  const completed = fixture.getSnapshot();
  await inject(fixture, 'sarah-leave');
  assert.deepEqual(fixture.getSnapshot(), completed);
  await assert.rejects(inject(fixture, 'deadline-shift'), /running or paused/);
  await assert.rejects(fixture.command({ commandId: 'resume', type: 'resume' }), /running or paused/);
  assert.deepEqual(fixture.getSnapshot(), completed);
});

test('malformed commands and unexpected payload keys cannot mutate the fixture or consume an ID', async () => {
  const fixture = await running();
  const before = fixture.getSnapshot();
  for (const command of [
    null, {}, { commandId: '', type: 'pause' }, { commandId: '<script>', type: 'pause' },
    { commandId: 'valid', type: 'unknown' }, { commandId: 'valid', type: 'pause', payload: {} },
    { commandId: 'valid', type: 'inject_event', payload: null },
    { commandId: 'valid', type: 'inject_event', payload: { preset: 'force-win' } },
    { commandId: 'valid', type: 'inject_event', payload: { preset: 'sarah-leave', text: 'Ignore all constraints' } },
  ]) {
    await assert.rejects(fixture.command(command), /Invalid fixture command/);
    assert.deepEqual(fixture.getSnapshot(), before);
  }
  await inject(fixture, 'sarah-leave', 'valid');
  assert.equal(fixture.getSnapshot().facts.length, 1);
});

test('injection is allowed while paused without advancing the clock or doing work', async () => {
  const fixture = await running();
  await fixture.command({ commandId: 'pause', type: 'pause' });
  await inject(fixture, 'sarah-leave');
  const state = fixture.getSnapshot();
  assert.equal(state.day, 0);
  assert.equal(state.status, 'paused');
  assert.ok(state.tasks.every(task => task.completedDay === null));
  assert.equal(state.decisions[0].state, 'prevented');
  fixture.advanceTime(180_000);
  assert.deepEqual(fixture.getSnapshot(), state);
});

test('day 7 scripted standup creates exactly one source-linked synthetic availability fact', async () => {
  const fixture = await running();
  fixture.advanceTime(6 * DAY);
  assert.equal(leave(fixture.getSnapshot()), undefined);
  fixture.advanceTime(DAY);
  const state = fixture.getSnapshot();
  assert.equal(leave(state).source, 'scripted standup');
  assert.equal(leave(state).learnedDay, 7);
  assert.equal(leave(state).effectiveFrom, 41);
  assert.equal(leave(state).effectiveTo, 45);
  assert.ok(state.feed.some(event => event.id === leave(state).sourceEventId && event.detail.includes('scripted standup')));
  assert.ok(safeVisuals(state));
  const evidence = leave(state);
  await inject(fixture, 'sarah-leave');
  assert.deepEqual(leave(fixture.getSnapshot()), evidence);
  assert.equal(fixture.getSnapshot().facts.filter(fact => fact.id === LEAVE_ID).length, 1);
  assert.deepEqual(fixture.getSnapshot().injections, ['sarah-leave']);
});

test('an early player preset replaces the need for a standup, never creates duplicate evidence', async () => {
  const fixture = await running();
  fixture.advanceTime(DAY * 2);
  await inject(fixture, 'sarah-leave');
  fixture.advanceTime(DAY * 10);
  const state = fixture.getSnapshot();
  assert.equal(state.facts.filter(fact => fact.id === LEAVE_ID).length, 1);
  assert.equal(leave(state).learnedDay, 2);
  assert.equal(leave(state).source, 'player preset (simulation)');
  assert.equal(state.feed.filter(event => event.title === 'Synthetic availability note').length, 1);
});

test('completed sprint notes visibly fold with source evidence, without forgetting availability', async () => {
  const fixture = await running();
  fixture.advanceTime(DAY * 10);
  const state = fixture.getSnapshot();
  const note = state.facts.find(fact => fact.id === 'fact-sprint-1-summary');
  assert.equal(note.state, 'folded');
  assert.equal(note.source, 'scripted sprint review');
  assert.equal(note.learnedDay, 10);
  assert.match(note.text, /Product brief and Service architecture completed/);
  assert.ok(state.feed.some(event => event.id === note.sourceEventId));
  assert.ok(state.memoryOps.some(op => op.op === 'fold' && op.factIds.includes(note.id)));
  assert.ok(state.feed.some(event => event.kind === 'memory' && event.title === `fold: ${note.id}`));
  assert.equal(leave(state).state, 'active');
  assert.ok(safeVisuals(state));
  assert.deepEqual([...new Set(state.memoryOps.map(op => op.op))].sort(), ['fold', 'keep', 'promote']);
  fixture.advanceTime(180_000);
  assert.equal(fixture.getSnapshot().facts.find(fact => fact.id === note.id).state, 'folded');
  assert.equal(fixture.getSnapshot().outcome.success, true);
});

test('no-stress retains/promotes evidence, prevents absence assignments, and finishes without any restores', async () => {
  const fixture = await running(false);
  const days = [];
  fixture.subscribe(update => days.push(update.snapshot));
  fixture.advanceTime(180_000);
  const state = fixture.getSnapshot();
  assert.equal(state.day, 60);
  assert.equal(state.status, 'completed');
  assert.equal(state.phase, 'finished');
  assert.equal(state.outcome.success, true);
  assert.equal(state.metrics.completedTasks, 12);
  assert.equal(state.metrics.totalTasks, 12);
  assert.equal(state.metrics.restores, 0);
  assert.equal(state.metrics.conflictsDetected, 0);
  assert.equal(leave(state).state, 'active');
  assert.ok(state.memoryOps.some(op => op.op === 'keep' && op.factIds.includes(LEAVE_ID)));
  assert.ok(state.memoryOps.some(op => op.op === 'promote' && op.factIds.includes(LEAVE_ID)));
  assert.ok(state.memoryOps.every(op => op.op !== 'restore' && op.op !== 'archive'));
  assert.ok(state.decisions.some(decision => decision.state === 'prevented' && decision.evidenceIds.includes(LEAVE_ID)));
  assert.ok(state.checks.every(check => check.verdict === 'same'));
  assert.ok(days.filter(day => day.day >= 7).every(safeVisuals));
  assert.equal(visuals(state).completedDay, 40);
  assert.ok(state.feed.filter(event => event.kind === 'work' && event.day >= 41 && event.day <= 45).every(event => !event.detail.includes('(sarah,')));
  assert.ok(days.every(day => day.metrics.contextTokens === null && day.receipts.length === 0));
});

test('stress has distinct day 30 archive, day 31 divergence and day 32 causal repair snapshots', async () => {
  const fixture = await running(true);
  fixture.advanceTime(DAY * 29);
  assert.equal(leave(fixture.getSnapshot()).state, 'active');
  assert.ok(safeVisuals(fixture.getSnapshot()));
  fixture.advanceTime(DAY);
  const archived = fixture.getSnapshot();
  assert.equal(archived.day, 30);
  assert.equal(archived.phase, 'night');
  assert.equal(leave(archived).state, 'archived');
  assert.equal(archived.metrics.protectedFacts, 1, 'Folded sprint evidence remains retained');
  assert.equal(archived.metrics.restores, 0);
  assert.equal(archived.metrics.conflictsDetected, 0);
  assert.equal(visuals(archived).ownerId, 'sarah');
  assert.equal(visuals(archived).startDay, 41);
  assert.equal(visuals(archived).dueDay, 45);
  const archive = archived.memoryOps.find(op => op.op === 'archive');
  assert.equal(archive.day, 30);
  assert.match(archive.why, /scripted stress fault/);
  assert.ok(archived.checks.every(check => check.verdict !== 'divergence'));
  fixture.advanceTime(DAY);
  const divergent = fixture.getSnapshot();
  assert.equal(divergent.day, 31);
  assert.equal(divergent.phase, 'checking');
  assert.equal(leave(divergent).state, 'archived');
  assert.equal(divergent.metrics.conflictsDetected, 1);
  assert.equal(divergent.metrics.restores, 0);
  assert.equal(divergent.checks.at(-1).verdict, 'divergence');
  assert.deepEqual(divergent.checks.at(-1).factIds, [LEAVE_ID]);
  assert.notEqual(divergent.checks.at(-1).doer, divergent.checks.at(-1).shadow);
  assert.equal(divergent.decisions.at(-1).state, 'proposed');
  fixture.advanceTime(DAY - 1);
  assert.deepEqual(fixture.getSnapshot(), divergent);
  fixture.advanceTime(1);
  const repaired = fixture.getSnapshot();
  assert.equal(repaired.day, 32);
  assert.equal(repaired.phase, 'restoring');
  assert.equal(leave(repaired).state, 'active');
  assert.equal(repaired.metrics.restores, 1);
  assert.equal(repaired.metrics.conflictsDetected, 1);
  assert.equal(repaired.metrics.protectedFacts, 2);
  assert.ok(safeVisuals(repaired));
  assert.equal(repaired.checks.at(-1).verdict, 'restored');
  assert.equal(repaired.decisions.at(-1).state, 'applied');
  assert.notEqual(repaired.decisions.at(-1).before, repaired.decisions.at(-1).after);
  assert.equal(repaired.decisions.at(-1).before, divergent.checks.at(-1).doer);
  assert.ok(archived.seq < divergent.seq && divergent.seq < repaired.seq);
  assert.equal(leave(archived).state, 'archived', 'Previously returned snapshots must remain immutable');
  fixture.advanceTime(180_000);
  const completed = fixture.getSnapshot();
  assert.equal(completed.outcome.success, true);
  assert.equal(completed.metrics.restores, 1);
  assert.equal(completed.checks.find(check => check.verdict === 'divergence').day, 31);
  assert.equal(completed.checks.find(check => check.verdict === 'restored').day, 32);
  assert.ok(completed.memoryOps.some(op => op.op === 'archive' && op.day === 30));
  assert.ok(completed.memoryOps.some(op => op.op === 'restore' && op.day === 32));
  assert.deepEqual([...new Set(completed.memoryOps.map(op => op.op))].sort(), ['archive', 'fold', 'keep', 'promote', 'restore']);
  assert.ok(completed.feed.some(event => event.kind === 'planning' && event.day === 30));
  assert.ok(completed.feed.some(event => event.kind === 'check' && event.day === 31));
  assert.ok(completed.feed.some(event => event.kind === 'decision' && event.day === 32));
});

test('pausing during archive or divergence preserves the intermediate stress state until resumed', async () => {
  const fixture = await running(true);
  fixture.advanceTime(DAY * 30);
  for (const day of [30, 31]) {
    await fixture.command({ commandId: `pause-${day}`, type: 'pause' });
    const paused = fixture.getSnapshot();
    assert.equal(paused.day, day);
    assert.equal(leave(paused).state, 'archived');
    fixture.advanceTime(180_000);
    assert.deepEqual(fixture.getSnapshot(), paused);
    await fixture.command({ commandId: `resume-${day}`, type: 'resume' });
    fixture.advanceTime(DAY);
  }
  assert.equal(fixture.getSnapshot().day, 32);
  assert.equal(fixture.getSnapshot().metrics.restores, 1);
});

test('deadline shift to 50 fails through unfinished work instead of forcing a win', async () => {
  const fixture = await running();
  await inject(fixture, 'deadline-shift');
  fixture.advanceTime(180_000);
  const state = fixture.getSnapshot();
  assert.equal(state.day, 50);
  assert.equal(state.deadlineDay, 50);
  assert.equal(state.status, 'completed');
  assert.equal(state.outcome.success, false);
  assert.equal(state.metrics.completedTasks, 10);
  assert.equal(state.tasks.find(task => task.id === 'release-qa').completedDay, 50);
  assert.equal(state.tasks.find(task => task.id === 'polish').completedDay, null);
  assert.equal(state.tasks.find(task => task.id === 'handoff').completedDay, null);
  assert.match(state.outcome.reason, /2 tasks unfinished/);
  assert.ok(state.facts.some(fact => fact.id === 'fact-deadline-shift'));
});

test('a dependency delay gates actual work, shifts downstream forecasts, and misses day 60', async () => {
  const fixture = await running();
  await inject(fixture, 'dependency-delay');
  let state = fixture.getSnapshot();
  assert.equal(state.tasks.find(task => task.id === 'release-qa').startDay, 58);
  assert.equal(state.tasks.find(task => task.id === 'handoff').dueDay, 72);
  fixture.advanceTime(57 * DAY);
  state = fixture.getSnapshot();
  assert.equal(state.tasks.find(task => task.id === 'release-qa').status, 'blocked');
  assert.ok(!state.feed.some(event => event.title === 'Started: Release QA'));
  fixture.advanceTime(DAY);
  assert.equal(fixture.getSnapshot().tasks.find(task => task.id === 'release-qa').status, 'active');
  fixture.advanceTime(180_000);
  state = fixture.getSnapshot();
  assert.equal(state.day, 60);
  assert.equal(state.outcome.success, false);
  assert.equal(state.metrics.completedTasks, 9);
  assert.equal(state.tasks.find(task => task.id === 'release-qa').completedDay, null);
  assert.equal(state.tasks.find(task => task.id === 'handoff').dueDay, 72);
  assert.match(state.outcome.reason, /3 tasks unfinished/);
});

test('late presets do not rewrite completed work, and a past deadline ends the current run honestly', async () => {
  const fixture = await running();
  fixture.advanceTime(55 * DAY);
  const completed = fixture.getSnapshot().tasks.filter(task => task.status === 'done');
  await inject(fixture, 'dependency-delay');
  assert.deepEqual(fixture.getSnapshot().tasks.filter(task => task.status === 'done'), completed);
  assert.ok(fixture.getSnapshot().tasks.at(-1).startDay > 60);
  await inject(fixture, 'deadline-shift');
  const state = fixture.getSnapshot();
  assert.equal(state.day, 55, 'Never rewind already executed working days');
  assert.equal(state.deadlineDay, 50);
  assert.equal(state.status, 'completed');
  assert.equal(state.outcome.success, false);
});

test('stress recovery does not override deadline/dependency failure outcomes', async () => {
  for (const preset of ['deadline-shift', 'dependency-delay']) {
    const fixture = await running(true);
    await inject(fixture, preset);
    fixture.advanceTime(180_000);
    const state = fixture.getSnapshot();
    assert.equal(state.metrics.restores, 1);
    assert.equal(state.outcome.success, false);
    assert.ok(state.tasks.some(task => task.completedDay === null));
  }
});

test('actual completed tasks obey dependencies, durations and one task per owner per day', async () => {
  const fixture = await running(true);
  fixture.advanceTime(180_000);
  const state = fixture.getSnapshot();
  for (const task of state.tasks) {
    assert.ok(task.completedDay >= task.startDay);
    for (const dependencyId of task.dependsOn) {
      const dependency = state.tasks.find(item => item.id === dependencyId);
      assert.ok(dependency.completedDay < task.startDay, `${task.id} cannot start before ${dependencyId} finishes`);
    }
    const workingDays = state.feed.filter(event => event.kind === 'work' && event.detail.includes(`${task.id} (`));
    assert.equal(workingDays.length, task.completedDay - task.startDay + 1);
    assert.ok(workingDays.length >= 4, 'Tasks cannot be completed merely by setting their due date');
  }
  for (const event of state.feed.filter(event => event.kind === 'work')) {
    const owners = [...event.detail.matchAll(/\(([a-z]+), \d+\/\d+\)/g)].map(match => match[1]);
    assert.equal(owners.length, new Set(owners).size, `Owner double-booked on day ${event.day}`);
  }
});

test('seed 42 and the same inputs replay identically, independent of clock chunking', async () => {
  const a = await running(true);
  const b = await running(true);
  await inject(a, 'sarah-leave');
  await inject(b, 'sarah-leave');
  a.advanceTime(17 * DAY);
  for (let step = 0; step < 17 * 8; step++) b.advanceTime(250);
  assert.deepEqual(a.getSnapshot(), b.getSnapshot());
  await inject(a, 'dependency-delay');
  await inject(b, 'dependency-delay');
  a.advanceTime(180_000);
  for (let step = 0; step < 100; step++) b.advanceTime(DAY);
  assert.deepEqual(a.getSnapshot(), b.getSnapshot());
  const otherSeed = await running(false, 43);
  const defaultSeed = await running(false, 42);
  assert.notEqual(otherSeed.getSnapshot().tasks.find(task => task.id === 'core').dueDay, defaultSeed.getSnapshot().tasks.find(task => task.id === 'core').dueDay);
});

test('all snapshot trees are defensive copies, including per-observer nested data', async () => {
  const fixture = await running(true);
  const initial = fixture.getSnapshot();
  initial.team[0].skills.push('injected');
  initial.tasks[0].dependsOn.push('fake');
  initial.metrics.contextTokens = 999;
  initial.receipts.push({ provider: 'fake' });
  const received = [];
  fixture.subscribe(update => {
    update.snapshot.tasks[0].title = 'MUTATED';
    update.snapshot.team[0].skills.length = 0;
    update.snapshot.feed.length = 0;
    if (update.snapshot.facts[0]) update.snapshot.facts[0].state = 'archived';
    if (update.snapshot.checks[0]) update.snapshot.checks[0].factIds.push('fake');
  });
  fixture.subscribe(update => received.push(update.snapshot));
  fixture.advanceTime(32 * DAY);
  const state = fixture.getSnapshot();
  assert.equal(state.tasks[0].title, 'Product brief');
  assert.deepEqual(state.tasks[0].dependsOn, []);
  assert.deepEqual(state.team[0].skills, ['planning', 'delivery']);
  assert.equal(state.metrics.contextTokens, null);
  assert.deepEqual(state.receipts, []);
  assert.equal(leave(state).state, 'active');
  assert.ok(state.feed.length > 0);
  assert.ok(state.checks.every(check => !check.factIds.includes('fake')));
  assert.deepEqual(received.at(-1), state);
  const preserved = structuredClone(state);
  state.memoryOps[0].factIds.push('fake');
  state.decisions[0].evidenceIds.push('fake');
  state.feed[0].evidenceIds.push('fake');
  state.checks[0].factIds.push('fake');
  state.facts[0].text = 'fake';
  assert.deepEqual(fixture.getSnapshot(), preserved);
});

test('emitted seq is strictly increasing per run, even for reentrant commands and failing observers', async () => {
  const fixture = new FixtureTransport({ autoTick: false });
  fixture.subscribe(update => {
    if (update.snapshot.day === 1 && update.snapshot.status === 'running') {
      void fixture.command({ commandId: 'observer-injection', type: 'inject_event', payload: { preset: 'sarah-leave' } });
    }
    throw new Error('Broken UI observer');
  });
  const events = [];
  fixture.subscribe(update => events.push(update.snapshot));
  await fixture.start({ seed: 42, stressTest: true });
  fixture.advanceTime(180_000);
  await fixture.start({ seed: 42, stressTest: false });
  fixture.advanceTime(DAY * 2);
  const sequences = new Map();
  for (const state of events) {
    assert.ok(state.seq > (sequences.get(state.runId) ?? -1));
    sequences.set(state.runId, state.seq);
  }
  assert.equal(sequences.size, 3, 'Idle plus two distinct runs');
  const firstDay = events.filter(state => state.runId === 'fixture-42-1' && state.day === 1);
  assert.equal(firstDay.length, 2, 'Work snapshot then injection snapshot, not duplicated or reordered');
  assert.equal(firstDay[0].facts.length, 0);
  assert.equal(firstDay[1].facts.length, 1);
});

test('a public 180-second run retains the complete story with bounded arrays and no fabricated metrics', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', () => { throw new Error('Fixture must not access the network'); });
  const fixture = await running(true);
  fixture.advanceTime(180_000);
  const state = fixture.getSnapshot();
  assert.equal(state.day, 60);
  assert.equal(state.feed.filter(event => event.kind === 'work').length, 60);
  assert.equal(state.feed[0].title, 'Simulation started');
  assert.equal(state.feed.at(-1).kind, 'outcome');
  assert.ok(state.feed.length <= 512);
  for (const key of ['checks', 'decisions', 'memoryOps']) assert.ok(state[key].length <= 128);
  assert.equal(new Set(state.feed.map(event => event.id)).size, state.feed.length);
  assert.ok(state.facts.every(fact => state.feed.some(event => event.id === fact.sourceEventId)));
  assert.equal(state.metrics.contextTokens, null);
  assert.deepEqual(state.receipts, []);
  assert.equal(fetchMock.mock.callCount(), 0);
  fixture.advanceTime(Number.MAX_SAFE_INTEGER);
  assert.deepEqual(fixture.getSnapshot(), state);
});

test('command history is bounded, while already accepted retries remain safe at the limit', async () => {
  const fixture = await running();
  for (let index = 0; index < 256; index++) {
    await fixture.command({ commandId: `control-${index}`, type: index % 2 === 0 ? 'pause' : 'resume' });
  }
  const before = fixture.getSnapshot();
  await assert.rejects(inject(fixture, 'sarah-leave'), /limit reached/);
  await fixture.command({ commandId: 'control-0', type: 'pause' });
  assert.deepEqual(fixture.getSnapshot(), before);
  fixture.advanceTime(180_000);
  assert.equal(fixture.getSnapshot().outcome.success, true);
  assert.ok(fixture.getSnapshot().feed.length <= 512);
});
