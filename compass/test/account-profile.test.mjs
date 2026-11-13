import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProfilePreferences} from '../account/profile.mjs';
import {writeDraft,readDraft,normalizePreferences} from '../src/create/draft.mjs';

test('all optional onboarding choices survive a draft reload without replacing the original prompt',()=>{
  const preferences={projectType:'client-portal',visualDirection:'editorial',experience:'founder',intendedUse:'agency',workspaceLayout:'preview'};
  assert.deepEqual(validateProfilePreferences(preferences),preferences);
  const records=new Map(),storage={getItem:key=>records.get(key)||null,setItem:(key,value)=>records.set(key,value),removeItem:key=>records.delete(key)};
  const original='A client portal for my design business. Keep the gallery quiet.';
  assert.equal(writeDraft({prompt:original,preferences},{storage}).ok,true);
  const reopened=readDraft({storage});
  assert.equal(reopened.prompt,original);assert.deepEqual(reopened.preferences,preferences);
  assert.deepEqual(validateProfilePreferences({}),{});
});

test('the server rejects unrecognized preferences, identity fields and invalid choices',()=>{
  for(const value of [null,[],{experience:'expert'},{intendedUse:'arbitrary'},{workspaceLayout:'unsafe'},
    {experience:'beginner',owner:'other-user'},JSON.parse('{"__proto__":{"admin":true}}')])assert.equal(validateProfilePreferences(value),null);
  assert.deepEqual(normalizePreferences({experience:'beginner',intendedUse:'personal',workspaceLayout:'conversation',userId:'other'}),
    {experience:'beginner',intendedUse:'personal',workspaceLayout:'conversation'});
});
