import {createPlatformStore} from './store.mjs';
import {applicationPlan} from './model.mjs';
import {activeProjectContext} from './project-context.mjs';
import {createApplicationBundle,exportApplicationZip,renderApplicationPreview,validateApplicationManifest} from '../generation/index.mjs';
import {createIntegrations} from '../integrations/index.mjs';
import {createBilling} from '../billing/index.mjs';
import {inspectStorage} from '../account/storage.mjs';
import {ASSET_LIMITS} from '../generation/image.mjs';
import {withUsageTracking} from '../usage.mjs';
import {crmEntities} from '../generation/crm/template/lib/records.mjs';
import {MOBILE_PLATFORMS} from '../generation/templates/lib/schema.mjs';

const fail=(status,code)=>{throw Object.assign(new Error(code),{status,code})};
export async function readRawBody(req,max=1048576) {
  const chunks=[];let length=0;
  for await(const chunk of req.iterator({destroyOnReturn:false})) {
    length+=chunk.length;if(length>max){req.resume();fail(413,'body_too_large')}chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export async function readBody(req,max=420000) {
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))fail(415,'json_required');
  const raw=await readRawBody(req,max);
  try {const value=JSON.parse(raw.toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value}
  catch {fail(400,'invalid_json')}
}
const fields=(value,allowed)=>{if(Object.keys(value).some(key=>!allowed.includes(key)))fail(400,'invalid_input');return value};
function applicationPrompt(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < 3 || text.length > 2000) fail(400, 'invalid_prompt');
  return text;
}
function requireVersion(version) {
  if (!Number.isSafeInteger(version) || version < 1) fail(400, 'version_required');
  return version;
}
export const integrationCallback=pathname=>/^\/api\/account\/integrations\/(github|google-drive|google-sheets|gmail|google-calendar|notion|slack)\/callback$/.test(pathname);
export const publicationPolicy="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox";

// Created only after exact-origin identity configuration has passed. Every
// private call is supplied an owner established by the server's DB session.
export function createPlatformApi({database,env,fetchImpl,accountStore,crmPreview}) {
  const store=createPlatformStore(database);
  const integrations=createIntegrations({database,env,fetchImpl});
  const billing=createBilling({database,env});
  const adminIds=new Set(String(env.COMPASS_ADMIN_USER_IDS||'').split(',').map(s=>s.trim()).filter(s=>/^[A-Za-z0-9_-]{1,128}$/.test(s)));
  const storage=()=>inspectStorage(env);
  const isAdmin=owner=>adminIds.has(owner);
  const recordUsage=(owner,operation,event)=>{accountStore.recordUsage(owner,operation,event);billing.recordUsage(owner,operation,event)};
  const confirmCrmBuild=async manifest=>{
    if (!manifest.crm) return;
    if (!crmPreview) fail(503,'crm_preview_unavailable');
    await crmPreview.scriptHash();
  };
  async function generate(owner,req,input,appId,{previewPlan=false}={}) {
    fields(input,appId?(previewPlan?['text','version']:['text']):['text','platform']);
    const text=applicationPrompt(input.text);
    const platform=input.platform;
    if (platform!==undefined&&!MOBILE_PLATFORMS.includes(platform)) fail(400,'invalid_platform');
    const version=previewPlan&&appId?requireVersion(input.version):null;
    // Receipts precede runtime/resource lookup, so lost replies replay after a
    // restart without charging again or creating a duplicate application.
    const operation=accountStore.beginOperation(owner,req.headers['idempotency-key'],
      {...(previewPlan?{kind:'application_plan',appId:appId||null,text,version}:{kind:'application',appId:appId||null,text}),...(platform?{platform}:{})});
    if(operation.replay)return operation.result;
    let reserved=false;
    try {
      const previous=appId?store.getApplication(owner,appId):null;
      if(version!==null&&previous.version!==version)fail(409,'version_conflict');
      const context=previous?store.context.get(owner,appId):null;
      if(!previous&&!previewPlan)store.assertApplicationCapacity(owner);
      billing.reserve(owner,operation.id);reserved=true;
      const plan=await withUsageTracking(event=>recordUsage(owner,operation.id,event),()=>applicationPlan({
        text,previous:previous?.manifest,preferences:accountStore.profile(owner).preferences,
        env,fetchImpl,review:previewPlan,projectContext:activeProjectContext(context),platform,
      }));
      await confirmCrmBuild(plan.manifest);
      const report=plan.manifest.crm?{buildReport:plan.buildReport||{outcome:'verified',diagnostics:[]}}:{};
      let result;
      store.atomic(()=>{
        if(context)store.context.assertVersion(owner,appId,context.version);
        if(previewPlan) {
          if(previous&&store.getApplication(owner,appId).version!==version)fail(409,'version_conflict');
          result={manifest:plan.manifest,source:plan.source,modelUsed:plan.modelUsed,baseVersion:previous?.version??null,contextVersion:context?.version??null,...report};
          billing.settle(owner,operation.id,{success:plan.source==='model',infrastructureCostMicros:null});
          accountStore.finishOperation(owner,operation.id,result);
          return;
        }
        const changed=!previous||plan.changed===true;
        let application;
        if(previous&&!changed){application=store.getApplication(owner,appId);if(application.version!==previous.version)fail(409,'version_conflict')}
        else application=previous?store.updateApplication(owner,appId,plan.manifest,text,plan.source,previous.version,report):store.createApplication(owner,plan.manifest,text,plan.source,report);
        result={application,source:plan.source,modelUsed:plan.modelUsed,changed,message:previous?(plan.message||(changed?'Application updated.':'No supported change requested.')):'Application created.',...report};
        // Prepared or rejected-model fallbacks release the hold. Missing real
        // infrastructure measurement keeps an accepted model in review.
        billing.settle(owner,operation.id,{success:plan.source==='model'&&result.changed,infrastructureCostMicros:null});
        accountStore.finishOperation(owner,operation.id,result);
      });
      return result;
    } catch(error) {
      accountStore.failOperation(owner,operation.id);
      if(reserved)billing.settle(owner,operation.id,{success:false,infrastructureCostMicros:null});
      store.event(owner,'application','build_failed');throw error;
    }
  }
  async function applyPlan(owner,req,input,appId) {
    fields(input,appId?['text','manifest','version','contextVersion']:['text','manifest']);
    const text=applicationPrompt(input.text);
    const manifest=validateApplicationManifest(input.manifest);
    if(!manifest)fail(400,'invalid_manifest');
    const version=appId?requireVersion(input.version):null;
    const contextVersion=input.contextVersion;
    if(contextVersion!==undefined&&(!Number.isSafeInteger(contextVersion)||contextVersion<0))fail(400,'invalid_context_version');
    await confirmCrmBuild(manifest);
    const report=manifest.crm?{buildReport:{outcome:'verified',diagnostics:[]}}:{};
    // Applying a reviewed manifest needs no upstream call or credit hold.
    // Record the receipt and revision in one transaction so retries are safe.
    return store.atomic(()=>{
      const operation=accountStore.beginOperation(owner,req.headers['idempotency-key'],
        {kind:'application_apply_plan',appId:appId||null,text,manifest,version,...(contextVersion!==undefined?{contextVersion}:{})});
      if(operation.replay)return operation.result;
      if(appId)store.context.assertVersion(owner,appId,contextVersion??0);
      const application=appId
        ?store.updateApplication(owner,appId,manifest,text,'prepared',version,report)
        :store.createApplication(owner,manifest,text,'prepared',report);
      const changed=application.version!==version;
      const result={application,source:'prepared',modelUsed:false,changed,
        message:appId?(changed?'Plan applied.':'No changes to apply.'):'Application created.'};
      accountStore.finishOperation(owner,operation.id,result);
      return result;
    });
  }
  function processMetrics() {
    const revision=env.RAILWAY_GIT_COMMIT_SHA||env.COMPASS_REVISION||'';
    return {sampledAt:new Date().toISOString(),uptimeSeconds:process.uptime(),nodeVersion:process.version,memoryBytes:process.memoryUsage(),revision:/^[a-f0-9]{7,64}$/i.test(revision)?revision:'local'};
  }
  function databaseMetrics() {
    try{return {engine:'sqlite',quickCheck:database.prepare('PRAGMA quick_check(1)').get()?.quick_check==='ok'?'ok':'failed'}}
    catch{return {engine:'sqlite',quickCheck:'unavailable'}}
  }
  async function handle(req,res,{url,owner,json}) {
    const path=url.pathname,method=req.method;
    if(path==='/api/account/capabilities'&&method==='GET'){json(200,{admin:isAdmin(owner),storage:await storage(),applications:true,publications:true,arbitraryExecution:false});return true}
    if(path==='/api/account/billing'&&method==='GET'){await billing.ready();json(200,{status:billing.status(),account:billing.account(owner)});return true}
    const pay=path.match(/^\/api\/account\/billing\/(checkout|portal|cancel)$/);
    if(pay&&method==='POST'){
      const input=await readBody(req,4096);fields(input,pay[1]==='checkout'?['offerId','requestKey']:pay[1]==='cancel'?['subscriptionId','requestKey']:[]);
      json(200,await billing[pay[1]](owner,input));return true;
    }
    if(path==='/api/account/integrations'&&method==='GET'){json(200,integrations.status(owner));return true}
    const integration=path.match(/^\/api\/account\/integrations\/([a-z-]+)(?:\/(connect|callback|read|export))?$/);
    if(integration){
      const [,provider,action]=integration;
      if(action==='connect'&&method==='POST')json(200,integrations.connect(owner,provider,await readBody(req,4096)));
      else if(!action&&method==='DELETE')json(200,await integrations.disconnect(owner,provider));
      else if(action==='read'&&method==='POST')json(200,await integrations.read(owner,provider,await readBody(req,8192)));
      else if(action==='export'&&provider==='github'&&method==='POST')json(200,await integrations.exportGitHub(owner,await readBody(req,600000)));
      else if(action==='callback'&&method==='GET'){
        const params=[...url.searchParams.keys()];if(params.some(key=>!['state','code'].includes(key))||new Set(params).size!==params.length)fail(400,'integration_invalid_callback');
        await integrations.callback(owner,provider,Object.fromEntries(url.searchParams));
        res.writeHead(303,{'Location':'/workspace?integration=connected','Cache-Control':'no-store'});res.end();
      }else json(405,{error:'method_not_allowed'});
      return true;
    }
    if(path==='/api/account/publications'){
      if(method==='GET')json(200,{publications:store.publications(owner)});
      else if(method==='POST'){const input=fields(await readBody(req,4096),['projectId']);json(200,{publication:store.publish(owner,accountStore.getProject(owner,input.projectId))})}
      else json(405,{error:'method_not_allowed'});return true;
    }
    const publication=path.match(/^\/api\/account\/publications\/([A-Za-z0-9_-]{1,80})$/);
    if(publication){if(method==='DELETE'){store.revokePublication(owner,publication[1]);json(200,{ok:true})}else json(405,{error:'method_not_allowed'});return true}
    if(path==='/api/account/admin'){
      if(!isAdmin(owner))fail(403,'admin_required');
      if(method!=='GET')json(405,{error:'method_not_allowed'});
      else json(200,{overview:store.overview(),billing:billing.monitor(),storage:await storage(),process:processMetrics(),database:databaseMetrics()});return true;
    }
    if(path==='/api/account/apps'){
      if(method==='GET')json(200,{applications:store.listApplications(owner)});
      else if(method==='POST')json(200,await generate(owner,req,await readBody(req,12000)));
      else json(405,{error:'method_not_allowed'});return true;
    }
    const planning=path.match(/^\/api\/account\/apps(?:\/([A-Za-z0-9_-]{1,80}))?\/(plan|build-plan)$/);
    if(planning&&method==='POST'){
      const [,id,action]=planning;
      const input=await readBody(req,action==='plan'?12000:32768);
      json(200,action==='plan'?await generate(owner,req,input,id,{previewPlan:true}):await applyPlan(owner,req,input,id));
      return true;
    }
    const context=path.match(/^\/api\/account\/apps\/([A-Za-z0-9_-]{1,80})\/context$/);
    if(context) {
      const id=context[1];
      if(method==='GET')json(200,{context:store.context.view(owner,id)});
      else if(method==='PUT') {
        const input=fields(await readBody(req,8192),['version','notes']);
        json(200,{context:store.context.saveNotes(owner,id,input.version,input.notes)});
      } else if(method==='POST') {
        const input=fields(await readBody(req,4096),['version','action','text','id','status']);
        json(200,{context:store.context.record(owner,id,input)});
      } else json(405,{error:'method_not_allowed'});
      return true;
    }
    const githubImport=path.match(/^\/api\/account\/apps\/([A-Za-z0-9_-]{1,80})\/github-import\/(review|apply)$/);
    if(githubImport) {
      if(method!=='POST'){json(405,{error:'method_not_allowed'});return true}
      const [,id,action]=githubImport;
      const application=store.getApplication(owner,id);
      const contextVersion=store.context.get(owner,id).version;
      if(action==='review') {
        const input=fields(await readBody(req,4096),['repository','branch','version']);
        if(requireVersion(input.version)!==application.version)fail(409,'version_conflict');
        const review=await integrations.reviewGitHubManifest(owner,input,{application,contextVersion});
        if(store.getApplication(owner,id).version!==application.version)fail(409,'version_conflict');
        store.context.assertVersion(owner,id,contextVersion);
        json(200,review);
      } else {
        const {ticket}=fields(await readBody(req,48000),['ticket']);
        const approved=await integrations.applyGitHubManifest(owner,ticket,{application,contextVersion});
        const saved=store.atomic(()=>{
          store.context.assertVersion(owner,id,approved.contextVersion);
          return store.updateApplication(owner,id,approved.manifest,
            `Import manifest from ${approved.repository}@${approved.branch} (${approved.commitSha})`,'prepared',approved.version);
        });
        json(200,{application:saved,changed:saved.version!==application.version,commitSha:approved.commitSha});
      }
      return true;
    }
    const crmRecord=path.match(/^\/api\/account\/apps\/([A-Za-z0-9_-]{1,80})\/crm\/([a-z]+)(?:\/(crm_[a-z0-9-]{36}))?$/);
    if (crmRecord) {
      const [,appId,entity,id]=crmRecord;
      const appVersion=requireVersion(Number(req.headers['x-compass-app-version']));
      if (method==='GET'&&!id) json(200,{records:store.crm.list(owner,appId,entity,appVersion)});
      else if ((!id&&method==='POST')||(id&&method==='PUT')) {
        const {data,version}=fields(await readBody(req,8192),id?['data','version']:['data']);
        json(200,{record:store.crm.save(owner,appId,entity,appVersion,data,id,version)});
      } else if (id&&method==='DELETE') {
        store.crm.deleteRecord(owner,appId,entity,appVersion,id,Number(req.headers['x-compass-record-version']));
        json(200,{ok:true});
      } else json(405,{error:'method_not_allowed'});
      return true;
    }
    const app=path.match(/^\/api\/account\/apps\/([A-Za-z0-9_-]{1,80})(?:\/(refine|design|revisions|restore|records|preview|source|export|data|manifest|assets)(?:\/([A-Za-z0-9_-]{1,80}))?)?$/);
    if(!app)return false;
    const [,appId,action,recordId]=app;
    if(action==='refine'&&method==='POST'&&!recordId){json(200,await generate(owner,req,await readBody(req,12000),appId));return true}
    const current=store.getApplication(owner,appId);
    if(!action){if(method==='GET')json(200,{application:current});else if(method==='DELETE'){store.deleteApplication(owner,appId);json(200,{ok:true})}else json(405,{error:'method_not_allowed'});return true}
    const expectedVersion=()=>{const value=req.headers['x-compass-app-version'];if(typeof value!=='string'||!/^\d{1,10}$/.test(value)||Number(value)<1)fail(400,'version_required');return Number(value)};
    if(action==='assets'){
      if(current.manifest.crm)fail(404,'not_found');
      if(!recordId&&method==='GET'){res.setHeader('X-Compass-App-Version',String(current.version));json(200,store.listAssets(owner,appId))}
      else if(!recordId&&method==='POST'){
        const version=expectedVersion();if(version!==current.version)fail(409,'version_conflict');
        const mime=String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
        if(!['image/png','image/jpeg'].includes(mime))fail(415,'image_type_unsupported');
        const result=store.saveAsset(owner,appId,await readRawBody(req,ASSET_LIMITS.fileBytes),mime,version);res.setHeader('X-Compass-App-Version',String(result.application.version));json(200,result);
      }else if(recordId&&method==='GET'){
        if(req.headers['x-compass-app-version']!==undefined&&expectedVersion()!==current.version)fail(409,'version_conflict');
        const asset=store.getAsset(owner,appId,recordId);res.writeHead(200,{'Content-Type':asset.mime,'Content-Length':asset.bytes,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Compass-App-Version':String(current.version),'Content-Disposition':'inline; filename="'+asset.id+(asset.mime==='image/png'?'.png':'.jpg')+'"'});res.end(asset.data);
      }else if(recordId&&method==='DELETE'){const result=store.deleteAsset(owner,appId,recordId,expectedVersion());res.setHeader('X-Compass-App-Version',String(result.application.version));json(200,result)}
      else json(405,{error:'method_not_allowed'});return true;
    }
    if(action==='manifest'&&!recordId&&method==='PUT'){
      const input=fields(await readBody(req,32768),['manifest','version']);
      if(!Number.isSafeInteger(input.version)||input.version<1)fail(400,'version_required');
      const manifest=validateApplicationManifest(input.manifest);if(!manifest)fail(400,'invalid_manifest');
      const application=store.updateApplication(owner,appId,manifest,'Edit application manifest','prepared',input.version),changed=application.version!==current.version;
      const files=store.revisions(owner,appId).find(revision=>revision.version===application.version);
      res.setHeader('X-Compass-App-Version',String(application.version));json(200,{application,changed,changes:changed?files?.changes||[]:[],files:files?.files||[]});return true;
    }
    if(action==='records'){
      if(current.manifest.crm)fail(404,'not_found');
      if(!recordId&&method==='GET')json(200,{records:store.listRecords(owner,appId)});
      else if((!recordId&&method==='POST')||(recordId&&method==='PUT')){const input=fields(await readBody(req,20000),['data']);json(200,{record:store.saveRecord(owner,appId,input.data,recordId)})}
      else if(recordId&&method==='DELETE'){store.deleteRecord(owner,appId,recordId);json(200,{ok:true})}else json(405,{error:'method_not_allowed'});return true;
    }
    if(recordId)fail(404,'not_found');
    if(action==='design'&&method==='PUT'){
      const input=fields(await readBody(req,4096),['theme','version']);
      if(!Number.isSafeInteger(input.version)||!validateApplicationManifest({...current.manifest,theme:input.theme}))fail(400,'invalid_design');
      json(200,{application:store.updateApplication(owner,appId,{...current.manifest,theme:input.theme},'Update appearance','prepared',input.version)});return true;
    }
    if(action==='restore'&&method==='POST'){const input=fields(await readBody(req,4096),['version']);json(200,{application:store.restore(owner,appId,input.version)});return true}
    if(method!=='GET'){json(405,{error:'method_not_allowed'});return true}
    if(['preview','source','export','data'].includes(action))res.setHeader('X-Compass-App-Version',String(current.version));
    if(action==='revisions'){json(200,{revisions:store.revisions(owner,appId)});return true}
    if(action==='preview'){
      await confirmCrmBuild(current.manifest);
      const html=current.manifest.crm?await crmPreview.render(current.manifest):await renderApplicationPreview(current.manifest);
      // This is a trusted template driven by a validated data manifest. It is
      // never executed on the delivery server. The browser adds sandbox.
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex','Content-Security-Policy':"default-src 'none'; sandbox allow-scripts; frame-ancestors 'self'"});res.end(html);return true;
    }
    if(action==='source'){json(200,await createApplicationBundle(current.manifest,{assets:store.activeAssets(owner,appId),trustedAssets:true}));return true}
    if(action==='data'){
      res.setHeader('Content-Disposition','attachment; filename="compass-application-data.json"');
      const records=current.manifest.crm
        ?Object.fromEntries(crmEntities.map(entity=>[entity,store.crm.list(owner,appId,entity,current.version)]))
        :store.listRecords(owner,appId);
      json(200,{manifest:current.manifest,records,exportedAt:new Date().toISOString()});return true;
    }
    if(action==='export'){
      const data=exportApplicationZip(await createApplicationBundle(current.manifest,{assets:store.activeAssets(owner,appId),trustedAssets:true}));
      res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="compass-application.zip"','Content-Length':data.length,'Cache-Control':'no-store'});res.end(data);return true;
    }
    return false;
  }
  return {handle,billing,recordUsage,storage,finishOperation:(owner,operation,result,outcome)=>store.atomic(()=>{billing.settle(owner,operation,outcome);accountStore.finishOperation(owner,operation,result)}),publicPage:id=>store.publicPage(id)};
}
