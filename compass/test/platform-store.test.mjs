import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createAccountStore} from '../account/store.mjs';
import {createPlatformStore} from '../platform/store.mjs';
import {createApplicationManifest} from '../generation/index.mjs';
function fixture(t){const db=new DatabaseSync(':memory:');t.after(()=>db.close());return {db,store:createPlatformStore(db)}}
const throwsCode=code=>error=>error.code===code;
test('record updates clear optional visible fields and preserve only removed schema fields',t=>{
  const {store}=fixture(t),app=store.createApplication('owner_a',createApplicationManifest('A task tracker'),'Test');
  const record=store.saveRecord('owner_a',app.id,{title:'QA task',status:'To do',notes:'Remove this note'});
  let cleared=store.saveRecord('owner_a',app.id,{title:'QA task',status:'Done'},record.id);assert.equal(cleared.data.notes,undefined);
  cleared=store.saveRecord('owner_a',app.id,{title:'QA task',status:'Done',notes:'Keep when hidden'},record.id);
  const next=structuredClone(app.manifest);next.entity.fields=next.entity.fields.filter(f=>f.key!=='notes');store.updateApplication('owner_a',app.id,next,'Hide notes');
  const hidden=store.saveRecord('owner_a',app.id,{title:'Updated task',status:'Done'},record.id);assert.equal(hidden.data.notes,'Keep when hidden');
  store.restore('owner_a',app.id,1);assert.equal(store.listRecords('owner_a',app.id)[0].data.notes,'Keep when hidden');
  assert.throws(()=>store.listRecords('owner_b',app.id),throwsCode('not_found'));
});
test('record retention is bounded across repeated schema changes',t=>{
  const {db,store}=fixture(t),app=store.createApplication('owner_a',createApplicationManifest('A task tracker'),'Test');
  const record=store.saveRecord('owner_a',app.id,{title:'QA task',status:'To do'});
  const hidden=Object.fromEntries(Array.from({length:32},(_,n)=>['historical_'+n,'x']));db.prepare('UPDATE compass_application_record SET data=? WHERE id=?').run(JSON.stringify(hidden),record.id);
  assert.throws(()=>store.saveRecord('owner_a',app.id,{title:'QA task',status:'To do'},record.id),throwsCode('record_retention_limit'));
  db.prepare('UPDATE compass_application_record SET data=? WHERE id=?').run(JSON.stringify({historical:'x'.repeat(16380)}),record.id);
  assert.throws(()=>store.saveRecord('owner_a',app.id,{title:'QA task',status:'To do'},record.id),throwsCode('record_retention_limit'));
});
test('application cap is checked within atomic write and owner revisions never restore another application',t=>{
  const {db,store}=fixture(t),manifest=createApplicationManifest('A task tracker');
  for(let i=0;i<12;i++)store.createApplication('owner_a',manifest,'Test');
  assert.throws(()=>store.createApplication('owner_a',manifest,'Over cap'),throwsCode('application_limit'));assert.equal(db.isTransaction,false);
  assert.equal(store.listApplications('owner_a').length,12);assert.equal(store.listApplications('owner_b').length,0);
  const b=store.createApplication('owner_b',manifest,'Own app');assert.throws(()=>store.restore('owner_a',b.id,1),throwsCode('not_found'));
});
test('application and operation receipt commit or rollback together',t=>{
  const {store}=fixture(t),manifest=createApplicationManifest('A task tracker');
  assert.throws(()=>store.atomic(()=>{store.createApplication('owner_a',manifest,'Test');throw Error('receipt failed')}),/receipt failed/);
  assert.equal(store.listApplications('owner_a').length,0);
});

test('operations metrics aggregate persisted provider usage without owner IDs or prompts and retain unknown counters',t=>{
  const {db,store}=fixture(t),accounts=createAccountStore(db);
  const operation=accounts.beginOperation('owner_a','metrics_operation_1234',{text:'Private original request'});
  accounts.recordUsage('owner_a',operation.id,{id:'usage_a',provider:'anthropic',model:'fixture-model',reportedModel:null,inputTokens:120,outputTokens:40,cacheReadTokens:10,cacheWriteTokens:null,totalTokens:null,reasoningTokens:null,usageComplete:true});
  accounts.recordUsage('owner_a',operation.id,{id:'usage_b',provider:'anthropic',model:'fixture-model',reportedModel:null,inputTokens:null,outputTokens:3,cacheReadTokens:null,cacheWriteTokens:null,totalTokens:null,reasoningTokens:null,usageComplete:false});
  accounts.failOperation('owner_a',operation.id);store.event('owner_a','application','build_failed');
  const overview=store.overview(),usage=overview.aiUsage[0];assert.equal(overview.failedOperations,1);assert.equal(overview.applicationErrors,1);assert.equal(usage.attempts,2);assert.equal(usage.inputTokens,null);assert.equal(usage.inputTokensKnownSum,120);assert.equal(usage.outputTokens,null);assert.equal(usage.outputTokensKnownSum,43);assert.equal(usage.inputTokensUnknownAttempts,1);assert.equal(usage.totalTokens,null);assert.equal(usage.totalTokensUnknownAttempts,2);assert.equal(usage.incompleteUsageAttempts,1);
  assert.ok(!JSON.stringify(overview).includes('owner_a'));assert.ok(!JSON.stringify(overview).includes('Private original request'));
});

test('portable business data stays capped at 200 owner records',t=>{
  const {store}=fixture(t),app=store.createApplication('owner_a',createApplicationManifest('A task tracker'),'Test');
  for(let i=0;i<200;i++)store.saveRecord('owner_a',app.id,{title:'Task '+i,status:'To do'});
  assert.equal(store.listRecords('owner_a',app.id).length,200);
  assert.throws(()=>store.saveRecord('owner_a',app.id,{title:'One too many',status:'To do'}),throwsCode('record_limit'));
  assert.throws(()=>store.listRecords('owner_b',app.id),throwsCode('not_found'));
});
