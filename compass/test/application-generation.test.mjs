import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {createApplicationManifest,refineApplicationManifest,validateApplicationManifest,validateApplicationRecord,createApplicationBundle,exportApplicationZip,renderApplicationPreview} from '../generation/index.mjs';
import {createIsolatedVerifier,SANDBOX_LIMITS} from '../sandbox/vercel.mjs';
import {validateApplicationBridgeMessage} from '../src/applications/bridge.mjs';
import {applicationResultOutcome,requireApplicationVersion} from '../src/applications/result.mjs';

test('application manifests support real CRM, booking, inventory and tracker fields with deterministic refinements',() => {
  for (const [prompt,kind,key] of [['A CRM called Forma','crm','email'],['An appointment booking app','booking','date'],['Inventory for a warehouse','inventory','quantity'],['A project task tracker','tracker','status']]) {
    const spec = createApplicationManifest(prompt);
    assert.equal(spec.kind,kind);assert.ok(spec.entity.fields.some(field => field.key === key));assert.ok(validateApplicationManifest(spec));
  }
  assert.equal(createApplicationManifest('A booking app for clients').kind,'booking');
  assert.equal(createApplicationManifest('Track inventory for our customers').kind,'inventory');
  assert.equal(createApplicationManifest('A task tracker for client projects').kind,'tracker');
  const initial = createApplicationManifest('A task tracker called Northstar');
  const result = refineApplicationManifest(initial,'Add a priority field and add a due date field. Make it dark and compact with rose accents.');
  assert.equal(result.changed,true);assert.equal(result.manifest.title,'Northstar');
  assert.equal(result.manifest.theme.mode,'dark');assert.equal(result.manifest.theme.density,'compact');assert.equal(result.manifest.theme.accent,'rose');
  assert.ok(result.manifest.entity.fields.some(field => field.key === 'priority'));
  assert.ok(result.manifest.entity.fields.some(field => field.key === 'due_date'));
  assert.equal(refineApplicationManifest(result.manifest,'Write arbitrary JavaScript').changed,false);
  assert.ok(!initial.entity.fields.some(field => field.key === 'priority'),'refinements do not mutate the previous revision');
});

test('manifest and record boundaries deny executable source, unsafe fields, invalid dates, unlimited values and owner spoofing',() => {
  const spec = createApplicationManifest('A booking application');
  assert.equal(validateApplicationManifest({...spec,entity:{...spec.entity,fields:[{key:'__proto__',label:'X',type:'text',required:false}]}}),null);
  assert.equal(validateApplicationManifest({...spec,theme:{...spec.theme,accent:'url(https://example.com)'}}),null);
  assert.equal(validateApplicationManifest({...spec,entity:{...spec.entity,fields:[{key:'script',label:'X',type:'javascript',required:false}]}}),null);
  const data = {name:'Test',service:'Consultation',date:'2026-01-01',status:'Requested'};
  assert.equal(validateApplicationRecord(spec,data).ok,true);
  assert.equal(validateApplicationRecord(spec,{...data,owner_id:'other'}).ok,false);
  assert.equal(validateApplicationRecord(spec,{...data,date:'2026-02-30'}).ok,false);
  assert.equal(validateApplicationRecord(spec,{...data,status:'arbitrary'}).ok,false);
  assert.equal(validateApplicationRecord(spec,{...data,notes:'x'.repeat(2001)}).ok,false);
  const inventory = createApplicationManifest('Inventory application');
  assert.equal(validateApplicationRecord(inventory,{name:'Item',quantity:Infinity}).ok,false);
  assert.equal(validateApplicationRecord(inventory,{name:'Item',quantity:0}).ok,true);
});

test('source export is a deterministic real ZIP with fixed safe paths, exact source receipts and working app files',async () => {
  const manifest = createApplicationManifest('A CRM called Forma');
  const first = await createApplicationBundle(manifest), second = await createApplicationBundle(manifest);
  assert.equal(first.sha256,second.sha256);
  assert.ok(first.files.some(file => file.path === 'server.mjs' && file.content.includes('better-auth')));
  assert.ok(first.files.some(file => file.path === 'package-lock.json'));
  const zip = exportApplicationZip(first);
  assert.equal(zip.readUInt32LE(0),0x04034b50);
  assert.equal(zip.readUInt32LE(zip.length - 22),0x06054b50);
  assert.equal(zip.readUInt16LE(zip.length - 12),first.files.length);
  assert.throws(() => exportApplicationZip({...first,files:[{path:'../../escape',content:'x'},...first.files.slice(1)]}),/Invalid source path/);
});

test('hosted preview uses only the trusted script and data manifest with opaque-frame bridge and a deny-network CSP',async () => {
  const manifest = createApplicationManifest('A CRM called Forma');
  manifest.title = '</script><img src=x onerror=alert(1)>';
  const html = await renderApplicationPreview(manifest);
  assert.ok(html.includes("connect-src &#39;none&#39;"));
  assert.ok(html.includes("event.source !== parent"));
  assert.ok(html.includes('compass-app-request') && html.includes('compass-app-response'));
  assert.ok(!html.includes('<script src='));assert.ok(!html.includes('fetch('));
  assert.ok(!html.includes('<title></script>'));
  const script = html.match(/<script>([\s\S]*)<\/script><\/body>/)?.[1];
  const digest = createHash('sha256').update(script).digest('base64');
  assert.ok(html.includes('sha256-' + digest));
  assert.ok(!html.includes('document.cookie') && !html.includes('localStorage') && !html.includes('sessionStorage'));
  assert.match(html,/<button id="save-record" type="button">/);
  assert.ok(script.includes("$('save-record').addEventListener('click',saveRecord)"),'saving is an explicit action instead of blocked native form submission');
  assert.ok(script.includes("event.preventDefault();void saveRecord()"),'keyboard paths prevent native form navigation');
});

test('the parent bridge accepts only bounded project record operations and rejects identity, URLs and arbitrary capabilities',() => {
  const manifest = createApplicationManifest('A task tracker');
  const valid = {type:'compass-app-request',requestId:'app_request_1',action:'create',data:{title:'Test task',status:'To do'}};
  assert.deepEqual(validateApplicationBridgeMessage(valid,manifest),{requestId:valid.requestId,action:'create',data:valid.data});
  for (const value of [
    {...valid,projectId:'another_project'}, {...valid,userId:'another_user'}, {...valid,url:'https://example.com'},
    {...valid,action:'fetch'}, {...valid,action:'execute'}, {...valid,id:'another_record'},
    {...valid,requestId:'../invalid'}, {...valid,data:{...valid.data,owner_id:'another_user'}},
    {...valid,data:{title:'x'.repeat(20001),status:'To do'}},
    {type:'compass-app-request',requestId:'r',action:'delete',id:'../escape'},
  ]) assert.equal(validateApplicationBridgeMessage(value,manifest),null);
  assert.deepEqual(validateApplicationBridgeMessage({type:valid.type,requestId:'list_1',action:'list'},manifest),{requestId:'list_1',action:'list'});
});

test('unsupported refinements report a supported change hint instead of claiming an updated application',() => {
  const result = applicationResultOutcome({changed:false,message:'Try adding a priority field.'});
  assert.equal(result.changed,false);assert.equal(result.message,'Try adding a priority field.');
  for (const value of [{changed:false},{changed:false,message:'Application updated.'}]) {
    const outcome = applicationResultOutcome(value);
    assert.equal(outcome.changed,false);assert.match(outcome.message,/Try a theme change/);assert.doesNotMatch(outcome.message,/updated/i);
  }
  assert.deepEqual(applicationResultOutcome({changed:true},{creating:true}),{changed:true,message:'Application created.'});
});

test('preview and source receipts must match the selected application version, including cross-tab head changes',() => {
  assert.doesNotThrow(() => requireApplicationVersion({headers:new Headers({'x-compass-app-version':'2'})},2));
  for (const headers of [new Headers(),new Headers({'x-compass-app-version':'3'}),new Headers({'x-compass-app-version':'1'})]) {
    assert.throws(() => requireApplicationVersion({headers},2),/project changed/);
  }
});

test('isolated verification is disabled without explicit spend authorization and never imports or launches a provider',async () => {
  let called = false;
  const verifier = createIsolatedVerifier({loadSdk:async () => {called = true;throw Error();}});
  assert.equal((await verifier.verify({ownerId:'owner_a',authorizedOwnerId:'owner_a',projectId:'project_a'})).status,'blocked');
  assert.equal(called,false);
  await assert.rejects(verifier.verify({ownerId:'owner_a',authorizedOwnerId:'owner_b',projectId:'project_a'}),error => error.status === 403);
});

test('provider adapter binds receipts to owner/source, enforces resources and deny-all networking, and stops on failure',async () => {
  const events = [], env = {COMPASS_SANDBOX_MODE:'vercel',COMPASS_SANDBOX_SPEND_APPROVED:'true',VERCEL_TOKEN:'test-only',VERCEL_TEAM_ID:'team',VERCEL_PROJECT_ID:'project',COMPASS_SANDBOX_IMAGE:'vercel/test@sha256:' + 'a'.repeat(64)};
  const bundle = await createApplicationBundle(createApplicationManifest('An inventory application'));
  const verifier = createIsolatedVerifier({env,loadSdk:async () => ({Sandbox:{create:async options => {
    events.push(['create',options]);return {name:'provider_name',currentSession:() => ({sessionId:'provider_session'}),mkDir:async () => {},writeFiles:async files => {events.push(['files',files]);},runCommand:async options => {events.push(['command',options]);return {cmdId:'provider_command',exitCode:1};},stop:async () => {events.push(['stop']);}};
  }}})});
  const result = await verifier.verify({ownerId:'owner_a',authorizedOwnerId:'owner_a',projectId:'app_a',bundle});
  assert.equal(result.status,'failed');assert.equal(result.stopped,true);assert.equal(result.bundleSha256,bundle.sha256);
  const options = events[0][1];assert.equal(options.networkPolicy,'deny-all');assert.equal(options.persistent,false);assert.deepEqual(options.ports,[]);assert.equal(options.timeout,SANDBOX_LIMITS.timeoutMs);assert.equal(options.resources.vcpus,1);
  assert.equal('env' in options,false,'platform credentials are not injected into the VM');
  assert.equal(events.at(-1)[0],'stop');
  await assert.rejects(verifier.verify({ownerId:'owner_a',authorizedOwnerId:'owner_a',projectId:'app_a',bundle:{...bundle,files:bundle.files.map(file => file.path === 'server.mjs' ? {...file,content:'untrusted code'} : file)}}),error => error.code === 'untrusted_source');
});

test('sandbox capacity is reserved before asynchronous source preparation, so concurrent requests cannot exceed the cap',async () => {
  const env = {COMPASS_SANDBOX_MODE:'vercel',COMPASS_SANDBOX_SPEND_APPROVED:'true',VERCEL_TOKEN:'test-only',VERCEL_TEAM_ID:'team',VERCEL_PROJECT_ID:'project',COMPASS_SANDBOX_IMAGE:'vercel/test@sha256:' + 'a'.repeat(64)};
  const bundle = await createApplicationBundle(createApplicationManifest('A task tracker'));
  let calls = 0;
  const verifier = createIsolatedVerifier({env,loadSdk:async () => ({Sandbox:{create:async () => {
    calls++;return {name:'provider',currentSession:() => ({sessionId:'session'}),mkDir:async () => {},writeFiles:async () => {},runCommand:async () => ({cmdId:'command',exitCode:0}),stop:async () => {}};
  }}})});
  const options = {ownerId:'owner',authorizedOwnerId:'owner',projectId:'project',bundle};
  const result = await Promise.allSettled([verifier.verify(options),verifier.verify(options),verifier.verify(options)]);
  assert.equal(calls,2);
  assert.equal(result.filter(item => item.status === 'fulfilled').length,2);
  assert.equal(result.find(item => item.status === 'rejected').reason.code,'sandbox_capacity');
});

test('exported trusted source runs as a separate child server and passes actual auth, SQLite CRUD and owner-isolation tests',async t => {
  const root = await mkdtemp(join(tmpdir(),'compass-trusted-export-'));
  t.after(() => rm(root,{recursive:true,force:true}));
  const bundle = await createApplicationBundle(createApplicationManifest('A CRM called Forma'));
  for (const file of bundle.files) {const path = join(root,file.path);await mkdir(dirname(path),{recursive:true});await writeFile(path,file.content);}
  const modules = fileURLToPath(new URL('../node_modules',import.meta.url));
  await symlink(modules,join(root,'node_modules'),'dir');
  // Only the reviewed template above is run. No model- or user-supplied source
  // can enter this fixture; arbitrary generation/execution is not supported.
  const child = spawn(process.execPath,['--test','test/smoke.test.mjs'],{cwd:root,env:{PATH:process.env.PATH},stdio:['ignore','pipe','pipe']});
  let output = '';child.stdout.on('data',chunk => {output += chunk;});child.stderr.on('data',chunk => {output += chunk;});
  const timeout = setTimeout(() => child.kill('SIGKILL'),30000);
  const [code] = await once(child,'exit');clearTimeout(timeout);
  assert.equal(code,0,output.slice(-8000));assert.match(output,/# pass 1/);
});
