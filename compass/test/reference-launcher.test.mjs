import test from 'node:test'
import assert from 'node:assert/strict'
import {createReferenceLauncher} from '../src/start/launcher.mjs'

function trigger() {
  const handlers=new Set(),attributes=new Map()
  return {isConnected:true,attributes,addEventListener(type,fn){if(type==='click')handlers.add(fn)},removeEventListener(type,fn){handlers.delete(fn)},
    setAttribute:(key,value)=>attributes.set(key,value),removeAttribute:key=>attributes.delete(key),
    async click(){await Promise.all([...handlers].map(fn=>fn({preventDefault(){}})))}}
}

test('reference entry loads only after a click and forwards the unsaved-work guard without executing it',async()=>{
  const button=trigger(),calls=[],beforeContinue=()=>{throw Error('Only Build may ask to leave')};let paused=0
  const launcher=createReferenceLauncher({trigger:button,defaultTarget:'app',beforeContinue,beforeOpen:()=>paused++,load:async()=>{
    calls.push('load')
    return{mountReferenceStart(options){assert.equal(options.beforeContinue,beforeContinue);assert.equal(options.defaultTarget,'app');return{open:()=>calls.push('open'),destroy:()=>calls.push('destroy')}}}
  }})
  assert.deepEqual(calls,[])
  await button.click();assert.deepEqual(calls,['load','open'])
  await button.click();assert.equal(paused,2);assert.deepEqual(calls,['load','open'])
  assert.equal(button.attributes.has('aria-busy'),false)
  launcher.destroy();await button.click();assert.deepEqual(calls,['load','open','destroy'])
})

test('double-clicks mount a planner once and late loads cannot open a destroyed entry',async()=>{
  const button=trigger();let complete,opens=0,mounts=0
  const loading=new Promise(resolve=>complete=resolve)
  const launcher=createReferenceLauncher({trigger:button,load:()=>loading})
  const first=button.click(),second=button.click()
  launcher.destroy()
  complete({mountReferenceStart(){mounts++;return{open(){opens++},destroy(){}}}})
  await Promise.all([first,second]);assert.equal(mounts,0);assert.equal(opens,0)
  assert.equal(button.attributes.has('aria-busy'),false)
})

test('a failed load reports an actionable error and the same entry can retry',async()=>{
  const button=trigger(),errors=[];let loads=0,opens=0
  createReferenceLauncher({trigger:button,onError:text=>errors.push(text),load:async()=>{
    if(++loads===1)throw Error('offline')
    return{mountReferenceStart:()=>({open(){opens++},destroy(){}})}
  }})
  await button.click();assert.match(errors.at(-1),/Try again/)
  await button.click();assert.equal(loads,2);assert.equal(opens,1);assert.equal(errors.at(-1),'')
})

test('an explicit shared-link open can reopen the planner without starting a build',async()=>{
  const button=trigger();let opens=0,loads=0,guards=0
  const launcher=createReferenceLauncher({trigger:button,beforeContinue:()=>{guards++;return true},load:async()=>{
    loads++;return{mountReferenceStart:()=>({open(){opens++},destroy(){}})}
  }})
  await launcher.open();await launcher.open()
  assert.equal(loads,1);assert.equal(opens,2);assert.equal(guards,0)
  launcher.destroy();await launcher.open();assert.equal(opens,2)
})
