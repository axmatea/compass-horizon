import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import {readDraft,writeDraft,validPrompt,normalizePreferences,DRAFT_KEY,draftCanAutoBuild} from '../src/create/draft.mjs'
import {resolveCreateEntry,AccountRequestError,accountErrorText,isAccountChanged,createAccountApi,allowedEmail} from '../src/create/flow.mjs'
import {accountEntry} from '../src/create/manage.mjs'
import {applicationDraft,applicationEntryPreferences} from '../src/applications/intent.mjs'

const source=(await readFile(new URL('../src/create/create.js',import.meta.url),'utf8'))
  .replace(/^import .+\n/gm,'').replace(/\ninitialize\(\)\s*$/,'\nglobalThis.started=initialize()')
const prompt='Build an original website called North Studio. Reference: Notion. Include project tracker, client contacts and inventory pages.'

async function createFixture({projectType='website',search='',signedIn=true,profileError=null,profilePreferences={},draftPreferences={visualDirection:'minimal'},accounts=true,profileReadError=null}={}) {
  const nodes=new Map(),all=[],calls=[],navigations=[],values=new Map()
  let storageBlocked=false,serial=0,activeSignedIn=signedIn
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>{if(storageBlocked)throw Error('blocked');values.set(key,value)},removeItem:key=>values.delete(key)}
  const options={storage,id:()=>`reference_${++serial}`}
  writeDraft({prompt,preferences:{projectType,...draftPreferences},ready:false},options)
  class Node {
    constructor(id){this.id=id;this.textContent='';this.value='';this.hidden=false;this.disabled=false;this.dataset={};this.attributes={};this.listeners={};this.children=[];all.push(this)}
    addEventListener(name,callback){this.listeners[name]=callback}
    setAttribute(name,value){this.attributes[name]=value}
    querySelectorAll(){return[]}
    replaceChildren(){this.children=[]}
    append(...nodes){this.children.push(...nodes)}
    focus(){}
    reportValidity(){return true}
    click(){if(!this.disabled)return this.listeners.click?.()}
    async submit(){await this.listeners.submit?.({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve))}
  }
  const get=id=>{if(!nodes.has(id))nodes.set(id,new Node(id));return nodes.get(id)}
  const radios=Object.entries({projectType:['website','saas','internal-tool','client-portal','other'],visualDirection:['minimal','editorial','bold','professional','custom']}).flatMap(([name,choices])=>choices.map(value=>{const node=new Node(name+'-'+value);node.name=name;node.value=value;node.type='radio';return node}))
  const selects=Object.entries({'experience':'experience','intended-use':'intendedUse','workspace-layout':'workspaceLayout'}).map(([id,name])=>{const node=get(id);node.name=name;return node})
  get('onboarding-form').querySelectorAll=selector=>selector==='input[type=radio]'?radios:selector==='select'?selects:[]
  const api={
    async config(){calls.push(['config']);return{enabled:accounts,configured:accounts,providers:accounts?['email','google']:[],emailMode:'verified',persistence:'durable',features:{passwordRecovery:true}}},
    async session(){calls.push(['session']);return activeSignedIn?{user:{id:'reference_owner'},session:{id:'session_reference'}}:null},
    async signIn(){calls.push(['signIn']);activeSignedIn=true},
    async profile(){calls.push(['profile']);if(profileReadError)throw profileReadError;return{preferences:profilePreferences}},
    async saveProfile(preferences){calls.push(['saveProfile',preferences]);if(profileError)throw profileError},
    bindUser(id){calls.push(['bindUser',id])},setReturnMode(value){calls.push(['returnMode',value])},
  }
  const context={URL,FormData:class {constructor(form){this.form=form}entries(){return[...this.form.querySelectorAll('input[type=radio]').filter(node=>node.checked),...this.form.querySelectorAll('select').filter(node=>node.value)].map(node=>[node.name,node.value])}},document:{getElementById:get,createElement:tag=>new Node(tag),querySelectorAll:()=>all,addEventListener(){}},window:{addEventListener(){}},
    location:{href:'https://compass.example/create'+search,search,assign:path=>navigations.push(path)},history:{replaceState(){}},
    createAccountApi:()=>api,createAccountViews:()=>({cancel(){},render(){}}),accountEntry,resolveCreateEntry,AccountRequestError,accountErrorText,isAccountChanged,allowedEmail,
    applicationEntryPreferences,readDraft:()=>readDraft(options),writeDraft:value=>writeDraft(value,options),validPrompt,normalizePreferences,
  }
  vm.runInNewContext(source,context);await context.started
  return{get,calls,navigations,storage,radios,read:()=>readDraft(options),blockStorage(){storageBlocked=true}}
}

test('a target-only idea inherits account style and layout while keeping its explicit build target',async()=>{
  const ui=await createFixture({draftPreferences:{},profilePreferences:{projectType:'internal-tool',visualDirection:'editorial',workspaceLayout:'preview',experience:'designer'}})
  assert.equal(ui.calls.filter(([name])=>name==='profile').length,1)
  assert.equal(ui.radios.find(node=>node.name==='projectType' && node.value==='website').checked,true)
  assert.equal(ui.radios.find(node=>node.name==='visualDirection' && node.value==='editorial').checked,true)
  assert.equal(ui.get('workspace-layout').value,'preview')
  await ui.get('onboarding-form').submit()
  assert.deepEqual(ui.read().preferences,{projectType:'website',visualDirection:'editorial',experience:'designer',workspaceLayout:'preview'})
  assert.equal(applicationDraft(ui.read()),false)
  assert.deepEqual(ui.navigations,['/workspace'])
})

test('a reference plan keeps its explicit minimal style and app target while inheriting an account layout',async()=>{
  const ui=await createFixture({projectType:'internal-tool',search:'?app=1',profilePreferences:{projectType:'website',visualDirection:'editorial',workspaceLayout:'conversation'}})
  assert.equal(ui.radios.find(node=>node.name==='projectType' && node.value==='internal-tool').checked,true)
  assert.equal(ui.radios.find(node=>node.name==='visualDirection' && node.value==='minimal').checked,true)
  assert.equal(ui.get('workspace-layout').value,'conversation')
  await ui.get('onboarding-form').submit()
  assert.deepEqual(ui.read().preferences,{projectType:'internal-tool',visualDirection:'minimal',workspaceLayout:'conversation'})
  assert.equal(applicationDraft(ui.read()),true)
})

test('signing in after a target-only idea loads account defaults without replacing the reviewed target',async()=>{
  const ui=await createFixture({signedIn:false,draftPreferences:{},profilePreferences:{projectType:'internal-tool',visualDirection:'editorial',workspaceLayout:'preview'}})
  assert.equal(ui.calls.some(([name])=>name==='profile'),false)
  await ui.get('signin-mode').click()
  ui.get('account-email').value='owner@example.test';ui.get('account-password').value='Synthetic test password only 123!'
  await ui.get('account-form').submit()
  assert.equal(ui.get('onboarding-form').hidden,false)
  assert.equal(ui.calls.filter(([name])=>name==='profile').length,1)
  assert.equal(ui.radios.find(node=>node.name==='projectType' && node.value==='website').checked,true)
  assert.equal(ui.radios.find(node=>node.name==='visualDirection' && node.value==='editorial').checked,true)
  assert.equal(ui.get('workspace-layout').value,'preview')
  assert.equal(ui.read().ready,false)
  assert.equal(ui.read().prompt,prompt)
  assert.deepEqual(ui.navigations,[])
})

test('an accounts-disabled app entry explicitly presents a website preview before continuing',async()=>{
  const ui=await createFixture({projectType:'internal-tool',search:'?app=1',accounts:false})
  assert.equal(ui.get('onboarding-form').hidden,false)
  assert.equal(ui.get('create-lede').textContent,'Website preview. Data apps need an account.')
  assert.equal(ui.get('start-building').textContent,'Build website preview →')
  assert.equal(ui.radios.find(node=>node.name==='projectType' && node.value==='website').checked,true)
  assert.equal(ui.calls.some(([name])=>name==='session' || name==='profile'),false)
  await ui.get('skip-onboarding').click()
  assert.deepEqual(ui.read().preferences,{projectType:'website'})
  assert.deepEqual(ui.navigations,['/demo?from=create'])
})

test('skipping optional onboarding keeps an explicit website reference out of the data-app classifier',async()=>{
  const ui=await createFixture()
  assert.equal(ui.get('onboarding-form').hidden,false)
  assert.equal(ui.get('onboarding-prompt').textContent,prompt)
  await ui.get('skip-onboarding').click()
  const draft=ui.read()
  assert.equal(draft.prompt,prompt)
  assert.deepEqual(draft.preferences,{projectType:'website'})
  assert.equal(draft.ownerId,'reference_owner')
  assert.equal(draft.ready,true)
  assert.equal(applicationDraft(draft),false,'reference words must not override the chosen website target')
  assert.equal(draftCanAutoBuild(draft,{accountMode:true,userId:'reference_owner'}),true)
  assert.equal(draftCanAutoBuild(draft,{accountMode:true,userId:'another_owner'}),false)
  assert.deepEqual(ui.navigations,['/workspace'])
})

test('skipping optional onboarding keeps a data-app reference while binding only the verified account',async()=>{
  const ui=await createFixture({projectType:'internal-tool',search:'?app=1'})
  await ui.get('skip-onboarding').click()
  const draft=ui.read()
  assert.equal(draft.prompt,prompt)
  assert.deepEqual(draft.preferences,{projectType:'internal-tool'})
  assert.equal(draft.ownerId,'reference_owner')
  assert.equal(applicationDraft(draft),true)
  assert.deepEqual(ui.navigations,['/workspace'])
})

test('the explicit guest website fallback preserves reference text but cannot run a private data app',async()=>{
  const ui=await createFixture({projectType:'internal-tool',search:'?app=1',signedIn:false})
  assert.equal(ui.get('auth-step').hidden,false)
  await ui.get('continue-guest').click()
  assert.equal(ui.get('onboarding-form').hidden,false)
  await ui.get('skip-onboarding').click()
  const draft=ui.read()
  assert.equal(draft.prompt,prompt)
  assert.deepEqual(draft.preferences,{projectType:'website'})
  assert.equal(draft.ownerId,undefined)
  assert.equal(applicationDraft(draft),false)
  assert.equal(draftCanAutoBuild(draft),true)
  assert.equal(draftCanAutoBuild(draft,{accountMode:true,userId:'reference_owner'}),false)
  assert.deepEqual(ui.navigations,['/demo?from=create'])
  assert.equal(ui.calls.some(([name])=>name==='saveProfile'),false)
})

test('blocked handoff storage and changed accounts retain the reference and never navigate or arm generation',async()=>{
  const blocked=await createFixture()
  const stored=blocked.storage.getItem(DRAFT_KEY)
  blocked.blockStorage();await blocked.get('skip-onboarding').click()
  assert.equal(blocked.storage.getItem(DRAFT_KEY),stored)
  assert.equal(blocked.read().ready,false)
  assert.equal(blocked.calls.some(([name])=>name==='saveProfile'),false)
  assert.deepEqual(blocked.navigations,[])
  assert.match(blocked.get('create-status').textContent,/browser can’t keep your idea/)
  const changed=await createFixture({profileError:new AccountRequestError('account_changed',403)})
  await changed.get('skip-onboarding').click()
  assert.equal(changed.read().prompt,prompt)
  assert.equal(changed.read().preferences.projectType,'website')
  assert.equal(changed.read().ready,false)
  assert.equal(changed.get('auth-step').hidden,false)
  assert.deepEqual(changed.navigations,[])
  const changedRead=await createFixture({profileReadError:new AccountRequestError('account_changed',403)})
  assert.equal(changedRead.read().prompt,prompt)
  assert.equal(changedRead.read().ready,false)
  assert.equal(changedRead.get('auth-step').hidden,false)
  assert.deepEqual(changedRead.navigations,[])
})

test('Google callbacks carry only the controlled create route while the reference stays tab-local',async()=>{
  const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}
  writeDraft({prompt,preferences:{projectType:'internal-tool'},ready:false},{storage})
  const before=storage.getItem(DRAFT_KEY),calls=[]
  const api=createAccountApi({origin:'https://compass.example',fetch:async(path,options)=>{calls.push({path,body:JSON.parse(options.body)});return{ok:true,status:200,json:async()=>({url:'https://accounts.google.com/o/oauth2/v2/auth'})}}})
  api.setReturnMode('project');await api.social('google')
  assert.equal(calls[0].body.callbackURL,'https://compass.example/create')
  assert.equal(calls[0].body.errorCallbackURL,'https://compass.example/create?oauth=failed')
  assert.equal(JSON.stringify(calls).includes(prompt),false)
  assert.equal(storage.getItem(DRAFT_KEY),before)
  assert.deepEqual(resolveCreateEntry({search:new URL(calls[0].body.callbackURL).search,hasDraft:true,config:{enabled:true,configured:true},signedIn:true}),{mode:'project',step:'onboarding'})
})
