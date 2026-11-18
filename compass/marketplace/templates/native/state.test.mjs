import test from 'node:test';
import assert from 'node:assert/strict';
import {TEMPLATE} from './template.mjs';
import {initialState,transition,progress,visibleItems,availableSlots,localDate,validDate,SERVICES,SLOTS} from './state.mjs';

test('the selected template has independent editable session data',()=>{
  const first=initialState(TEMPLATE.id),second=initialState(TEMPLATE.id);
  first.items.push({id:'extra',label:'Local only',done:false});
  assert.notEqual(first.items.length,second.items.length);
  assert.equal(second.family,TEMPLATE.id);
});
test('habits and tasks can be added, completed, filtered and removed without mutating earlier state',()=>{
  for(const family of ['pulse','field']) {
    const first=initialState(family),added=transition(first,{type:'add',label:'New item',priority:'high'},{id:()=> 'new_item'}).state;
    assert.equal(added.items.length,first.items.length+1);
    assert.equal(first.items.some(item=>item.id==='new_item'),false);
    const done=transition(added,{type:'toggle',id:'new_item'}).state;
    assert.equal(visibleItems(done,'done').some(item=>item.id==='new_item'),true);
    assert.equal(progress(done).done,progress(first).done+1);
    const removed=transition(done,{type:'remove',id:'new_item'}).state;
    assert.deepEqual(removed.items,first.items);
    assert.equal(transition(first,{type:'add',label:'   '}).state,first);
    assert.equal(transition(first,{type:'toggle',id:'missing'}).state,first);
  }
});
test('demo requests reserve only a local slot and cancellation releases it',()=>{
  const date='2026-12-03',first=initialState('venue');
  const request={type:'book',name:'Demo guest',service:SERVICES[0],date,slot:SLOTS[0]};
  const saved=transition(first,request,{id:()=> 'request_one'}).state;
  assert.equal(first.bookings.length,0);
  assert.equal(saved.bookings.length,1);
  assert.equal(availableSlots(saved,date).includes(SLOTS[0]),false);
  const duplicate=transition(saved,request,{id:()=> 'request_two'});
  assert.ok(duplicate.error);assert.equal(duplicate.state,saved);
  const cancelled=transition(saved,{type:'cancel',id:'request_one'}).state;
  assert.equal(cancelled.bookings[0].status,'cancelled');
  assert.equal(availableSlots(cancelled,date).includes(SLOTS[0]),true);
  assert.equal(transition(first,{...request,date:'2026-02-30'}).state,first);
  assert.equal(transition(first,{...request,service:'Not a service'}).state,first);
});
test('real dates, reset and unknown actions are bounded',()=>{
  assert.equal(validDate('2028-02-29'),true);assert.equal(validDate('2026-02-29'),false);
  assert.equal(localDate(new Date(2026,10,18)),'2026-11-18');
  const first=initialState(TEMPLATE.id);
  assert.deepEqual(transition(first,{type:'reset'}).state,first);
  assert.equal(transition(first,{type:'fetch'}).state,first);
  assert.throws(()=>initialState('../secret'));
});
