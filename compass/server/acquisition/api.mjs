import {createPool,migrate,createStore} from './store.mjs';
import {createAuth} from './auth.mjs';
import {createProviders} from './providers/index.mjs';
import {createWorker} from './worker.mjs';
import {problem} from './domain.mjs';
import {createAcquisitionVoiceRuntime} from './voice.mjs';

function json(res,status,body){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));}
async function body(req){
  let raw='';for await(const chunk of req.iterator({destroyOnReturn:false})){raw+=chunk;if(Buffer.byteLength(raw)>16384){req.resume();throw problem('Request too large.',413);}}
  try{const value=JSON.parse(raw||'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw 0;return value;}catch{throw problem('Invalid JSON.');}
}
export async function createAcquisition({env=process.env,pool:injectedPool,providers:injectedProviders,auth:injectedAuth,startWorker=true}={}){
  const providers=injectedProviders||createProviders({env});
  const pool=injectedPool||createPool(env);
  let store,auth,worker,database='blocked';
  if(pool){
    try{
      await migrate(pool);
      auth=injectedAuth||await createAuth({pool,env});
      store=createStore(pool);database='ready';
      worker=createWorker({store,providers,enabled:env.ACQUISITION_SPONSOR_CALLS_ENABLED==='true'});
      if(startWorker)worker.start();
    }catch(e){console.error('[acquisition] initialization blocked:',e.code||e.name);}
  }
  const limits=new Map(),streams=new Set();
  function limit(req,path){
    const now=Date.now();
    for(const [key,val]of limits)if(val.until<now)limits.delete(key);
    // Do not trust arbitrary X-Forwarded-For. The proxy-shared limit is conservative.
    const key=`${req.socket.remoteAddress}|${path==='/api/early-access'?'early':'api'}`;
    const record=limits.get(key)||{count:0,until:now+60000};
    if(++record.count>(path==='/api/early-access'?5:120))throw problem('Too many requests. Try again in a minute.',429);
    if(limits.size>10000&&!limits.has(key))throw problem('Server busy.',503);
    limits.set(key,record);
  }
  function sameOrigin(req){
    if(['GET','HEAD'].includes(req.method))return;
    const expected=new URL(env.BETTER_AUTH_URL||`http://localhost:${env.PORT||8770}`).origin;
    const origin=req.headers.origin;
    if(origin!==expected)throw problem('A same-origin request is required.',403,'origin_rejected');
    if(!/^application\/json\b/.test(req.headers['content-type']||''))throw problem('Use application/json.',415);
  }
  const voiceEnabled=()=>database==='ready'&&env.ACQUISITION_VOICE_ENABLED==='true'&&env.ACQUISITION_SPONSOR_CALLS_ENABLED==='true';
  const status=()=>({database,integrations:providers.status(),billingEnabled:false,sponsorCallsEnabled:env.ACQUISITION_SPONSOR_CALLS_ENABLED==='true',voice:{status:voiceEnabled()?'configured':'blocked',reason:voiceEnabled()?'Existing speech transport, authenticated lead-response capture. Provider availability is verified on connection.':'Acquisition voice input is disabled. Use text; the existing transport is preserved.'}});
  async function handle(req,res){
    const path=new URL(req.url,'http://localhost').pathname;
    if(!path.startsWith('/api/acquisition/')&&!path.startsWith('/api/auth/')&&path!=='/api/early-access')return false;
    try{
      sameOrigin(req);limit(req,path);
      if(path==='/api/acquisition/status'&&req.method==='GET'){json(res,200,status());return true;}
      if(!store||!auth)throw problem('Persistent workspace unavailable. PostgreSQL and secure authentication must be configured before use.',503,'database_blocked');
      if(path.startsWith('/api/auth/')||path==='/api/acquisition/accept-invite'){await auth.handle(req,res);return true;}
      if(path==='/api/early-access'&&req.method==='POST'){json(res,201,await store.saveEarlyAccess(await body(req)));return true;}
      const identity=await auth.getIdentity(req);
      if(!identity)throw problem('Sign in with your invited account.',401,'unauthorized');
      const tenant=identity.tenantId;
      const state=()=>store.state(tenant,providers.status());
      if(path==='/api/acquisition/events'&&req.method==='GET'){
        if(streams.size>=100)throw problem('Too many streams.',429);
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});
        streams.add(res);let closed=false,last='',pending=false;
        const send=async()=>{if(pending||closed)return;pending=true;try{
          const current=await auth.getIdentity(req);
          if(!current||current.tenantId!==tenant){res.end();return;}
          const value=JSON.stringify(await state());if(value!==last){res.write(`event: state\ndata: ${value}\n\n`);last=value;}else res.write(': heartbeat\n\n');
        }catch{res.end();}finally{pending=false;}};
        const timer=setInterval(send,2500);timer.unref();res.on('close',()=>{closed=true;clearInterval(timer);streams.delete(res);});await send();return true;
      }
      if(req.method==='GET'){
        const current=await state();
        if(path==='/api/acquisition/state')json(res,200,current);
        else if(path==='/api/acquisition/metrics')json(res,200,{metrics:current.metrics});
        else if(['projects','experiments','leads','runs'].some(k=>path===`/api/acquisition/${k}`)){const k=path.split('/').pop();json(res,200,{[k]:k==='projects'?(current.project?[current.project]:[]):current[k]});}
        else throw problem('Not found.',404);
        return true;
      }
      if(req.method!=='POST')throw problem('Method not allowed.',405);
      const input=await body(req);
      // Client-supplied tenant/mode are never interpreted as authority.
      if('tenantId'in input||'tenant_id'in input||'mode'in input)throw problem('Workspace and mode are server-controlled.',400);
      if(path==='/api/acquisition/projects'){await store.saveProject(tenant,input);json(res,200,{state:await state()});}
      else if(path==='/api/acquisition/experiments'){await store.addExperiment(tenant,input);json(res,201,{state:await state()});}
      else if(path==='/api/acquisition/leads'){await store.addLead(tenant,input);json(res,201,{state:await state()});}
      else if(path==='/api/acquisition/events'){const result=await store.applyEvent(tenant,input);json(res,200,{...result,state:await state()});}
      else if(path==='/api/acquisition/runs'){json(res,202,{run:await store.addRun(tenant,input)});}
      else if(/^\/api\/acquisition\/runs\/[^/]+\/resume$/.test(path)){json(res,200,{run:await store.resumeRun(tenant,path.split('/')[4])});}
      else throw problem('Not found.',404);
    }catch(error){
      if(!res.headersSent)json(res,Number.isInteger(error.status)?error.status:500,{error:error.status?error.message:'Unable to complete this request. No success is assumed.',code:error.status?error.code||'request_failed':'internal_error'});
      else res.end();
    }
    return true;
  }
  async function authorizeVoice(req,url){
    if(url.searchParams.get('domain')!=='acquisition')return null;
    if(!voiceEnabled())throw problem('Acquisition voice is disabled.',503);
    const expected=new URL(env.BETTER_AUTH_URL).origin;
    if(req.headers.origin!==expected)throw problem('Same origin required.',403);
    const identity=await auth.getIdentity(req);
    if(!identity)throw problem('Sign in first.',401);
    const isAuthorized=async()=>{try{const current=await auth.getIdentity(req);return current?.tenantId===identity.tenantId&&current?.userId===identity.userId;}catch{return false;}};
    return createAcquisitionVoiceRuntime({store,identity,leadId:url.searchParams.get('leadId'),isAuthorized});
  }
  return {handle,status,store,worker,authorizeVoice,getIdentity:req=>auth?auth.getIdentity(req):Promise.resolve(null),async close(){for(const res of streams)res.end();await worker?.stop();await auth?.close?.();if(pool&&!injectedPool)await pool.end();}};
}
