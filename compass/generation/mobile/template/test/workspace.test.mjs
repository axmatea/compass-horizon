import assert from 'node:assert/strict';
import test from 'node:test';
import {centsFromAmount, decodeWorkspace, emptyWorkspace, listOf, newDraft, reminderDate, removeRecord, sampleWorkspace, saveDraft, summarize, updateRecord, validDay} from '../src/workspace.ts';

const today = new Date(2026, 10, 24, 12, 0, 0);

test('a new install starts empty and sample data is explicit', () => {
  assert.deepEqual(decodeWorkspace(null), emptyWorkspace());
  const sample = sampleWorkspace(today);
  assert.deepEqual(decodeWorkspace(JSON.stringify(sample)), sample);
  const result = summarize(sample, today);
  assert.equal(result.won, 1180000);
  assert.equal(result.activePipeline, 720000);
  assert.equal(result.activeProjects, 1);
  assert.equal(result.openTasks.length, 1);
});

test('client, opportunity and project edits preserve relationships through storage', () => {
  let saved = saveDraft(emptyWorkspace(), 'client', {...newDraft('client'), title: 'Sample Client', industry: 'Consulting'});
  const [client] = listOf(saved, 'client');
  saved = saveDraft(saved, 'opportunity', {...newDraft('opportunity'), title: 'Workshop', clientId: client.id, value: '7200.43'});
  const [deal] = listOf(saved, 'opportunity');
  assert.equal(deal.valueCents, 720043);
  saved = updateRecord(saved, {...deal, stage: 'won'});
  saved = saveDraft(saved, 'project', {...newDraft('project'), title: 'Rollout', clientId: client.id, status: 'active'});
  saved = decodeWorkspace(JSON.stringify(saved));
  assert.equal(summarize(saved, today).won, 720043);
  assert.equal(summarize(saved, today).activePipeline, 0);
  assert.equal(summarize(saved, today).activeProjects, 1);
  assert.throws(() => removeRecord(saved, client), /linked records/);
  assert.throws(() => saveDraft(saved, 'contact', {...newDraft('contact'), title: 'Unlinked', clientId: 999}), /available client/);
  assert.throws(() => saveDraft(saved, 'contact', {...newDraft('contact'), title: 'Invalid email', clientId: client.id, email: 'not-an-email'}), /email address/);
});

test('task completion, due dates and revenue use actual records', () => {
  const sample = sampleWorkspace(today);
  const [task] = listOf(sample, 'task');
  const finished = updateRecord(sample, {...task, done: true});
  assert.equal(summarize(finished, today).openTasks.length, 0);
  const monday = new Date(2026, 10, 23, 12);
  const followUp = saveDraft(emptyWorkspace(), 'task', {...newDraft('task'), title: 'Follow up', category: 'follow-up', dueDate: '2026-11-23'});
  assert.equal(summarize(followUp, monday).overdueFollowUps.length, 0);
  assert.equal(summarize(followUp, today).overdueFollowUps.length, 1);
  assert.equal(reminderDate('2026-11-24', today.getTime()), null);
  assert.equal(reminderDate('2026-11-25', today.getTime()).getHours(), 9);
  assert.equal(validDay('2026-02-29'), false);
  assert.equal(validDay('2028-02-29'), true);
  assert.equal(centsFromAmount('0.01'), 1);
  assert.equal(centsFromAmount('10.005'), null);
});

test('invalid stored schema and dangling relations fail before writes', () => {
  assert.throws(() => decodeWorkspace('{"version":2,"nextId":1,"records":[]}'), /Invalid workspace/);
  const saved = sampleWorkspace(today);
  assert.throws(() => decodeWorkspace(JSON.stringify({...saved,records: saved.records.filter(row => row.id !== 1)})), /links/);
  assert.throws(() => decodeWorkspace(JSON.stringify({...saved,records: [...saved.records, saved.records[0]]})), /links/);
});
