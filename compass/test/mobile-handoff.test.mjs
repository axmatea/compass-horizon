import test from 'node:test';
import assert from 'node:assert/strict';
import {phoneProjectHref,rememberPhoneProject,pendingPhoneProject} from '../src/applications/phone-link.mjs';
import {writeDraft,readDraft} from '../src/create/draft.mjs';

function memory() {
  const values=new Map();
  return {getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
}

test('phone QR holds an owner-gated workspace reference without a query or token',()=>{
  const uri=new URL(phoneProjectHref('https://mycompass.world','app_qa-mobile'));
  assert.equal(uri.pathname,'/workspace');
  assert.equal(uri.search,'');
  assert.equal(uri.hash,'#phone=app_qa-mobile');
  assert.throws(()=>phoneProjectHref('http://mycompass.world','app_qa-mobile'));
  assert.throws(()=>phoneProjectHref('https://mycompass.world','app_qa-mobile?secret=secret'));
  const storage=memory(),now=()=>1000;
  assert.equal(rememberPhoneProject('#phone=app_x&owner=other',{storage,now}),false);
  assert.equal(rememberPhoneProject(uri.hash,{storage,now}),true);
  assert.equal(pendingPhoneProject({storage,now:()=>1200}),'app_qa-mobile');
  assert.equal(pendingPhoneProject({storage,now:()=>1200,consume:true}),'app_qa-mobile');
  assert.equal(pendingPhoneProject({storage,now}),null);
  rememberPhoneProject(uri.hash,{storage,now});
  assert.equal(pendingPhoneProject({storage,now:()=>901000}),null);
});

test('mobile choice survives sign-in handoff and changes build identity when replaced',()=>{
  const storage=memory(),now=()=>1000;
  const input={prompt:'Build AI MEDIA Personal OS',preferences:{projectType:'internal-tool'}};
  const draft=writeDraft({...input,platform:'ios',ready:false},{storage,now,id:()=>'ios_draft'});
  assert.equal(draft.draft.platform,'ios');
  assert.equal(readDraft({storage,now}).platform,'ios');
  const changed=writeDraft({...input,platform:'android',ready:true,ownerId:'owner'},{storage,now,id:()=>'android_draft'});
  assert.equal(changed.draft.id,'android_draft');
  assert.equal(changed.draft.platform,'android');
  assert.equal(writeDraft({...input,platform:'external'}, {storage,now}).ok,false);
  assert.equal(writeDraft({...input,platform:null}, {storage,now,id:()=>'web_draft'}).draft.platform,undefined);
});
