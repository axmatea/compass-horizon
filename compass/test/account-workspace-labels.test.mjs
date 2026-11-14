import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { normalizeAccountConfig, allowedEmail, accountErrorText, isAccountChanged, AccountRequestError, safeSocialRedirect } from '../src/create/flow.mjs';

const workspaceSource=(await readFile(new URL('../src/account/workspace.mjs',import.meta.url),'utf8')).replace(/^import .+\n/gm,'').replace('export async function','async function');
const manageSource=(await readFile(new URL('../src/create/manage.mjs',import.meta.url),'utf8')).replace(/^import .+\n/gm,'').replaceAll('export function','function');
class Node {
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.listeners={};this.attributes={};this.dataset={};this.hidden=false;this.disabled=false;this._text='';this.classList={add(){}};this.value=''}
  set textContent(value){this._text=String(value);this.children=[]}get textContent(){return this._text+this.children.map(child=>child.textContent).join('')}
  append(...items){this.children.push(...items)}prepend(...items){this.children.unshift(...items)}replaceChildren(...items){this._text='';this.children=items}before(){}after(){}
  setAttribute(key,value){this.attributes[key]=String(value)}addEventListener(type,handler){(this.listeners[type] ||= []).push(handler)}
  async fire(type){for(const handler of this.listeners[type] || [])await handler({target:this,preventDefault(){}})}
  focus(){}reportValidity(){return true}all(){return this.children.flatMap(child=>[child,...child.all()])}querySelectorAll(){return []}
}
const durableConfig={enabled:true,configured:true,providers:['google'],emailMode:'disabled',persistence:'durable',features:{accountManagement:true,accountLinking:true}};
async function workspaceFixture({config=durableConfig,billing={mode:'disabled',billingEnabled:false,creditsEnabled:false,offers:[]}}={}) {
  const created=[],selectors=new Map(),calls=[],messages=[];
  const make=tag=>{const item=new Node(tag);created.push(item);return item};
  for(const selector of ['main','h1','.project-heading','.project-buttons','.sd','.skip','#projects-panel','[data-app-preview]'])selectors.set(selector,make());
  const project={name:'Forma',revisions:[{id:'revision_one',render:{html:'<!doctype html><p>Forma</p>'}}]};
  const fetch=async(url,options={})=>{
    const path=url.replace('/api/account/','');calls.push({path,...options});
    const results={me:{userId:'owner_one'},config,profile:{preferences:{}},capabilities:{admin:false},billing:{status:billing},usage:{operations:[{count:2}],attempts:[]},publications:{publications:[]}};
    const data=path==='projects'?(options.method==='POST'?{project:{...project,id:'project_one'}}:{projects:[{id:'project_one',name:'Forma'}]}):results[path];
    if(!data)throw Error('Unexpected test request '+path);
    return {ok:true,json:async()=>data};
  };
  const document={body:make('body'),createElement:make,querySelector:selector=>selectors.get(selector),addEventListener(){}};
  const context={document,window:{addEventListener(){}},fetch,normalizeAccountConfig,draftCanAutoBuild:()=>false,applicationDraft:()=>false,
    disarmDraft(){},connectionActions(){},location:{replace(){},assign(){}},confirm:()=>true,crypto:{randomUUID:()=> 'synthetic-key'},URL,
    mountApplicationWorkspace:async({container})=>{container.querySelector=()=>({});return {show(){},hide(){}}}};
  vm.runInNewContext(workspaceSource+';globalThis.mount=mountAccountWorkspace',context);
  const api=await context.mount({getProject:()=>project,onLoad(){},onClear(){},onMessage:message=>messages.push(message)});
  return {created,calls,messages,api,button:label=>created.find(item=>item.tagName==='BUTTON' && item.textContent===label)};
}

test('durable workspaces save with account labels and no temporary-storage warning',async()=>{
  const ui=await workspaceFixture();
  assert.equal(ui.created.find(item=>item.className==='account-preview-note').hidden,true);
  const save=ui.button('Save to account');assert.ok(save);
  await ui.button('Websites').fire('click');ui.api.update();assert.equal(save.disabled,false);
  await save.fire('click');assert.equal(ui.messages.at(-1),'Saved to your account.');
  await ui.button('Saved websites').fire('click');
  assert.ok(ui.created.some(item=>item.textContent==='Saved to your account.'));
  await ui.button('Publishing').fire('click');
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(ui.created.some(item=>item.textContent==='Anyone with the link can view a published page.'));
  assert.ok(ui.calls.some(call=>call.path==='config'));
});

test('disposable preview workspaces retain a visible storage warning',async()=>{
  const ui=await workspaceFixture({config:{...durableConfig,persistence:'ephemeral-preview'}});
  const note=ui.created.find(item=>item.className==='account-preview-note');
  assert.equal(note.hidden,false);assert.match(note.textContent,/temporary/);
  const save=ui.button('Save to preview');assert.ok(save);
  await ui.button('Websites').fire('click');ui.api.update();await save.fire('click');
  assert.equal(ui.messages.at(-1),'Saved. Preview storage is temporary.');
});

const offers=[{id:'pack',kind:'credits',credits:1000,unitAmount:1250,currency:'usd'},
  {id:'plan',kind:'subscription',credits:2000,unitAmount:2400,currency:'usd',interval:'month',intervalCount:2}];
test('live checkout displays only server-returned amounts and cadence with live billing labels',async()=>{
  const ui=await workspaceFixture({billing:{mode:'live',billingEnabled:true,liveChargesEnabled:true,offers}});
  await ui.button('Billing').fire('click');
  assert.ok(ui.button('Buy 1,000 credits · $12.50'));
  assert.ok(ui.button('Subscribe · $24.00 / 2 months'));
  assert.ok(ui.button('Manage billing'));
  assert.ok(ui.created.some(item=>item.textContent==='Payments by Stripe.'));
  assert.ok(!ui.created.some(item=>/test checkout|Manage test billing/.test(item.textContent)));
});

test('test checkout is clearly marked and unverified live billing offers remain unavailable',async()=>{
  const testUI=await workspaceFixture({billing:{mode:'test',billingEnabled:true,offers}});
  await testUI.button('Billing').fire('click');
  assert.ok(testUI.button('Test 1,000 credits · $12.50'));
  assert.ok(testUI.button('Manage test billing'));
  assert.ok(testUI.created.some(item=>item.textContent==='Test mode · no live charges.'));
  for(const billing of [{mode:'live',billingEnabled:true,liveChargesEnabled:false,offers},{mode:'unknown',billingEnabled:true,offers},{mode:'live',billingEnabled:false,liveChargesEnabled:true,offers}]) {
    const ui=await workspaceFixture({billing});await ui.button('Billing').fire('click');
    assert.ok(!ui.created.some(item=>item.tagName==='BUTTON' && /Buy|Subscribe|Manage billing|Manage test billing/.test(item.textContent)));
  }
});

test('incomplete or unsupported price metadata cannot create a checkout action',async()=>{
  const invalid=[{...offers[0],unitAmount:undefined},{...offers[0],currency:'unknown'},{...offers[0],credits:-1},{...offers[1],interval:undefined},{...offers[1],intervalCount:0}];
  const ui=await workspaceFixture({billing:{mode:'live',billingEnabled:true,liveChargesEnabled:true,offers:invalid}});
  await ui.button('Billing').fire('click');
  assert.ok(!ui.created.some(item=>item.tagName==='BUTTON' && /Buy|Subscribe/.test(item.textContent)));
});

test('social-only config retains disabled email and suppresses contradictory email capabilities',()=>{
  const config=normalizeAccountConfig({...durableConfig,providers:['email','google'],features:{accountManagement:true,passwordRecovery:true,emailVerification:true}});
  assert.equal(config.emailMode,'disabled');assert.deepEqual(config.providers,['google']);
  assert.equal(config.features.passwordRecovery,false);assert.equal(config.features.emailVerification,false);
  assert.equal(allowedEmail('person@example.com',config),false);
  assert.equal(normalizeAccountConfig({...durableConfig,configured:false}).persistence,'ephemeral-preview');
});

test('social-only account management keeps sessions and linking while hiding email and password forms',async()=>{
  const root=new Node(),context={document:{createElement:tag=>new Node(tag)},accountErrorText,isAccountChanged,AccountRequestError,safeSocialRedirect};
  vm.runInNewContext(manageSource+';globalThis.createViews=createAccountViews',context);
  const views=context.createViews({root,api:{sessions:async()=>[{id:'session_one'}],accounts:async()=>[{id:'identity_one',providerId:'google'}]},onMessage(){},onExpired(){},onUser(){},onPreferences(){}});
  const config=normalizeAccountConfig({...durableConfig,providers:['google','github'],features:{...durableConfig.features,passwordRecovery:true,emailVerification:true}});
  await views.render('account',{config,user:{id:'owner_one',email:'person@example.com'}});
  assert.match(root.textContent,/1 active session/);assert.match(root.textContent,/Sign-in methodsGoogle/);
  assert.ok(root.all().some(item=>item.tagName==='BUTTON' && item.textContent==='Connect GitHub'));
  const password=root.all().find(item=>item.tagName==='FORM' && item.textContent.startsWith('Password'));
  assert.equal(password.hidden,true);
  assert.ok(!root.all().some(item=>item.tagName==='FORM' && item.textContent.startsWith('Email')));
  for(const view of ['recover','reset','verify']) {
    await views.render(view,{config,user:null,resetToken:'synthetic_token_12345678'});
    assert.ok(!root.all().some(item=>item.tagName==='FORM'));
    assert.doesNotMatch(root.textContent,/preview/);
  }
});
