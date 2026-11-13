import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { operationKey, clearOperation, OPERATION_STORAGE_KEY } from '../src/account/operation.mjs';

const owner = 'user_one', payload = JSON.stringify({text:'Build a private clinic portal',sessionId:'synthetic_session'});
const firstKey = 'operation_key_first_1234', nextKey = 'operation_key_next_56789';
function storage() {
  const records = new Map();
  return { getItem:key=>records.get(key) ?? null, setItem:(key,value)=>records.set(key,String(value)), removeItem:key=>records.delete(key) };
}

test('the same owner and payload reuse a durable tab key after a module-state-free reload', async () => {
  const tab = storage();
  const initial = await operationKey({owner,payload},{storage:tab,now:()=>100,id:()=>firstKey});
  assert.equal(initial,firstKey);
  const reloaded = await operationKey({owner,payload},{storage:tab,now:()=>1000,id:()=>{throw new Error('A reload must not create another paid attempt');}});
  assert.equal(reloaded,firstKey);
  const record = JSON.parse(tab.getItem(OPERATION_STORAGE_KEY));
  assert.deepEqual(Object.keys(record).sort(),['at','hash','key','owner']);
  assert.equal(record.hash,createHash('sha256').update(payload).digest('hex'));
  assert.equal(record.at,100,'retries do not extend the original receipt lifetime');
  assert.ok(!tab.getItem(OPERATION_STORAGE_KEY).includes('clinic'));
  assert.ok(!tab.getItem(OPERATION_STORAGE_KEY).includes('synthetic_session'));
});

test('another owner, changed instruction or an expired receipt gets a new key', async () => {
  const tab = storage();
  await operationKey({owner,payload},{storage:tab,now:()=>100,id:()=>firstKey});
  assert.equal(await operationKey({owner:'user_two',payload},{storage:tab,now:()=>200,id:()=>nextKey}),nextKey);
  assert.equal(await operationKey({owner:'user_two',payload:payload+' '},{storage:tab,now:()=>300,id:()=>firstKey}),firstKey);
  assert.equal(await operationKey({owner:'user_two',payload:payload+' '},{storage:tab,now:()=>300+24*60*60*1000,id:()=>nextKey}),nextKey);
});

test('late completion and another owner cannot clear a newer pending build', async () => {
  const tab = storage();
  await operationKey({owner,payload},{storage:tab,now:()=>100,id:()=>firstKey});
  await operationKey({owner,payload:'A different new request'},{storage:tab,now:()=>200,id:()=>nextKey});
  assert.equal(clearOperation({owner,key:firstKey},{storage:tab}),false);
  assert.equal(clearOperation({owner:'user_two',key:nextKey},{storage:tab}),false);
  assert.equal(JSON.parse(tab.getItem(OPERATION_STORAGE_KEY)).key,nextKey);
  assert.equal(clearOperation({owner,key:nextKey},{storage:tab}),true);
  assert.equal(tab.getItem(OPERATION_STORAGE_KEY),null);
  assert.equal(await operationKey({owner,payload:'A different new request'},{storage:tab,now:()=>300,id:()=>firstKey}),firstKey);
});

test('corrupt or future-dated receipt data is replaced without touching other session data', async () => {
  const tab = storage();
  tab.setItem('unrelated-account-setting','kept');
  for (const raw of ['{broken', '[]', JSON.stringify({owner,hash:'a'.repeat(64),key:firstKey,at:99999})]) {
    tab.setItem(OPERATION_STORAGE_KEY,raw);
    assert.equal(await operationKey({owner,payload},{storage:tab,now:()=>100,id:()=>nextKey}),nextKey);
    assert.equal(tab.getItem('unrelated-account-setting'),'kept');
  }
});

test('unavailable, throwing or silently ignored storage stops before any caller can send a build', async () => {
  const broken = [
    null,
    {getItem(){throw Error('read denied')},setItem(){}},
    {getItem(){return null},setItem(){throw Error('quota exceeded')}},
    {getItem(){return null},setItem(){}},
  ];
  for (const tab of broken) {
    let requests = 0;
    await assert.rejects(async () => {
      await operationKey({owner,payload},{storage:tab,now:()=>100,id:()=>firstKey});
      requests++;
    },error=>error.code==='operation_storage_unavailable');
    assert.equal(requests,0);
  }
});
