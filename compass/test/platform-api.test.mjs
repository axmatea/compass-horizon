import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import Stripe from 'stripe';
import {deflateSync} from 'node:zlib';
import {imageCrc32} from '../generation/image.mjs';
import {createCompassServer} from '../server.mjs';

const origin='http://localhost:8779',password='Platform secure password 84!';
async function fixture(t,enabled=true,extra={},fetchImpl,accountRateNow,crmArtifacts=false) {
  const root=await mkdtemp(join(tmpdir(),'compass-platform-api-')),assets=join(root,'public');await mkdir(assets);
  await Promise.all(['index','demo','create','studio','plan'].map(name=>writeFile(join(assets,name+'.html'),'<!doctype html><h1>'+name+'</h1>')));
  if (crmArtifacts) {
    const bundle=join(assets,'internal-crm');await mkdir(bundle);
    await writeFile(join(bundle,'crm.js'),"document.getElementById('crm-root').textContent = 'Fixture CRM';\n");
    await writeFile(join(bundle,'crm.css'),'body{color:#121212}\n');
  }
  const env={NODE_ENV:'test',STATIC_ROOT:assets,BUILDER_STEP_MS:'0',COMPASS_DEMO_MODE:'examples',...(enabled?{COMPASS_ACCOUNT_MODE:'staging',COMPASS_ACCOUNT_ORIGIN:origin,COMPASS_ACCOUNT_DATABASE:join(root,'isolated.sqlite'),BETTER_AUTH_SECRET:randomBytes(32).toString('base64url')}:{}),...extra};
  let app,network;
  async function start(){app=createCompassServer({env,...(fetchImpl?{fetchImpl}:{}),...(accountRateNow?{accountRateNow}:{})});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');network='http://127.0.0.1:'+app.server.address().port}
  await start();t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true})});
  function request(path,{method='GET',body,cookie,headers={}}={}) {
    return new Promise((resolve,reject)=>{
      const req=httpRequest(network+path,{method,headers:{host:new URL(origin).host,...(!['GET','HEAD'].includes(method)?{origin,'content-type':'application/json'}:{}),...(cookie?{cookie}:{}),...headers}},res=>{
        const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);res.on('end',()=>{
          const headers=new Headers();for(const [key,value] of Object.entries(res.headers))for(const item of Array.isArray(value)?value:value===undefined?[]:[value])headers.append(key,item);
          resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers}));
        });
      });req.on('error',reject);if(body!==undefined)req.write(Buffer.isBuffer(body)||typeof body==='string'?body:JSON.stringify(body));req.end();
    });
  }
  async function account(name){const res=await request('/api/auth/sign-up/email',{method:'POST',body:{name,email:name+'@platform.test',password}});assert.equal(res.status,200,await res.clone().text());const cookie=res.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');const me=await request('/api/account/me',{cookie});assert.equal(me.status,200,await me.clone().text());return {cookie,...await me.json()}}
  const restart=async()=>{await app.close();await start()};return {request,account,restart,env};
}
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json()};
const action=(user,method,body,key)=>({method,cookie:user.cookie,body,headers:key?{'idempotency-key':key}:{}});

test('authorized GitHub manifest import is reviewed, conflict-checked, owner-isolated, and durable', async t => {
  const repo = 'synthetic-owner/compass-demo', branch = 'compass/qa';
  const base = `https://api.github.com/repos/${repo}`;
  const commit = 'a'.repeat(40), tree = 'b'.repeat(40);
  let head = commit, providerCalls = 0;
  const replies = new Map();
  const {request,account,restart}=await fixture(t,true,{
    COMPASS_INTEGRATIONS_MODE:'staging', COMPASS_GITHUB_MANIFEST_IMPORT:'true', COMPASS_INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64'),
    COMPASS_GITHUB_CLIENT_ID:'synthetic-id', COMPASS_GITHUB_CLIENT_SECRET:'synthetic-fixture-secret',
  },async (url,options)=>{
    providerCalls++;
    if(url==='https://github.com/login/oauth/access_token') return Response.json({access_token:'synthetic-test-token',token_type:'bearer',scope:'read:user'});
    assert.equal(new Headers(options.headers).get('authorization'),'Bearer synthetic-test-token');
    assert.equal(options.method??'GET','GET');
    if(url===`${base}/git/ref/heads/${branch}`) return Response.json({ref:`refs/heads/${branch}`,object:{type:'commit',sha:head}});
    assert.ok(replies.has(url),`Unexpected fixture URL: ${url}`);
    return Response.json(replies.get(url));
  });
  const owner=await account('gitimportqa'), outsider=await account('gitimportother');
  const {application}=await json(await request('/api/account/apps',action(owner,'POST',{text:'A task tracker called GitHub QA'},'git-import-initial-app')));
  const path='/api/account/apps/'+application.id, review=path+'/github-import/review', apply=path+'/github-import/apply';
  const selection={repository:repo,branch,version:1};
  assert.equal((await request(review,action(outsider,'POST',selection))).status,404);
  assert.equal((await request(review,action(owner,'POST',selection))).status,409);
  assert.equal(providerCalls,0);
  const {authorizationUrl}=await json(await request('/api/account/integrations/github/connect',action(owner,'POST',{})));
  const state=new URL(authorizationUrl).searchParams.get('state');
  const callback=await request(`/api/account/integrations/github/callback?code=synthetic&state=${state}`,{cookie:owner.cookie,headers:{'sec-fetch-site':'cross-site'}});
  assert.equal(callback.status,303);
  const status=await json(await request('/api/account/integrations',{cookie:owner.cookie}));
  assert.equal(status.providers.find(provider=>provider.provider==='github').manifestImport,true);
  const {record}=await json(await request(path+'/records',action(owner,'POST',{data:{title:'Keep this record',status:'To do'}})));
  const manifest={...application.manifest,title:'GitHub QA reviewed'};
  const bytes=Buffer.from(JSON.stringify(manifest));
  const blob=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  replies.set(base,{id:101,full_name:repo,private:false,visibility:'public'});
  replies.set(`${base}/git/commits/${commit}`,{sha:commit,tree:{sha:tree}});
  replies.set(`${base}/git/trees/${tree}`,{sha:tree,truncated:false,tree:[{path:'manifest.json',mode:'100644',type:'blob',sha:blob,size:bytes.length}]});
  replies.set(`${base}/git/blobs/${blob}`,{sha:blob,size:bytes.length,encoding:'base64',content:bytes.toString('base64')});
  const proposed=await json(await request(review,action(owner,'POST',selection)));
  assert.equal(proposed.changed,true);
  assert.equal(proposed.manifest.title,manifest.title);
  assert.equal((await json(await request(path,{cookie:owner.cookie}))).application.version,1);
  assert.equal((await request(apply,action(outsider,'POST',{ticket:proposed.ticket}))).status,404);
  head='c'.repeat(40);
  const changed=await request(apply,action(owner,'POST',{ticket:proposed.ticket}));
  assert.equal(changed.status,409);assert.equal((await changed.json()).error,'integration_branch_changed');
  head=commit;
  const before=await json(await request(path+'/context',{cookie:owner.cookie}));
  await json(await request(path+'/context',action(owner,'PUT',{version:before.context.version,notes:{...before.context.notes,goal:'Keep launch data'}})));
  const stale=await request(apply,action(owner,'POST',{ticket:proposed.ticket}));
  assert.equal(stale.status,409);assert.equal((await stale.json()).error,'project_context_conflict');
  const fresh=await json(await request(review,action(owner,'POST',selection)));
  await restart();
  const result=await json(await request(apply,action(owner,'POST',{ticket:fresh.ticket})));
  assert.equal(result.commitSha,commit);assert.equal(result.application.version,2);assert.equal(result.application.manifest.title,manifest.title);
  assert.equal((await request(apply,action(owner,'POST',{ticket:fresh.ticket}))).status,409);
  const versions=await json(await request(path+'/revisions',{cookie:owner.cookie}));
  assert.match(versions.revisions[0].prompt,new RegExp(commit));
  assert.deepEqual((await json(await request(path+'/records',{cookie:owner.cookie}))).records,[record]);
});

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

test('reviewed plans leave projects untouched until apply and retain records across version conflicts and retries',async t=>{
  const {request,account,restart}=await fixture(t);
  const owner=await account('planowner'), outsider=await account('planother');
  const base='/api/account/apps', idea={text:'A task tracker called Harbor QA'};
  const planKey='plan_prepare_harbor_1234';
  const prepare=action(owner,'POST',idea,planKey);
  assert.equal((await request(base+'/plan',action(owner,'POST',idea))).status,400);
  const proposed=await json(await request(base+'/plan',prepare));
  assert.equal(proposed.manifest.title,'Harbor QA');
  assert.equal(proposed.baseVersion,null);
  assert.equal(proposed.modelUsed,false);
  assert.deepEqual(await json(await request(base+'/plan',prepare)),proposed);
  assert.deepEqual((await json(await request(base,{cookie:owner.cookie}))).applications,[]);
  const reviewed={...idea,manifest:{...proposed.manifest,title:'Reviewed Harbor'}};
  const create=action(owner,'POST',reviewed,'plan_apply_harbor_12345');
  const created=await json(await request(base+'/build-plan',create));
  const path=base+'/'+created.application.id;
  assert.equal(created.application.manifest.title,'Reviewed Harbor');
  const record=await json(await request(path+'/records',action(owner,'POST',{data:{title:'Pier inspection',status:'To do'}})));
  const edit={text:'Add a due date field and use dark theme',version:1};
  assert.equal((await request(path+'/plan',action(outsider,'POST',edit,'other_plan_harbor_1234'))).status,404);
  const update=await json(await request(path+'/plan',action(owner,'POST',edit,'plan_edit_harbor_12345')));
  assert.equal(update.manifest.theme.mode,'dark');
  assert.ok(update.manifest.entity.fields.some(field=>field.key==='due_date'));
  assert.equal(update.baseVersion,1);
  assert.equal((await json(await request(path,{cookie:owner.cookie}))).application.version,1);
  const next={...edit,manifest:update.manifest};
  assert.equal((await request(path+'/build-plan',action(outsider,'POST',next,'other_apply_harbor_1234'))).status,404);
  assert.equal((await request(path+'/build-plan',action(owner,'POST',{...next,manifest:{...next.manifest,script:'x'}},'invalid_apply_harbor_1234'))).status,400);
  const apply=action(owner,'POST',next,'plan_edit_apply_harbor_1234');
  const applied=await json(await request(path+'/build-plan',apply));
  assert.equal(applied.application.version,2);
  assert.equal(applied.changed,true);
  assert.equal(applied.modelUsed,false);
  assert.equal((await request(path+'/build-plan',action(owner,'POST',next,'stale_apply_harbor_1234'))).status,409);
  assert.deepEqual((await json(await request(path+'/records',{cookie:owner.cookie}))).records,[record.record]);
  const history=await json(await request(path+'/revisions',{cookie:owner.cookie}));
  assert.equal(history.revisions[0].prompt,edit.text);
  await restart();
  assert.deepEqual(await json(await request(path+'/build-plan',apply)),applied);
  assert.deepEqual(await json(await request(base+'/build-plan',create)),created);
  assert.equal((await json(await request(base,{cookie:owner.cookie}))).applications.length,1);
});

test('project context survives restart, steers reviewed plans and invalidates obsolete work',async t=>{
  const inspected=[];
  let hold;
  const fetchImpl=async (_url,options)=>{
    const messages=JSON.parse(options.body).messages;
    const payload=JSON.parse(messages.find(message=>message.role==='user').content);
    inspected.push(payload);
    if(hold){hold.entered();await hold.released}
    const manifest={...payload.current,theme:{...payload.current.theme,accent:'amber'}};
    return Response.json({choices:[{message:{content:JSON.stringify(manifest)},finish_reason:'stop'}],usage:{prompt_tokens:32,completion_tokens:23}});
  };
  const {request,account,restart,env}=await fixture(t,true,{},fetchImpl);
  const owner=await account('contextowner'),outside=await account('contextother');
  const {application}=await json(await request('/api/account/apps',action(owner,'POST',{text:'A task tracker called Context QA'},'context_initial_app')));
  const app='/api/account/apps/'+application.id,path=app+'/context';
  const read=async()=> (await json(await request(path,{cookie:owner.cookie}))).context;
  let context=await read();
  assert.equal(context.version,0);
  assert.equal(context.recentChanges[0].prompt,'A task tracker called Context QA');
  const save=async notes=> (await json(await request(path,action(owner,'PUT',{version:context.version,notes})))).context;
  const record=async input=> (await json(await request(path,action(owner,'POST',{version:context.version,...input})))).context;
  let notes={...context.notes,goal:'Track launch tasks',architecture:'Single tracker',preferences:'Light theme',dependencies:'QA review',problems:'Missing owners'};
  assert.equal((await request(path)).status,401);
  assert.equal((await request(path,{cookie:outside.cookie})).status,404);
  assert.equal((await request(path,action(outside,'PUT',{version:0,notes}))).status,404);
  assert.equal((await request(path,action(outside,'POST',{version:0,action:'decision',text:'Unauthorized'}))).status,404);
  assert.equal((await request(path,action(owner,'PUT',{version:0,notes:{...notes,goal:'x'.repeat(301)}}))).status,400);
  context=await save(notes);
  assert.equal(context.version,1);
  assert.equal((await save(notes)).version,1);
  assert.equal((await request(path,action(owner,'PUT',{version:0,notes}))).status,409);
  context=await record({action:'decision',text:'Use rose accents'});
  const oldId=context.decisions[0].id;
  context=await record({action:'supersede',id:oldId,text:'Use amber accents'});
  assert.equal(context.decisions[0].supersededBy,context.decisions[1].id);
  context=await record({action:'task',text:'Review release'});
  context=await record({action:'task',text:'Finished smoke test'});
  context=await record({action:'task-status',id:context.tasks[1].id,status:'done'});
  context=await record({action:'task',text:'Obsolete launch checklist'});
  context=await record({action:'task-status',id:context.tasks[2].id,status:'cancelled'});
  await json(await request(app+'/records',action(owner,'POST',{data:{title:'Private test record',status:'To do'}})));
  env.COMPASS_DEMO_MODE='live';env.LLM_PROVIDER='generalcompute';env.GENERALCOMPUTE_API_KEY='synthetic_unusable_fixture_key';
  await restart();
  assert.deepEqual(await read(),context);

  const prompt={text:'Use the active decision to update the accent',version:1};
  const propose=key=>request(app+'/plan',action(owner,'POST',prompt,key));
  const proposal=await json(await propose('context_first_plan'));
  assert.equal(proposal.modelUsed,true);
  assert.equal(proposal.manifest.theme.accent,'amber');
  assert.equal(proposal.contextVersion,context.version);
  assert.deepEqual(inspected[0].projectContext,{notes,decisions:['Use amber accents'],tasks:['Review release']});
  assert.deepEqual(Object.keys(inspected[0]),['request','current','example','preferences','projectContext']);
  assert.doesNotMatch(JSON.stringify(inspected[0]),/Private test record|Use rose accents|Obsolete launch checklist|Finished smoke test/);

  const release=Promise.withResolvers(),arrived=Promise.withResolvers();
  hold={entered:arrived.resolve,released:release.promise};
  const pending=propose('context_obsolete_plan');
  try {
    await Promise.race([arrived.promise,pending.then(()=>assert.fail('No upstream request captured'))]);
    notes={...notes,problems:'QA assigned'};
    context=await save(notes);
  } finally {release.resolve();hold=undefined}
  const obsolete=await pending;
  assert.equal(obsolete.status,409);
  assert.equal((await obsolete.json()).error,'project_context_conflict');
  const apply=(plan,key)=>request(app+'/build-plan',action(owner,'POST',{
    ...prompt,manifest:plan.manifest,contextVersion:plan.contextVersion,
  },key));
  const stale=await apply(proposal,'context_stale_apply');
  assert.equal(stale.status,409);
  assert.equal((await stale.json()).error,'project_context_conflict');
  const fresh=await json(await propose('context_fresh_plan'));
  const applied=await json(await apply(fresh,'context_fresh_apply'));
  assert.equal(applied.application.version,2);
  assert.equal((await read()).recentChanges[0].prompt,prompt.text);
  assert.equal((await read()).version,context.version);
  await json(await request(app+'/restore',action(owner,'POST',{version:1})));
  assert.equal((await read()).decisions[1].text,'Use amber accents');
  await json(await request(app,action(owner,'DELETE')));
  assert.equal((await request(path,{cookie:owner.cookie})).status,404);
});

test('CRM repairs a controlled invalid draft, exports multiple files and preserves related records and context',async t=>{
  const modelInputs=[];
  const fetchImpl=async (_url,options)=>{
    const payload=JSON.parse(JSON.parse(options.body).messages.find(item=>item.role==='user').content);
    modelInputs.push(payload);
    const draft=payload.current
      ?{title:payload.current.title,crm:{...payload.current.crm,stages:{...payload.current.crm.stages,qualified:'Discovery'}}}
      :{title:'Orbital Consulting CRM',crm:{currency:'JPY',stages:{...payload.example.crm.stages,qualified:''}}};
    return Response.json({choices:[{message:{content:JSON.stringify(draft)},finish_reason:'stop'}],usage:{prompt_tokens:53,completion_tokens:29}});
  };
  const {request,account,restart}=await fixture(t,true,{COMPASS_DEMO_MODE:'live',LLM_PROVIDER:'generalcompute',GENERALCOMPUTE_API_KEY:'synthetic_fixture_only'},fetchImpl,undefined,true);
  const owner=await account('crmowner'), outsider=await account('crmother');
  const text='Build a professional AI consulting CRM with a client pipeline, contact management, follow-up tasks, proposal tracking, and a revenue dashboard.';
  const mutation=(who,method,body,version=1,recordVersion)=>({method,cookie:who.cookie,body,headers:{'x-compass-app-version':String(version),...(recordVersion?{'x-compass-record-version':String(recordVersion)}:{})}});
  const build=await json(await request('/api/account/apps',action(owner,'POST',{text},'create_crm_engine_qa')));
  assert.equal(build.modelUsed,true);
  assert.equal(build.buildReport.outcome,'repaired');
  assert.equal(build.buildReport.diagnostics.length,2);
  assert.equal(build.application.manifest.title,'Orbital Consulting CRM');
  assert.equal(build.application.manifest.crm.currency,'USD');
  assert.equal(build.application.manifest.crm.stages.qualified,'Qualified');
  const app='/api/account/apps/'+build.application.id, records=app+'/crm/';
  const save=async (entity,data)=> (await json(await request(records+entity,mutation(owner,'POST',{data})))).record;
  const client=await save('clients',{name:'Synthetic Labs',industry:'Consulting'});
  assert.equal((await request(records+'clients',mutation(outsider,'GET'))).status,404);
  assert.equal((await request(records+'contacts',mutation(owner,'POST',{data:{name:'Honor',clientId:'crm_22222222-2222-2222-2222-222222222222'}}))).status,409);
  assert.equal((await save('contacts',{name:'Synthetic Contact',clientId:client.id,email:'contact@example.test'})).data.clientId,client.id);
  assert.equal((await save('tasks',{title:'Prepare proposal',clientId:client.id,status:'open'})).data.status,'open');
  const deal=await save('deals',{title:'Strategy sprint',clientId:client.id,valueCents:250000,stage:'qualified'});
  const proposal=await save('proposals',{title:'Discovery proposal',dealId:deal.id,status:'sent',valueCents:250000});
  const won={...deal.data,stage:'won'};
  const change=await json(await request(records+'deals/'+deal.id,mutation(owner,'PUT',{data:won,version:deal.version})));
  assert.equal(change.record.version,2);
  assert.equal((await request(records+'deals/'+deal.id,mutation(owner,'PUT',{data:deal.data,version:deal.version}))).status,409);
  assert.equal((await request(records+'clients/'+client.id,mutation(owner,'DELETE',undefined,1,client.version))).status,409);
  assert.equal((await request(records+'deals/'+deal.id,mutation(owner,'DELETE',undefined,1,2))).status,409);

  const context=(await json(await request(app+'/context',{cookie:owner.cookie}))).context;
  await json(await request(app+'/context',action(owner,'POST',{version:context.version,action:'decision',text:'Call qualified Discovery'})));
  const edit={text:'Rename the active pipeline stage according to the project decision',version:1};
  const plan=await json(await request(app+'/plan',action(owner,'POST',edit,'crm_engine_qa_stage_plan')));
  assert.equal(plan.manifest.crm.stages.qualified,'Discovery');
  assert.deepEqual(modelInputs[1].projectContext.decisions,['Call qualified Discovery']);
  assert.doesNotMatch(JSON.stringify(modelInputs[1]),/Synthetic Labs|Synthetic Contact|Strategy sprint|Discovery proposal/);
  const applied=await json(await request(app+'/build-plan',action(owner,'POST',{...edit,manifest:plan.manifest,contextVersion:plan.contextVersion},'crm_engine_qa_apply_plan')));
  assert.equal(applied.application.version,2);
  assert.equal((await request(records+'deals',mutation(owner,'GET'))).status,409);
  const currency=await request(app+'/manifest',action(owner,'PUT',{version:2,manifest:{...plan.manifest,crm:{...plan.manifest.crm,currency:'EUR'}}}));
  assert.equal(currency.status,409);
  assert.equal((await currency.json()).error,'crm_currency_in_use');
  const preview=await request(app+'/preview',{cookie:owner.cookie});
  assert.equal(preview.status,200);
  assert.match(await preview.text(),/id="crm-root"/);
  assert.match(preview.headers.get('content-security-policy'),/sandbox allow-scripts/);
  assert.equal((await request('/internal-crm/crm.js')).status,404);
  const source=await json(await request(app+'/source',{cookie:owner.cookie}));
  assert.equal(source.template,'compass-consulting-crm-v1');
  assert.ok(['src/main.tsx','src/App.tsx','server.mjs','package-lock.json','manifest.json'].every(path=>source.files.some(file=>file.path===path)));
  assert.doesNotMatch(JSON.stringify(source),/Synthetic Labs|Synthetic Contact/);
  const zip=await request(app+'/export',{cookie:owner.cookie});
  assert.equal(zip.status,200);
  assert.equal(Buffer.from(await zip.arrayBuffer()).readUInt32LE(),0x04034b50);
  await restart();
  const after=await json(await request(app+'/data',{cookie:owner.cookie}));
  assert.equal(after.records.deals[0].data.stage,'won');
  assert.equal(after.records.deals[0].data.valueCents,250000);
  assert.equal(after.records.proposals[0].id,proposal.id);
  const history=await json(await request(app+'/revisions',{cookie:owner.cookie}));
  assert.equal(history.revisions[1].buildReport.outcome,'repaired');
  const restored=await json(await request(app+'/restore',action(owner,'POST',{version:1})));
  assert.equal(restored.application.manifest.crm.stages.qualified,'Qualified');
  assert.equal((await json(await request(records+'deals',mutation(owner,'GET',undefined,3)))).records[0].data.stage,'won');
});

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
  const timestamp=Math.floor(Date.now()/1000),event={id:'evt_syntheticHttp',object:'event',livemode:false,created:timestamp,type:'synthetic.ignored',data:{object:{id:'synthetic_object'}}};
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

test('actual private API rate limits isolate verified owners, reset windows and preserve stricter setup-blocked actions',async t=>{
  let clock=1800000000000;const {request,account}=await fixture(t,true,{},undefined,()=>clock),a=await account('rateqa'),b=await account('rateother');
  // Each registration helper already performed one authenticated /me read.
  for(let i=0;i<299;i++)assert.equal((await request('/api/account/me',{cookie:a.cookie})).status,200);
  let limited=await request('/api/account/me',{cookie:a.cookie});assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'60');assert.equal((await limited.json()).error,'account_rate_limited');
  assert.equal((await request('/api/account/me',{cookie:b.cookie})).status,200);
  assert.equal((await request('/api/account/me',{cookie:b.cookie,headers:{'x-compass-user':a.userId}})).status,403);
  assert.equal((await request('/api/account/me',{cookie:a.cookie,headers:{origin:'https://attacker.test'}})).status,403,'CSRF guard precedes owner quota');
  clock+=60000;assert.equal((await request('/api/account/me',{cookie:a.cookie})).status,200);
  for(let i=0;i<60;i++)assert.equal((await request('/api/account/profile',action(a,'PUT',{preferences:{}}))).status,200);
  limited=await request('/api/account/profile',action(a,'PUT',{preferences:{}}));assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'60');
  assert.equal((await request('/api/account/profile',action(b,'PUT',{preferences:{}}))).status,200);
  clock+=60000;assert.equal((await request('/api/account/profile',action(a,'PUT',{preferences:{}}))).status,200);
  for(let i=0;i<10;i++)assert.equal((await request('/api/account/integrations/github/connect',action(a,'POST',{}))).status,503);
  limited=await request('/api/account/integrations/github/connect',action(a,'POST',{}));assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'600');
  clock+=60000;limited=await request('/api/account/integrations/github/connect',action(a,'POST',{}));assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'540');
  for(let i=0;i<10;i++)assert.equal((await request('/api/account/billing/portal',action(a,'POST',{}))).status,503);
  limited=await request('/api/account/billing/checkout',action(a,'POST',{offerId:'unconfigured',requestKey:'rate_retry_key_1234'}));assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'60');
  // Signed webhooks have their own bounded body/SDK checks, never this owner quota.
  assert.equal((await request('/api/billing/webhook',{method:'POST',body:{}})).status,503);
  clock+=600000;assert.equal((await request('/api/account/integrations/github/connect',action(a,'POST',{}))).status,503);
});

function assetPng(){
  const chunk=(type,data)=>{const buffer=Buffer.alloc(data.length+12);buffer.writeUInt32BE(data.length);buffer.write(type,4);data.copy(buffer,8);buffer.writeUInt32BE(imageCrc32(buffer.subarray(4,-4)),buffer.length-4);return buffer};
  const header=Buffer.from([0,0,0,1,0,0,0,1,8,6,0,0,0]);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,255,0,0,255]))),chunk('IEND',Buffer.alloc(0))]);
}
test('real manifest and raw image routes enforce owner/session/CSRF/version, persist hashes and export actual image bytes',async t=>{
  const {request,account,restart}=await fixture(t),a=await account('assetowner'),b=await account('assetother');
  const created=await json(await request('/api/account/apps',action(a,'POST',{text:'A task tracker called Orbit'},'asset_create_key_1234'))),path='/api/account/apps/'+created.application.id;
  assert.equal((await request(path+'/assets')).status,401);assert.equal((await request(path+'/assets',{cookie:b.cookie})).status,404);
  const upload=(user,version,body=assetPng(),headers={})=>request(path+'/assets',{method:'POST',cookie:user.cookie,body,headers:{'content-type':'image/png','x-compass-app-version':String(version),...headers}});
  assert.equal((await upload(a,1,assetPng(),{origin:'https://attacker.test'})).status,403);assert.equal((await upload(b,1)).status,404);
  assert.equal((await upload(a,1,Buffer.from('<svg></svg>'),{'content-type':'image/svg+xml'})).status,415);
  const uploaded=await json(await upload(a,1)),asset=uploaded.asset;assert.equal(uploaded.application.version,2);assert.equal(asset.mime,'image/png');assert.equal(asset.width,1);
  assert.equal((await upload(a,1)).status,409);assert.equal((await upload(a,2,Buffer.alloc(524289))).status,413);
  const chosen={...created.application.manifest,assets:{logo:asset.id,hero:asset.id}};
  assert.equal((await request(path+'/manifest',action(a,'PUT',{manifest:chosen,version:1}))).status,409);
  assert.equal((await request(path+'/manifest',action(a,'PUT',{manifest:{...chosen,script:'alert(1)'},version:2}))).status,400);
  const edited=await json(await request(path+'/manifest',action(a,'PUT',{manifest:chosen,version:2})));assert.equal(edited.changed,true);assert.equal(edited.application.version,3);assert.ok(edited.changes.some(file=>file.path==='manifest.json'&&file.type==='modified'));
  const nochange=await json(await request(path+'/manifest',action(a,'PUT',{manifest:chosen,version:3})));assert.equal(nochange.changed,false);assert.equal(nochange.application.version,3);
  const imagePath=path+'/assets/'+asset.id,image=await request(imagePath,{cookie:a.cookie,headers:{'x-compass-app-version':'3'}});assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert.equal(image.headers.get('cache-control'),'no-store');assert.equal(image.headers.get('x-compass-app-version'),'3');assert.ok(Buffer.from(await image.arrayBuffer()).equals(assetPng()));
  assert.equal((await request(imagePath,{cookie:b.cookie})).status,404);assert.equal((await request(imagePath)).status,401);assert.equal((await request(imagePath,{cookie:a.cookie,headers:{'x-compass-app-version':'2'}})).status,409);
  const source=await json(await request(path+'/source',{cookie:a.cookie}));assert.ok(source.files.some(file=>file.encoding==='base64'&&Buffer.from(file.content,'base64').equals(assetPng())));
  const zip=await request(path+'/export',{cookie:a.cookie});assert.ok(Buffer.from(await zip.arrayBuffer()).includes(assetPng()));
  const remove=()=>request(imagePath,{method:'DELETE',cookie:a.cookie,headers:{'x-compass-app-version':'3'}});assert.equal((await remove()).status,409);
  const oldVersion=3;const cleared=await json(await request(path+'/manifest',action(a,'PUT',{manifest:created.application.manifest,version:3})));
  const deleted=await json(await request(imagePath,{method:'DELETE',cookie:a.cookie,headers:{'x-compass-app-version':String(cleared.application.version)}}));assert.equal(deleted.application.version,5);assert.equal((await request(imagePath,{cookie:a.cookie})).status,404);
  await restart();const restored=await json(await request(path+'/restore',action(a,'POST',{version:oldVersion})));assert.equal(restored.application.version,6);assert.equal(restored.application.manifest.assets.logo,asset.id);assert.equal((await request(imagePath,{cookie:a.cookie})).status,200);
  const history=await json(await request(path+'/revisions',{cookie:a.cookie}));assert.ok(history.revisions.find(item=>item.version===2).files.some(file=>file.path.endsWith('.png')&&file.sha256===asset.sha256));
});
