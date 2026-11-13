import { createSiteBuilder, publicTurn, validateResumeIntent, MAX_TEXT } from '../builder/index.mjs';
import { createAccountStore } from './store.mjs';
import { withUsageTracking } from '../usage.mjs';
import {createPlatformApi,readBody as body,readRawBody,integrationCallback,publicationPolicy} from '../platform/http.mjs';
import {inspectStorage} from './storage.mjs';
import {createAccountRateLimiter} from './rate-limit.mjs';

export function createAccountApi({ auth, env, fetchImpl,rateLimitNow=Date.now }) {
  const limiter=createAccountRateLimiter({now:rateLimitNow});
  let site;
  const owners = new Map();
  let store,platform;
  const services=()=>{store ||= createAccountStore(auth.database);platform ||= createPlatformApi({database:auth.database,env,fetchImpl,accountStore:store});return platform};
  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const publication=url.pathname.match(/^\/published\/([A-Za-z0-9_-]{1,80})$/);
    const webhook=url.pathname==='/api/billing/webhook';
    if (!url.pathname.startsWith('/api/account/')&&!publication&&!webhook) return false;
    const json = (status, value) => {
      res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      res.end(JSON.stringify(value));
    };
    try {
      await auth.ready;
      const config = auth.publicConfig();
      if (url.pathname === '/api/account/config' && req.method === 'GET') {
        const storage=config.configured?await inspectStorage(env):{mode:'unavailable',dependencies:['accounts_unavailable']};
        json(200, {...config,persistence:storage.mode,storage}); return true;
      }
      if (!config.configured) { json(publication?404:503, {error:publication?'not_found':'accounts_unavailable'}); return true; }
      const origin = config.origin;
      if(webhook) {
        if(req.headers.host!==new URL(origin).host){json(403,{error:'invalid_origin'});return true}
        if(req.method!=='POST'){json(405,{error:'method_not_allowed'});return true}
        json(200,await services().billing.webhook(await readRawBody(req),req.headers['stripe-signature']));return true;
      }
      if(publication) {
        if(!['GET','HEAD'].includes(req.method)){json(405,{error:'method_not_allowed'});return true}
        if(req.headers.host!==new URL(origin).host){json(404,{error:'not_found'});return true}
        const html=services().publicPage(publication[1]);
        if(!html){json(404,{error:'not_found'});return true}
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex','Content-Security-Policy':publicationPolicy});res.end(req.method==='HEAD'?undefined:html);return true;
      }
      const callback=req.method==='GET'&&integrationCallback(url.pathname);
      if (req.headers.host !== new URL(origin).host
          || (!callback && req.headers.origin !== undefined && req.headers.origin !== origin)
          || (!callback && req.headers['sec-fetch-site'] && !['same-origin','none'].includes(req.headers['sec-fetch-site']))
          || (!['GET','HEAD'].includes(req.method) && req.headers.origin !== origin)) {
        json(403, {error:'invalid_origin'}); return true;
      }
      const headers = new Headers();
      // Cross-site OAuth entry is the only exception: exact Host was checked
      // above and the provider callback must next consume this owner's state.
      // Keep getIdentity's default metadata restrictions for all other APIs.
      for (const name of (callback?['cookie']:['cookie','origin','sec-fetch-site'])) if (typeof req.headers[name] === 'string') headers.set(name, req.headers[name]);
      const identity = await auth.getIdentity(headers);
      if (!identity) { json(401, {error:'sign_in_required'}); return true; }
      // A consistency guard for an already-open tab after another tab switches
      // accounts. This header never establishes identity or grants access.
      if (req.headers['x-compass-user'] !== undefined && req.headers['x-compass-user'] !== identity.userId) {
        json(403,{error:'account_changed'}); return true;
      }
      const gate=limiter.check(identity.userId,{method:req.method,path:url.pathname});
      if(!gate.allowed){res.setHeader('Retry-After',String(gate.retryAfterSeconds));json(429,{error:'account_rate_limited'});return true;}
      store ||= createAccountStore(auth.database);
      const owner = identity.userId;
      const features=services();
      if(await features.handle(req,res,{url,owner,json}))return true;
      if (url.pathname === '/api/account/me' && req.method === 'GET') { json(200, identity); return true; }
      if (url.pathname === '/api/account/profile') {
        if (req.method === 'GET') json(200, store.profile(owner));
        else if (req.method === 'PUT') json(200, store.saveProfile(owner, await body(req, 4096)));
        else json(405, {error:'method_not_allowed'});
        return true;
      }
      if (url.pathname === '/api/account/projects') {
        if (req.method === 'GET') json(200, {projects:store.listProjects(owner)});
        else if (req.method === 'POST') json(200, {project:store.saveProject(owner, await body(req))});
        else json(405, {error:'method_not_allowed'});
        return true;
      }
      const project = url.pathname.match(/^\/api\/account\/projects\/([A-Za-z0-9_-]{1,80})$/);
      if (project) {
        if (req.method === 'GET') json(200, {project:store.getProject(owner,project[1])});
        else if (req.method === 'DELETE') { store.deleteProject(owner,project[1]); json(200,{ok:true}); }
        else json(405, {error:'method_not_allowed'});
        return true;
      }
      if (url.pathname === '/api/account/usage' && req.method === 'GET') { const status=features.billing.status();json(200, {...store.usage(owner),billingEnabled:status.billingEnabled,creditsEnabled:status.creditsEnabled}); return true; }
      if (url.pathname === '/api/account/turn' && req.method === 'POST') {
        const input = await body(req,32768);
        const text = typeof input.text === 'string' ? input.text.trim() : '';
        if (!text || text.length > MAX_TEXT) { json(400,{error:!text ? 'text_required' : 'text_too_long'}); return true; }
        const sessionId = typeof input.sessionId === 'string' && input.sessionId ? input.sessionId : null;
        let resumeIntent = null;
        if (!sessionId && input.resumeIntent !== undefined) {
          resumeIntent = validateResumeIntent(input.resumeIntent);
          if (!resumeIntent) { json(400,{error:'invalid_resume_intent'}); return true; }
        }
        const preferences = store.profile(owner).preferences;
        site ||= createSiteBuilder({env,fetchImpl});
        const operation = store.beginOperation(owner, req.headers['idempotency-key'], {text,sessionId,resumeIntent});
        if (operation.replay) { json(200,operation.result); return true; }
        if (sessionId && (owners.get(sessionId) !== owner || !site.runtime.getSession(sessionId))) {
          store.failOperation(owner,operation.id); json(404,{error:'session_not_found'}); return true;
        }
        let reserved=false;
        try {
          features.billing.reserve(owner,operation.id);reserved=true;
          // A separate runtime prevents public API/session URLs from reaching
          // an authenticated user's generated page. Only verified owners enter.
          const result = publicTurn(await withUsageTracking(event => features.recordUsage(owner,operation.id,event),
            () => site.runtime.runTurn(sessionId,text,{resumeIntent,preferences})));
          if (!result.html || result.pending.length) throw new Error('Incomplete preview');
          owners.set(result.sessionId,owner);
          if (owners.size > 600) for (const id of owners.keys()) if (!site.runtime.getSession(id)) owners.delete(id);
          features.finishOperation(owner,operation.id,result,{success:result.source==='model',infrastructureCostMicros:null});
          json(200,result);
        } catch (error) {
          if(reserved)features.billing.settle(owner,operation.id,{success:false,infrastructureCostMicros:null});
          store.failOperation(owner,operation.id);
          json(Number.isInteger(error?.status)?error.status:503,{error:error?.code||'build_failed'});
        }
        return true;
      }
      json(404,{error:'not_found'}); return true;
    } catch (error) {
      json(Number.isInteger(error?.status) ? error.status : 503, {error:error?.code || 'accounts_unavailable'}); return true;
    }
  };
}
