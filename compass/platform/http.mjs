import {createPlatformStore} from './store.mjs';
import {applicationPlan} from './model.mjs';
import {createApplicationBundle,exportApplicationZip,renderApplicationPreview,validateApplicationManifest} from '../generation/index.mjs';
import {createIntegrations} from '../integrations/index.mjs';
import {createBilling} from '../billing/index.mjs';
import {inspectStorage} from '../account/storage.mjs';
import {withUsageTracking} from '../usage.mjs';

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
export const integrationCallback=pathname=>/^\/api\/account\/integrations\/(github|google-drive|google-sheets|gmail|google-calendar|notion|slack)\/callback$/.test(pathname);
export const publicationPolicy="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox";

// Created only after exact-origin preview configuration has passed. Every
// private call is supplied an owner established by the server's DB session.
export function createPlatformApi({database,env,fetchImpl,accountStore}) {
  const store=createPlatformStore(database);
  const integrations=createIntegrations({database,env,fetchImpl});
  const billing=createBilling({database,env});
  const adminIds=new Set(String(env.COMPASS_ADMIN_USER_IDS||'').split(',').map(s=>s.trim()).filter(s=>/^[A-Za-z0-9_-]{1,128}$/.test(s)));
  const storage=()=>inspectStorage(env);
  const isAdmin=owner=>adminIds.has(owner);
  const recordUsage=(owner,operation,event)=>{accountStore.recordUsage(owner,operation,event);billing.recordUsage(owner,operation,event)};
  async function generate(owner,req,input,appId) {
    fields(input,['text']);
    const text=typeof input.text==='string'?input.text.trim():'';
    if(text.length<3||text.length>2000)fail(400,'invalid_prompt');
    // Receipts precede runtime/resource lookup, so lost replies replay after a
    // restart without charging again or creating a duplicate application.
    const operation=accountStore.beginOperation(owner,req.headers['idempotency-key'],{kind:'application',appId:appId||null,text});
    if(operation.replay)return operation.result;
    let reserved=false;
    try {
      const previous=appId?store.getApplication(owner,appId):null;
      if(!previous)store.assertApplicationCapacity(owner);
      billing.reserve(owner,operation.id);reserved=true;
      const plan=await withUsageTracking(event=>recordUsage(owner,operation.id,event),()=>applicationPlan({text,previous:previous?.manifest,preferences:accountStore.profile(owner).preferences,env,fetchImpl}));
      let result;
      store.atomic(()=>{
        const changed=!previous||plan.changed===true;
        let application;
        if(previous&&!changed){application=store.getApplication(owner,appId);if(application.version!==previous.version)fail(409,'version_conflict')}
        else application=previous?store.updateApplication(owner,appId,plan.manifest,text,plan.source,previous.version):store.createApplication(owner,plan.manifest,text,plan.source);
        result={application,source:plan.source,modelUsed:plan.modelUsed,changed,message:previous?(plan.message||(changed?'Application updated.':'No supported change requested.')):'Application created.'};
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
    if(path==='/api/account/billing'&&method==='GET'){json(200,{status:billing.status(),account:billing.account(owner)});return true}
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
    const app=path.match(/^\/api\/account\/apps\/([A-Za-z0-9_-]{1,80})(?:\/(refine|design|revisions|restore|records|preview|source|export|data)(?:\/([A-Za-z0-9_-]{1,80}))?)?$/);
    if(!app)return false;
    const [,appId,action,recordId]=app;
    if(action==='refine'&&method==='POST'&&!recordId){json(200,await generate(owner,req,await readBody(req,12000),appId));return true}
    const current=store.getApplication(owner,appId);
    if(!action){if(method==='GET')json(200,{application:current});else if(method==='DELETE'){store.deleteApplication(owner,appId);json(200,{ok:true})}else json(405,{error:'method_not_allowed'});return true}
    if(action==='records'){
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
      const html=await renderApplicationPreview(current.manifest);
      // This is a trusted template driven by a validated data manifest. It is
      // never executed on the delivery server. The browser adds sandbox.
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex','Content-Security-Policy':"default-src 'none'; sandbox allow-scripts; frame-ancestors 'self'"});res.end(html);return true;
    }
    if(action==='source'){json(200,await createApplicationBundle(current.manifest));return true}
    if(action==='data'){
      res.setHeader('Content-Disposition','attachment; filename="compass-application-data.json"');
      json(200,{manifest:current.manifest,records:store.listRecords(owner,appId),exportedAt:new Date().toISOString()});return true;
    }
    if(action==='export'){
      const data=exportApplicationZip(await createApplicationBundle(current.manifest));
      res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="compass-application.zip"','Content-Length':data.length,'Cache-Control':'no-store'});res.end(data);return true;
    }
    return false;
  }
  return {handle,billing,recordUsage,storage,finishOperation:(owner,operation,result,outcome)=>store.atomic(()=>{billing.settle(owner,operation,outcome);accountStore.finishOperation(owner,operation,result)}),publicPage:id=>store.publicPage(id)};
}
