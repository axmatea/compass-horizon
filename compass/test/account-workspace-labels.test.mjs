import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { normalizeAccountConfig, allowedEmail, accountErrorText, isAccountChanged, AccountRequestError, safeSocialRedirect, resolveCreateEntry, ACCOUNT_REAUTH_PATH } from '../src/create/flow.mjs';
import {accountEntry} from '../src/create/manage.mjs';

const workspaceSource=(await readFile(new URL('../src/account/workspace.mjs',import.meta.url),'utf8')).replace(/^import .+\n/gm,'').replace('export async function','async function');
const connectionSource=(await readFile(new URL('../src/account/connections.mjs',import.meta.url),'utf8')).replace('export function','function');
const manageSource=(await readFile(new URL('../src/create/manage.mjs',import.meta.url),'utf8')).replace(/^import .+\n/gm,'').replaceAll('export function','function');
class Node {
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.listeners={};this.attributes={};this.dataset={};this.hidden=false;this.disabled=false;this._text='';this.classList={add(){}};this.value=''}
  set textContent(value){this._text=String(value);this.children=[]}get textContent(){return this._text+this.children.map(child=>child.textContent).join('')}
  append(...items){this.children.push(...items)}prepend(...items){this.children.unshift(...items)}replaceChildren(...items){this._text='';this.children=items}before(){}after(){}
  setAttribute(key,value){this.attributes[key]=String(value)}addEventListener(type,handler){(this.listeners[type] ||= []).push(handler)}
  async fire(type){for(const handler of this.listeners[type] || [])await handler({target:this,preventDefault(){}})}
  focus(){}reportValidity(){return true}all(){return this.children.flatMap(child=>[child,...child.all()])}querySelectorAll(){return []}
}

test('GitHub manifest controls require an open application and an unchanged review before apply',async()=>{
  const view={document:{createElement:tag=>new Node(tag)}};
  vm.runInNewContext(connectionSource+';globalThis.actions=connectionActions',view);
  const row=new Node(), requests=[], statuses=[];
  const provider={provider:'github',configured:true,connected:true,manifestImport:true};
  let target={id:'app_qa',version:1};
  const request=async (path,options)=>{
    requests.push({path,body:JSON.parse(options.body)});
    if(path.endsWith('/review'))return {repository:'owner/project',branch:'main',commitSha:'a'.repeat(40),changed:true,current:{title:'Old app'},manifest:{title:'New app'},ticket:'synthetic-reviewed-ticket'};
    return {application:{version:target.version+1}};
  };
  view.actions({provider,row:new Node(),request,onStatus(){},getImportTarget:()=>null});
  assert.equal(requests.length,0);
  const hidden=new Node();
  view.actions({provider:{...provider,manifestImport:false},row:hidden,request,onStatus(){},getImportTarget:()=>target});
  assert.ok(!hidden.all().some(node=>node.textContent==='Import app manifest'));
  view.actions({provider,row,request,onStatus:message=>statuses.push(message),getImportTarget:()=>target});
  const form=row.all().find(node=>node.tagName==='FORM' && node.all().some(field=>field.name==='branch'));
  const get=name=>form.all().find(node=>node.name===name);
  const apply=form.all().find(node=>node.textContent==='Apply manifest');
  assert.equal(apply.hidden,true);
  get('repository').value='owner/project';get('branch').value='main';
  await form.fire('submit');
  assert.equal(requests[0].path,'apps/app_qa/github-import/review');
  assert.deepEqual(requests[0].body,{repository:'owner/project',branch:'main',version:1});
  assert.match(form.textContent,/Old app/);assert.match(form.textContent,/New app/);
  assert.equal(apply.hidden,false);
  target={...target,version:2};
  await apply.fire('click');
  assert.equal(requests.length,1);assert.equal(apply.hidden,true);
  assert.match(statuses.at(-1),/project or destination changed/i);
  await form.fire('submit');await apply.fire('click');
  assert.deepEqual(requests.at(-1),{path:'apps/app_qa/github-import/apply',body:{ticket:'synthetic-reviewed-ticket'}});
  assert.match(statuses.at(-1),/Imported version 3/);assert.equal(apply.hidden,true);
});
const durableConfig={enabled:true,configured:true,providers:['google'],emailMode:'disabled',persistence:'durable',features:{accountManagement:true,accountLinking:true}};
async function verificationView(options={}) {
  const root=new Node(),calls=[],config=normalizeAccountConfig({...durableConfig,providers:['email','google'],emailMode:'verification',features:{emailVerification:true}});
  const context={document:{createElement:tag=>new Node(tag)},accountErrorText,isAccountChanged,AccountRequestError,safeSocialRedirect,ACCOUNT_REAUTH_PATH};
  vm.runInNewContext(manageSource+';globalThis.createViews=createAccountViews',context);
  const views=context.createViews({root,api:{resendVerification:async()=>calls.push('resend')},onMessage(){},onExpired(){},onUser(){},onPreferences(){}});
  await views.render('verify',{config,...options});return {root,calls,config};
}

test('verification link errors take precedence over a different verified browser account',async()=>{
  const {root,calls}=await verificationView({user:{id:'owner_other',email:'other@example.test',emailVerified:true},linkError:true,hasDraft:true});
  assert.match(root.textContent,/Verification didn’t finish/);
  assert.match(root.textContent,/Signed in as other@example\.test/);
  assert.doesNotMatch(root.textContent,/Email verified\.|This account's email is verified|Continue your idea|Open workspace/);
  assert.equal(root.all().find(item=>item.tagName==='A' && item.textContent==='Use another account').href,ACCOUNT_REAUTH_PATH);
  assert.deepEqual(calls,[]);
});

test('signed-out verification offers actual sign-in while preserving pending-idea routing and never trusting success query flags',async()=>{
  const {root,calls,config}=await verificationView({hasDraft:true});
  assert.match(root.textContent,/Open the link in your email, then sign in/);
  assert.doesNotMatch(root.textContent,/Email verified\.|This account's email is verified/);
  const signIn=root.all().find(item=>item.tagName==='A' && item.textContent==='Sign in');assert.ok(signIn);
  assert.deepEqual(resolveCreateEntry({search:new URL(signIn.href,'https://compass.example').search,hasDraft:true,config}),{mode:'account',step:'auth'});
  assert.equal(root.all().filter(item=>item.tagName==='FORM').length,1);
  assert.deepEqual(calls,[]);
  assert.equal(accountEntry('https://compass.example/create?view=verify&verified=1').linkError,false);
});

test('verification status identifies the actual signed-in account rather than attributing it to the email link',async()=>{
  const {root,calls}=await verificationView({user:{id:'owner_other',email:'other@example.test',emailVerified:true},hasDraft:true});
  assert.match(root.textContent,/Signed in as other@example\.test/);assert.match(root.textContent,/This account's email is verified/);
  assert.equal(root.all().find(item=>item.tagName==='A' && item.textContent==='Continue your idea').href,'/create');
  assert.deepEqual(calls,[]);
});

async function workspaceFixture({config=durableConfig,billing={mode:'disabled',billingEnabled:false,creditsEnabled:false,offers:[]},onReference,beforeNewProject,canLeaveApp=()=>true}={}) {
  const created=[],selectors=new Map(),calls=[],messages=[],tour={opens:0,destroyed:false};
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
    mountPlatformTour:({trigger})=>{trigger.addEventListener('click',()=>tour.opens++);return{destroy(){tour.destroyed=true}}},
    disarmDraft(){},connectionActions(){},location:{replace(){},assign(){}},confirm:()=>true,crypto:{randomUUID:()=> 'synthetic-key'},URL,
    mountApplicationWorkspace:async({container})=>{container.querySelector=()=>({});return {show(){},hide(){},canLeave:canLeaveApp}}};
  vm.runInNewContext(workspaceSource+';globalThis.mount=mountAccountWorkspace',context);
  const api=await context.mount({getProject:()=>project,onLoad(){},onClear(){},onMessage:message=>messages.push(message),onReference,beforeNewProject});
  return {created,calls,messages,api,tour,button:label=>created.find(item=>item.tagName==='BUTTON' && item.textContent===label)};
}

test('Platform Tour is visible in the workspace sidebar and opening help makes no project or account requests',async()=>{
  const ui=await workspaceFixture(),button=ui.button('Platform Tour'),before=JSON.stringify(ui.calls);
  assert.ok(button);assert.equal(button.hidden,false);assert.equal(button.type,'button');
  assert.ok(ui.created.find(item=>item.tagName==='ASIDE').children.includes(button));
  await button.fire('click');assert.equal(ui.tour.opens,1);assert.equal(JSON.stringify(ui.calls),before);assert.deepEqual(ui.messages,[]);
  ui.api.destroy();assert.equal(ui.tour.destroyed,true);
});

test('account reference entry uses the active project guard and never starts a build by mounting',async()=>{
  let launcher,disposed=false,websiteChecks=0,appChecks=0
  const ui=await workspaceFixture({beforeNewProject:()=>{websiteChecks++;return false},canLeaveApp:()=>{appChecks++;return false},onReference:options=>{launcher=options;return{destroy(){disposed=true}}}})
  assert.equal(ui.button('Start from an app').hidden,false)
  const before=ui.calls.length
  assert.equal(launcher.defaultTarget,'app');assert.equal(launcher.beforeContinue(),false);assert.equal(appChecks,1)
  await ui.button('Websites').fire('click')
  assert.equal(launcher.beforeContinue(),false);assert.equal(websiteChecks,1)
  assert.equal(ui.calls.length,before)
  launcher.onError('Retry the planner');assert.ok(ui.created.some(node=>node.textContent==='Retry the planner' && node.hidden===false))
  ui.api.destroy();assert.equal(disposed,true)
});

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
  const root=new Node(),context={document:{createElement:tag=>new Node(tag)},accountErrorText,isAccountChanged,AccountRequestError,safeSocialRedirect,ACCOUNT_REAUTH_PATH};
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

test('linked methods load while session details wait, and stale-session errors offer explicit reauthentication',async()=>{
  const root=new Node(),messages=[],expired=[];
  let rejectSessions;
  const pendingSessions=new Promise((_,reject)=>{rejectSessions=reject});
  const context={document:{createElement:tag=>new Node(tag)},accountErrorText,isAccountChanged,AccountRequestError,safeSocialRedirect,ACCOUNT_REAUTH_PATH};
  vm.runInNewContext(manageSource+';globalThis.createViews=createAccountViews',context);
  const views=context.createViews({root,api:{sessions:()=>pendingSessions,accounts:async()=>[{id:'google_one',providerId:'google'}]},
    onMessage:message=>messages.push(message),onExpired:error=>expired.push(error),onUser(){},onPreferences(){}});
  const rendered=views.render('account',{config:normalizeAccountConfig(durableConfig),user:{id:'owner_one',email:'person@example.com'}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(root.textContent,/Sign-in methodsGoogle/);
  assert.match(root.textContent,/Checking active sessions/);
  rejectSessions(new AccountRequestError('SESSION_NOT_FRESH',403));await rendered;
  assert.match(root.textContent,/Sign in again to view active sessions/);
  assert.match(root.textContent,/Sign-in methodsGoogle/);
  const reauthenticate=root.all().find(item=>item.tagName==='A'&&item.textContent==='Sign in again');
  assert.equal(reauthenticate.href,ACCOUNT_REAUTH_PATH);assert.equal(reauthenticate.hidden,false);
  assert.deepEqual(messages,[]);assert.deepEqual(expired,[]);
});

test('a linked-account load failure does not replace successfully loaded session details',async()=>{
  const root=new Node(),messages=[];
  const context={document:{createElement:tag=>new Node(tag)},accountErrorText,isAccountChanged,AccountRequestError,safeSocialRedirect,ACCOUNT_REAUTH_PATH};
  vm.runInNewContext(manageSource+';globalThis.createViews=createAccountViews',context);
  const views=context.createViews({root,api:{sessions:async()=>[{id:'one'}],accounts:async()=>{throw new AccountRequestError('AUTH_UNAVAILABLE',503)}},
    onMessage:message=>messages.push(message),onExpired(){},onUser(){},onPreferences(){}});
  await views.render('account',{config:normalizeAccountConfig(durableConfig),user:{id:'owner_one',email:'person@example.com'}});
  assert.match(root.textContent,/1 active session/);assert.match(root.textContent,/Sign-in methods unavailable/);
  assert.doesNotMatch(root.textContent,/Session details unavailable/);
  assert.equal(root.all().find(item=>item.tagName==='A'&&item.textContent==='Sign in again').hidden,true);
  assert.equal(messages.length,1);
});
