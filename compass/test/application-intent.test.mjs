import test from 'node:test';
import assert from 'node:assert/strict';
import {applicationDraft} from '../src/applications/intent.mjs';
test('optional onboarding preserves application intent while explicit website choice wins',()=>{
  const draft={ready:true,prompt:'A CRM for my architecture studio',preferences:{}};
  assert.equal(applicationDraft(draft),true);
  assert.equal(applicationDraft({...draft,preferences:{projectType:'website'}}),false);
  assert.equal(applicationDraft({...draft,ready:false}),false);
  assert.equal(applicationDraft({ready:true,prompt:'A bright bakery website'}),false);
  assert.equal(applicationDraft({ready:true,prompt:'For my studio',preferences:{projectType:'internal-tool'}}),true);
});
