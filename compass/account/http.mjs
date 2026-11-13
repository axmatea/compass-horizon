import { createSiteBuilder, publicTurn, validateResumeIntent, MAX_TEXT } from '../builder/index.mjs';
import { createAccountStore } from './store.mjs';
import { withUsageTracking } from '../usage.mjs';

async function body(req, max = 420000) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw Object.assign(new Error(), {status:415,code:'json_required'});
  const chunks = []; let size = 0;
  for await (const chunk of req.iterator({destroyOnReturn:false})) {
    size += chunk.length;
    if (size > max) { req.resume(); throw Object.assign(new Error(), {status:413,code:'body_too_large'}); }
    chunks.push(chunk);
  }
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
  catch { throw Object.assign(new Error(), {status:400,code:'invalid_json'}); }
}
export function createAccountApi({ auth, env, fetchImpl }) {
  const site = createSiteBuilder({env,fetchImpl});
  const owners = new Map();
  let store;
  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/account/')) return false;
    const json = (status, value) => {
      res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      res.end(JSON.stringify(value));
    };
    try {
      await auth.ready;
      const config = auth.publicConfig();
      if (url.pathname === '/api/account/config' && req.method === 'GET') {
        json(200, {...config,persistence:config.configured ? 'ephemeral-preview' : 'unavailable'}); return true;
      }
      if (!config.configured) { json(503, {error:'accounts_unavailable'}); return true; }
      const origin = config.origin;
      if (req.headers.host !== new URL(origin).host
          || (req.headers.origin !== undefined && req.headers.origin !== origin)
          || (req.headers['sec-fetch-site'] && !['same-origin','none'].includes(req.headers['sec-fetch-site']))
          || (!['GET','HEAD'].includes(req.method) && req.headers.origin !== origin)) {
        json(403, {error:'invalid_origin'}); return true;
      }
      const headers = new Headers();
      for (const name of ['cookie','origin','sec-fetch-site']) if (typeof req.headers[name] === 'string') headers.set(name, req.headers[name]);
      const identity = await auth.getIdentity(headers);
      if (!identity) { json(401, {error:'sign_in_required'}); return true; }
      // A consistency guard for an already-open tab after another tab switches
      // accounts. This header never establishes identity or grants access.
      if (req.headers['x-compass-user'] !== undefined && req.headers['x-compass-user'] !== identity.userId) {
        json(403,{error:'account_changed'}); return true;
      }
      store ||= createAccountStore(auth.database);
      const owner = identity.userId;
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
      if (url.pathname === '/api/account/usage' && req.method === 'GET') { json(200, store.usage(owner)); return true; }
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
        const operation = store.beginOperation(owner, req.headers['idempotency-key'], {text,sessionId,resumeIntent});
        if (operation.replay) { json(200,operation.result); return true; }
        if (sessionId && (owners.get(sessionId) !== owner || !site.runtime.getSession(sessionId))) {
          store.failOperation(owner,operation.id); json(404,{error:'session_not_found'}); return true;
        }
        try {
          // A separate runtime prevents public API/session URLs from reaching
          // an authenticated user's generated page. Only verified owners enter.
          const result = publicTurn(await withUsageTracking(event => store.recordUsage(owner,operation.id,event),
            () => site.runtime.runTurn(sessionId,text,{resumeIntent,preferences})));
          if (!result.html || result.pending.length) throw new Error('Incomplete preview');
          owners.set(result.sessionId,owner);
          if (owners.size > 600) for (const id of owners.keys()) if (!site.runtime.getSession(id)) owners.delete(id);
          store.finishOperation(owner,operation.id,result);
          json(200,result);
        } catch {
          store.failOperation(owner,operation.id);
          json(503,{error:'build_failed'});
        }
        return true;
      }
      json(404,{error:'not_found'}); return true;
    } catch (error) {
      json(Number.isInteger(error?.status) ? error.status : 503, {error:error?.code || 'accounts_unavailable'}); return true;
    }
  };
}
