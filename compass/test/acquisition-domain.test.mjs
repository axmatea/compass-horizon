import test from 'node:test';
import assert from 'node:assert/strict';
import {qualify,mergeEvidence,calculateMetrics,recommend,validateFields,validateRules} from '../server/acquisition/domain.mjs';
const complete={problem:'Manual workflow',decisionMaker:true,businessFit:true,budget:8000,timelineDays:30};
test('missing budget is unresolved, explicit zero is not ICP',()=>{
 assert.equal(qualify({...complete,budget:null}).status,'NEEDS_CONTEXT');assert.equal(qualify({...complete,budget:0}).status,'NOT_ICP');assert.equal(qualify(complete).status,'QUALIFIED');
});
test('schemas reject strings and unknown fields',()=>{
 assert.throws(()=>validateFields({budget:'8000'}));assert.throws(()=>validateFields({decisionMaker:'yes'}));assert.throws(()=>validateFields({tenantId:'evil'}));assert.throws(()=>validateRules({minBudget:-1,maxTimelineDays:90}));
});
test('late evidence fills missing fields but cannot roll newer evidence back',()=>{
 const newer={occurredAt:'2026-09-25T10:00:00.000Z',source:'manual',externalId:'b'};
 const older={...newer,occurredAt:'2026-09-24T10:00:00.000Z',externalId:'a'};
 const first=mergeEvidence({budget:null,problem:null},{},{problem:'New problem'},newer);
 const last=mergeEvidence(first.fields,first.clocks,{budget:8000,problem:'Old problem'},older);
 assert.deepEqual(last.fields,{budget:8000,problem:'New problem'});
});
test('equal time conflicts resolve consistently regardless of delivery order',()=>{
 const a={occurredAt:'2026-09-25T10:00:00.000Z',source:'manual',externalId:'a'},b={...a,externalId:'b'};
 const run=(x,y)=>{const first=mergeEvidence({budget:null},{},{budget:x.externalId==='a'?5000:9000},x);return mergeEvidence(first.fields,first.clocks,{budget:y.externalId==='a'?5000:9000},y).fields;};
 assert.deepEqual(run(a,b),run(b,a));
});
test('unknown attribution stays outside experiments and a small sample is not a winner',()=>{
 const m=calculateMetrics([{experimentId:null,qualification:qualify(complete)},{experimentId:'a',qualification:qualify({...complete,budget:null})}]);
 assert.equal(m.unknownAttribution,1);assert.equal(m.experiments.length,1);assert.equal(m.unresolved,1);assert.equal(m.sampleStatus,'insufficient_evidence');assert.match(recommend(m),/missing qualification/);
});
test('event identifiers containing separators cannot collide',()=>{
 const a={occurredAt:'2026-09-25T10:00:00.000Z',source:'a|b',externalId:'c'},b={...a,source:'a',externalId:'b|c'};
 const run=(x,y)=>{const first=mergeEvidence({budget:null},{},{budget:x===a?5000:9000},x);return mergeEvidence(first.fields,first.clocks,{budget:y===a?5000:9000},y).fields;};
 assert.deepEqual(run(a,b),run(b,a));
});
