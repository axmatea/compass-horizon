import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import Stripe from 'stripe';
import {createCompassServer} from '../server.mjs';

const origin='http://localhost:8779',password='Platform secure password 84!';
async function fixture(t,enabled=true,extra={},fetchImpl) {
  const root=await mkdtemp(join(tmpdir(),'compass-platform-api-')),assets=join(root,'public');await mkdir(assets);
  await Promise.all(['index','demo','create','studio','plan'].map(name=>writeFile(join(assets,name+'.html'),'<!doctype html><h1>'+name+'</h1>')));
  const env={NODE_ENV:'test',STATIC_ROOT:assets,BUILDER_STEP_MS:'0',COMPASS_DEMO_MODE:'examples',...(enabled?{COMPASS_ACCOUNT_MODE:'staging',COMPASS_ACCOUNT_ORIGIN:origin,COMPASS_ACCOUNT_DATABASE:join(root,'isolated.sqlite'),BETTER_AUTH_SECRET:randomBytes(32).toString('base64url')}:{}),...extra};
  let app,network;
  async function start(){app=createCompassServer({env,...(fetchImpl?{fetchImpl}:{})});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');network='http://127.0.0.1:'+app.server.address().port}
  await start();t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true})});
  function request(path,{method='GET',body,cookie,headers={}}={}) {
    return new Promise((resolve,reject)=>{
      const req=httpRequest(network+path,{method,headers:{host:new URL(origin).host,...(!['GET','HEAD'].includes(method)?{origin,'content-type':'application/json'}:{}),...(cookie?{cookie}:{}),...headers}},res=>{
        const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);res.on('end',()=>{
          const headers=new Headers();for(const [key,value] of Object.entries(res.headers))for(const item of Array.isArray(value)?value:value===undefined?[]:[value])headers.append(key,item);
          resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers}));
        });
      });req.on('error',reject);if(body!==undefined)req.write(typeof body==='string'?body:JSON.stringify(body));req.end();
    });
  }
  async function account(name){const res=await request('/api/auth/sign-up/email',{method:'POST',body:{name,email:name+'@platform.test',password}});assert.equal(res.status,200,await res.clone().text());const cookie=res.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');const me=await request('/api/account/me',{cookie});assert.equal(me.status,200,await me.clone().text());return {cookie,...await me.json()}}
  const restart=async()=>{await app.close();await start()};return {request,account,restart,env};
}
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json()};
const action=(user,method,body,key)=>({method,cookie:user.cookie,body,headers:key?{'idempotency-key':key}:{}});

test('new platform routes stay off on production defaults and public builder is preserved',async t=>{
  const {request}=await fixture(t,false);
  assert.equal((await request('/api/account/apps')).status,503);
  assert.equal((await request('/api/billing/webhook',{method:'POST',body:{}})).status,503);
  assert.equal((await request('/published/page_guessed')).status,404);
  assert.equal((await request('/workspace')).status,404);
  assert.equal((await request('/demo')).status,200);
  const build=await json(await request('/api/site/turn',{method:'POST',body:{text:'A bright bakery website'}}));assert.equal(build.source,'prepared');
});

test('real owner sessions protect app CRUD, records, revisions, idempotent generation and exports across restart',async t=>{
  const {request,account,restart}=await fixture(t);const a=await account('alpha'),b=await account('beta');
  assert.equal((await request('/api/account/apps')).status,401);
  assert.equal((await request('/api/account/apps',action(a,'POST',{text:'Tracker'}))).status,400);
  assert.equal((await request('/api/account/apps',{...action(a,'POST',{text:'Tracker'},'platform_invalid_origin'),headers:{origin:'https://attacker.test','idempotency-key':'platform_invalid_origin'}})).status,403);
  assert.equal((await request('/api/account/apps',{cookie:b.cookie,headers:{'x-compass-user':a.userId}})).status,403);
  const input={text:'A task tracker called Orbit'},key='platform_create_12345';
  const initial=await json(await request('/api/account/apps',action(a,'POST',input,key))),app=initial.application;
  assert.equal(initial.source,'prepared');assert.equal(initial.modelUsed,false);assert.equal(app.manifest.title,'Orbit');
  assert.deepEqual(await json(await request('/api/account/apps',action(a,'POST',input,key))),initial);
  assert.equal((await request('/api/account/apps',action(a,'POST',{text:'Other app'},key))).status,409);
  assert.equal((await request('/api/account/apps/'+app.id,{cookie:b.cookie})).status,404);
  assert.deepEqual((await json(await request('/api/account/apps',{cookie:b.cookie}))).applications,[]);
  const path='/api/account/apps/'+app.id;
  assert.equal((await request(path+'/source',{cookie:b.cookie})).status,404);
  assert.equal((await request(path+'/records',action(b,'POST',{data:{title:'Stolen',status:'To do'}}))).status,404);
  const saved=await json(await request(path+'/records',action(a,'POST',{data:{title:'QA task',status:'To do'}}))),record=saved.record;
  assert.equal(record.data.title,'QA task');
  assert.equal((await request(path+'/records/'+record.id,action(b,'PUT',{data:{title:'Stolen',status:'Done'}}))).status,404);
  assert.equal((await request(path+'/records',action(a,'POST',{data:{title:'Extra',status:'To do',owner:b.userId}}))).status,400);
  const refined=await json(await request(path+'/refine',action(a,'POST',{text:'Add a priority field and make it dark'},'platform_refine_12345')));
  assert.equal(refined.application.version,2);assert.equal(refined.application.manifest.theme.mode,'dark');
  assert.ok(refined.application.manifest.entity.fields.some(f=>f.key==='priority'));assert.equal(refined.changed,true);
  const unchangedInput={text:'Write arbitrary JavaScript with a payment processor'};
  const unchanged=await json(await request(path+'/refine',action(a,'POST',unchangedInput,'platform_unchanged_1234')));assert.equal(unchanged.changed,false);assert.equal(unchanged.application.version,2);assert.match(unchanged.message,/Try changing/);
  assert.deepEqual(await json(await request(path+'/refine',action(a,'POST',unchangedInput,'platform_unchanged_1234'))),unchanged);
  const edited=await json(await request(path+'/records/'+record.id,action(a,'PUT',{data:{title:'QA task',status:'Done',priority:'High'}})));assert.equal(edited.record.data.priority,'High');
  const theme={...refined.application.manifest.theme,accent:'rose'};
  assert.equal((await request(path+'/design',action(a,'PUT',{theme,version:1}))).status,409);
  const designed=await json(await request(path+'/design',action(a,'PUT',{theme,version:2})));assert.equal(designed.application.version,3);
  const revisions=await json(await request(path+'/revisions',{cookie:a.cookie}));assert.deepEqual(revisions.revisions.map(r=>r.version),[3,2,1]);
  const restored=await json(await request(path+'/restore',action(a,'POST',{version:1})));assert.equal(restored.application.version,4);assert.equal(restored.application.manifest.theme.mode,'light');
  const records=await json(await request(path+'/records',{cookie:a.cookie}));assert.equal(records.records[0].data.title,'QA task');assert.equal(records.records[0].data.priority,'High','restore retains business fields');
  const preview=await request(path+'/preview',{cookie:a.cookie});assert.equal(preview.status,200);assert.match(await preview.text(),/compass-app-request/);assert.match(preview.headers.get('content-security-policy'),/sandbox allow-scripts/);assert.equal(preview.headers.get('x-compass-app-version'),'4');
  const dataResponse=await request(path+'/data',{cookie:a.cookie});assert.equal(dataResponse.headers.get('x-compass-app-version'),'4');assert.match(dataResponse.headers.get('content-disposition'),/attachment/);assert.equal(dataResponse.headers.get('cache-control'),'no-store');
  const data=await json(dataResponse);assert.deepEqual(Object.keys(data).sort(),['exportedAt','manifest','records']);assert.deepEqual(data.manifest,restored.application.manifest);assert.equal(data.records.length,1);assert.equal(data.records[0].data.title,'QA task');assert.ok(Number.isFinite(Date.parse(data.exportedAt)));assert.ok(!JSON.stringify(data).includes(a.userId));assert.ok(!JSON.stringify(data).includes(a.sessionId));
  assert.equal((await request(path+'/data',{cookie:b.cookie})).status,404);assert.equal((await request(path+'/data')).status,401);assert.equal((await request(path+'/data',action(a,'POST',{}))).status,405);
  const sourceResponse=await request(path+'/source',{cookie:a.cookie});assert.equal(sourceResponse.headers.get('x-compass-app-version'),'4');
  const source=await json(sourceResponse);assert.equal(source.template,'compass-crud-v1');assert.ok(source.files.some(f=>f.path==='server.mjs'));assert.ok(!JSON.stringify(source).includes('QA task'),'source contains schema, no user records');
  const zip=await request(path+'/export',{cookie:a.cookie});assert.equal(zip.status,200);assert.equal(zip.headers.get('content-type'),'application/zip');assert.equal(zip.headers.get('x-compass-app-version'),'4');assert.equal(Buffer.from(await zip.arrayBuffer()).readUInt32LE(),0x04034b50);
  const workspace=await request('/workspace');assert.equal(workspace.status,200);assert.match(workspace.headers.get('content-security-policy'),/script-src 'self' 'sha256-/);
  await restart();assert.deepEqual(await json(await request('/api/account/apps',action(a,'POST',input,key))),initial);
  const listed=await json(await request('/api/account/apps',{cookie:a.cookie}));assert.equal(listed.applications.length,1);assert.equal(listed.applications[0].version,4);
  assert.equal((await request(path,action(b,'DELETE'))).status,404);
  assert.equal((await request(path+'/records/'+record.id,action(a,'DELETE'))).status,200);
  assert.equal((await request(path,action(a,'DELETE'))).status,200);
  assert.equal((await request(path,{cookie:a.cookie})).status,404);
});

function savedRevision(result){return {id:'revision_1',at:new Date().toISOString(),prompt:'A bright bakery website',number:1,plan:{intent:result.intent,version:result.version},render:{html:result.html,version:result.version,pending:[]},source:result.source,placeholder:result.placeholder}}

test('publication opt-in is scriptless, owner-gated, revocable and never exposes private projects implicitly',async t=>{
  const {request,account}=await fixture(t);const a=await account('publisher'),b=await account('outsider');
  const build=await json(await request('/api/account/turn',action(a,'POST',{text:'A white bakery website called Orbit Bakery'},'publication_build_1234')));
  const project=(await json(await request('/api/account/projects',action(a,'POST',{name:'Orbit Bakery',revisions:[savedRevision(build)]})))).project;
  assert.equal((await request('/published/'+project.id)).status,404);
  assert.equal((await request('/api/account/publications',action(b,'POST',{projectId:project.id}))).status,404);
  const publication=(await json(await request('/api/account/publications',action(a,'POST',{projectId:project.id})))).publication;
  const view=await request(publication.path);assert.equal(view.status,200);assert.match(view.headers.get('content-security-policy'),/script-src 'none'/);assert.match(view.headers.get('content-security-policy'),/sandbox/);assert.match(await view.text(),/Orbit Bakery/);
  assert.deepEqual((await json(await request('/api/account/publications',{cookie:b.cookie}))).publications,[]);
  assert.equal((await request('/api/account/publications/'+publication.id,action(b,'DELETE'))).status,404);
  assert.equal((await request('/api/account/publications/'+publication.id,action(a,'DELETE'))).status,200);
  assert.equal((await request(publication.path)).status,404);
});

test('capabilities disclose missing storage, billing/integration external setup and admin denies by default',async t=>{
  const {request,account,restart,env}=await fixture(t);const a=await account('adminqa'),b=await account('regularqa');
  const caps=await json(await request('/api/account/capabilities',{cookie:a.cookie}));assert.equal(caps.admin,false);assert.equal(caps.storage.mode,'ephemeral-preview');assert.ok(caps.storage.dependencies.includes('persistent_volume_not_enabled'));assert.equal(caps.arbitraryExecution,false);
  const billing=await json(await request('/api/account/billing',{cookie:a.cookie}));assert.equal(billing.status.billingEnabled,false);assert.equal(billing.account.balance,null);assert.equal(billing.status.liveChargesEnabled,false);
  assert.equal((await request('/api/account/billing/checkout',action(a,'POST',{offerId:'invented',requestKey:'billing_checkout_1234'}))).status,503);
  const integrations=await json(await request('/api/account/integrations',{cookie:a.cookie}));assert.equal(integrations.enabled,false);assert.ok(integrations.providers.every(p=>!p.configured));
  assert.equal((await request('/api/account/integrations/github/connect',action(a,'POST',{}))).status,503);
  assert.equal((await request('/api/account/integrations/github/callback?state=invalid&code=none',{headers:{'sec-fetch-site':'cross-site'}})).status,401);
  assert.equal((await request('/api/account/apps',{cookie:a.cookie,headers:{'sec-fetch-site':'cross-site'}})).status,403);
  assert.equal((await request('/api/account/admin',{cookie:a.cookie})).status,403);
  env.COMPASS_ADMIN_USER_IDS=a.userId;env.COMPASS_REVISION='a'.repeat(40);await restart();
  assert.equal((await request('/api/account/admin',{cookie:b.cookie})).status,403);
  const admin=await json(await request('/api/account/admin',{cookie:a.cookie}));assert.equal(admin.overview.applications,0);assert.deepEqual(admin.overview.aiUsage,[]);assert.equal(admin.database.quickCheck,'ok');assert.equal(admin.process.revision,'a'.repeat(40));assert.ok(admin.process.uptimeSeconds>0);assert.ok(admin.process.memoryBytes.rss>0);assert.equal(admin.process.nodeVersion,process.version);assert.ok(!JSON.stringify(admin).includes('@platform.test'));assert.ok(!JSON.stringify(admin).includes(a.userId));
  assert.equal((await request('/api/account/admin',action(a,'POST',{}))).status,405);
});

// The provider transport is synthetic; identity, encrypted state and every HTTP
// boundary are the real server and Better Auth session implementation.
test('cross-site integration callback exception requires exact host, current owner and single-use state',async t=>{
  let exchanges=0;
  const fetchImpl=async(url,options)=>{
    assert.equal(url,'https://github.com/login/oauth/access_token');exchanges++;
    const params=new URLSearchParams(options.body);assert.equal(params.get('code'),'synthetic-code');assert.ok(params.get('code_verifier'));
    return Response.json({access_token:'synthetic-access-only',token_type:'bearer',scope:'read:user'});
  };
  const {request,account}=await fixture(t,true,{COMPASS_INTEGRATIONS_MODE:'staging',COMPASS_INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64'),COMPASS_GITHUB_CLIENT_ID:'synthetic-client',COMPASS_GITHUB_CLIENT_SECRET:'synthetic-client-secret'},fetchImpl);
  const a=await account('oauthowner'),b=await account('oauthother');
  const connect=await json(await request('/api/account/integrations/github/connect',action(a,'POST',{})));
  const state=new URL(connect.authorizationUrl).searchParams.get('state');assert.ok(state);
  const callback='/api/account/integrations/github/callback?state='+state+'&code=synthetic-code';
  const cross={'sec-fetch-site':'cross-site',origin:'https://github.com'};
  assert.equal((await request(callback,{headers:cross})).status,401);
  assert.equal((await request(callback,{cookie:a.cookie,headers:{...cross,host:'attacker.test'}})).status,403);
  assert.equal((await request(callback,{cookie:b.cookie,headers:cross})).status,400);assert.equal(exchanges,0);
  const success=await request(callback,{cookie:a.cookie,headers:cross});assert.equal(success.status,303,await success.clone().text());assert.equal(success.headers.get('location'),'/workspace?integration=connected');assert.equal(exchanges,1);
  assert.equal((await request(callback,{cookie:a.cookie,headers:cross})).status,400);assert.equal(exchanges,1);
  const status=await json(await request('/api/account/integrations',{cookie:a.cookie}));assert.equal(status.providers.find(p=>p.provider==='github').connected,true);assert.ok(!JSON.stringify(status).includes('synthetic-access'));
  const other=await json(await request('/api/account/integrations',{cookie:b.cookie}));assert.equal(other.providers.find(p=>p.provider==='github').connected,false);
});

test('Stripe webhook consumes exact signed raw bytes without an account cookie and rejects tampering',async t=>{
  const policy={version:'synthetic-http-test',currency:'usd',creditUnitCostMicros:1000,maxOperationCostMicros:10000,rounding:'ceil',creditFeatures:['generate'],rates:[{provider:'anthropic',model:'synthetic-model',inputTokenBasis:'excludes_cache',inputMicrosPerMillion:1000000,outputMicrosPerMillion:1000000}],offers:[{id:'synthetic-pack',kind:'credits',priceId:'price_synthetic',credits:100,unitAmount:100,currency:'usd',features:[]}]};
  const secret='whsec_synthetic_http_fixture_only';
  const {request}=await fixture(t,true,{COMPASS_BILLING_MODE:'test',COMPASS_BILLING_ORIGIN:origin,COMPASS_CREDIT_POLICY_JSON:JSON.stringify(policy),STRIPE_SECRET_KEY:'sk_test_synthetic_fixture_only',STRIPE_WEBHOOK_SECRET:secret});
  const timestamp=Math.floor(Date.now()/1000),event={id:'evt_syntheticHttp',livemode:false,created:timestamp,type:'synthetic.ignored',data:{object:{id:'synthetic_object'}}};
  // Deliberate whitespace proves no JSON reserialization before verification.
  const payload=JSON.stringify(event,null,2),signature=Stripe.webhooks.generateTestHeaderString({payload,secret,timestamp});
  const options={method:'POST',body:payload,headers:{'stripe-signature':signature,origin:'https://hooks.stripe.com','sec-fetch-site':'cross-site'}};
  const accepted=await json(await request('/api/billing/webhook',options));assert.equal(accepted.status,'ignored');
  const replay=await json(await request('/api/billing/webhook',options));assert.equal(replay.replay,true);
  assert.equal((await request('/api/billing/webhook',{...options,body:payload+' '})).status,400);
  assert.equal((await request('/api/billing/webhook',{...options,headers:{...options.headers,host:'attacker.test'}})).status,403);
  assert.equal((await request('/api/billing/webhook',{...options,headers:{...options.headers,'stripe-signature':'t=1,v1=invalid'}})).status,400);
  const livePayload=JSON.stringify({...event,id:'evt_syntheticLive',livemode:true}),liveSignature=Stripe.webhooks.generateTestHeaderString({payload:livePayload,secret,timestamp});
  assert.equal((await request('/api/billing/webhook',{...options,body:livePayload,headers:{...options.headers,'stripe-signature':liveSignature}})).status,400);
});

test('application capacity is rejected before any upstream model request',async t=>{
  let calls=0;const fetchImpl=async()=>{calls++;throw Error('Unexpected upstream request')};
  const {request,account,restart,env}=await fixture(t,true,{},fetchImpl),a=await account('capacityqa');
  for(let i=0;i<12;i++)await json(await request('/api/account/apps',action(a,'POST',{text:'A task tracker called App '+i},'capacity_operation_'+String(i).padStart(4,'0'))));
  env.COMPASS_DEMO_MODE='live';env.LLM_PROVIDER='generalcompute';env.GENERALCOMPUTE_API_KEY='synthetic_unusable_fixture_key';await restart();
  const rejected=await request('/api/account/apps',action(a,'POST',{text:'A different application'},'capacity_rejected_1234'));assert.equal(rejected.status,409);assert.equal((await rejected.json()).error,'application_limit');assert.equal(calls,0);
  assert.equal((await json(await request('/api/account/apps',{cookie:a.cookie}))).applications.length,12);
});
