import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import {readDraft,writeDraft,validPrompt,normalizePreferences,DRAFT_KEY} from '../src/create/draft.mjs'
import {resolveCreateEntry} from '../src/create/flow.mjs'
import {accountEntry} from '../src/create/manage.mjs'

const source=(await readFile(new URL('../src/create/create.js',import.meta.url),'utf8'))
  .replace(/^import .+\n/gm,'').replace(/\ninitialize\(\)\s*$/,'\nglobalThis.started=initialize()')

async function fixture({search='?signin=1',prompt,signedIn=false}={}) {
  const controls=new Map(),all=[],calls=[],navigations=[],values=new Map()
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}
  if(prompt)writeDraft({prompt,preferences:{visualDirection:'editorial'},ready:true,ownerId:'owner_one'},{storage})
  const storedDraft=storage.getItem(DRAFT_KEY)
  class Node {
    constructor(){this.textContent='';this.value='';this.hidden=false;this.disabled=false;this.dataset={};this.attributes={};this.listeners={};all.push(this)}
    addEventListener(name,callback){this.listeners[name]=callback}
    setAttribute(name,value){this.attributes[name]=value}
    querySelectorAll(){return[]}
    replaceChildren(){}
    append(){}
    focus(){}
    click(){if(!this.disabled)return this.listeners.click?.()}
  }
  const get=id=>{if(!controls.has(id))controls.set(id,new Node());return controls.get(id)}
  const api={
    async config(){calls.push('config');return{enabled:true,configured:true,providers:['email'],emailMode:'verified',persistence:'durable',features:{passwordRecovery:true}}},
    async session(){calls.push('session');return signedIn?{user:{id:'owner_one'},session:{id:'session_one'}}:null},
    async profile(){calls.push('profile');return{preferences:{}}},
    bindUser(){},setReturnMode(){},
  }
  const context={URL,document:{getElementById:get,querySelectorAll:()=>all,addEventListener(){}},window:{addEventListener(){}},
    location:{href:'https://compass.example/create'+search,search,assign:path=>navigations.push(path)},history:{replaceState(){}},
    createAccountApi:()=>api,createAccountViews:()=>({cancel(){},render(){}}),accountEntry,resolveCreateEntry,
    readDraft:()=>readDraft({storage}),writeDraft:value=>writeDraft(value,{storage}),validPrompt,normalizePreferences,
  }
  vm.runInNewContext(source,context);await context.started
  return{get,calls,navigations,storedDraft,storage}
}

test('switching from sign-in to create-account updates visible copy and switching back restores it',async()=>{
  const ui=await fixture()
  assert.equal(ui.get('create-title').textContent,'Welcome back.')
  const initialCalls=[...ui.calls]
  ui.get('signup-mode').click()
  assert.equal(ui.get('create-title').textContent,'Create your account.')
  assert.equal(ui.get('create-lede').textContent,'Create an account to save your work.')
  assert.equal(ui.get('account-submit').textContent,'Create account →')
  assert.equal(ui.get('name-field').hidden,false)
  ui.get('signin-mode').click()
  assert.equal(ui.get('create-title').textContent,'Welcome back.')
  assert.equal(ui.get('create-lede').textContent,'Sign in to your workspace.')
  assert.equal(ui.get('account-submit').textContent,'Sign in →')
  assert.equal(ui.get('name-field').hidden,true)
  assert.deepEqual(ui.calls,initialCalls);assert.deepEqual(ui.navigations,[])
})

test('account toggles keep a pending idea and its account-bound handoff unchanged',async()=>{
  const ui=await fixture({prompt:'Keep my studio idea'})
  assert.equal(ui.get('create-title').textContent,'Keep your idea.')
  ui.get('signin-mode').click();ui.get('signup-mode').click()
  assert.equal(ui.get('auth-prompt').textContent,'Keep my studio idea')
  assert.equal(ui.get('create-prompt').value,'Keep my studio idea')
  assert.equal(ui.storage.getItem(DRAFT_KEY),ui.storedDraft)
  assert.deepEqual(ui.navigations,[])
})

test('security reauthentication keeps sign-in-only copy and preserves the existing draft',async()=>{
  const ui=await fixture({search:'?signin=1&reauth=1',prompt:'Keep my private idea',signedIn:true})
  assert.equal(ui.get('create-title').textContent,'Sign in again.')
  assert.equal(ui.get('create-lede').textContent,'Sign in to view your security settings.')
  ui.get('signup-mode').click()
  assert.equal(ui.get('create-title').textContent,'Sign in again.')
  assert.equal(ui.get('account-submit').textContent,'Sign in →')
  assert.equal(ui.get('name-field').hidden,true)
  assert.equal(ui.storage.getItem(DRAFT_KEY),ui.storedDraft)
  assert.deepEqual(ui.navigations,[])
})

test('the explicit account entry opens sign-in while preserving a pending project',async()=>{
  const ui=await fixture({search:'?view=account',prompt:'Keep my unfinished website'})
  assert.equal(ui.get('account-submit').textContent,'Sign in →')
  assert.equal(ui.get('name-field').hidden,true)
  assert.equal(ui.get('create-account-link').href,'/create?view=account')
  assert.equal(ui.get('create-prompt').value,'Keep my unfinished website')
  assert.equal(ui.storage.getItem(DRAFT_KEY),ui.storedDraft)
  assert.deepEqual(ui.navigations,[])
})
