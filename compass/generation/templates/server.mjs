// COMPASS trusted application template. Only the bounded manifest is generated.
import {createServer} from 'node:http';
import {readFile,mkdir,chmod} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {betterAuth} from 'better-auth';
import {getMigrations} from 'better-auth/db/migration';
import {APIError} from 'better-auth/api';
import {validateApplicationManifest,validateApplicationRecord} from './lib/schema.mjs';

const folder = dirname(fileURLToPath(import.meta.url));
const STATIC = new Map([['/',['index.html','text/html; charset=utf-8']],['/app.js',['app.js','text/javascript; charset=utf-8']],['/client-core.js',['client-core.js','text/javascript; charset=utf-8']],['/styles.css',['styles.css','text/css; charset=utf-8']]]);
const AUTH = new Map([['/api/auth/sign-up/email','POST'],['/api/auth/sign-in/email','POST'],['/api/auth/get-session','GET'],['/api/auth/sign-out','POST']]);
const error = (status,code) => Object.assign(new Error(code),{status,code});
async function jsonBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw error(415,'json_required');
  const chunks = []; let size = 0;
  for await (const chunk of req.iterator({destroyOnReturn:false})) {
    size += chunk.length;
    if (size > 20000) {req.resume();throw error(413,'body_too_large');}
    chunks.push(chunk);
  }
  try {const value = JSON.parse(Buffer.concat(chunks));if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();return value;}
  catch {throw error(400,'invalid_json');}
}

export async function startApplication({env = process.env} = {}) {
  const manifest = validateApplicationManifest(JSON.parse(await readFile(resolve(folder,'manifest.json'),'utf8')));
  if (!manifest) throw Error('Invalid application manifest.');
  if (typeof env.BETTER_AUTH_SECRET !== 'string' || env.BETTER_AUTH_SECRET.length < 32) throw Error('Set a BETTER_AUTH_SECRET of at least 32 characters.');
  const production = env.NODE_ENV === 'production';
  const requestedOrigin = env.APP_ORIGIN ? new URL(env.APP_ORIGIN) : null;
  if (requestedOrigin && (requestedOrigin.pathname !== '/' || requestedOrigin.search || requestedOrigin.hash || requestedOrigin.username || requestedOrigin.password)) throw Error('APP_ORIGIN must be an exact origin.');
  if (production && requestedOrigin?.protocol !== 'https:') throw Error('Production requires an HTTPS APP_ORIGIN.');
  if (requestedOrigin && !['https:','http:'].includes(requestedOrigin.protocol)) throw Error('Invalid application origin.');
  if (!production && requestedOrigin?.protocol === 'http:' && !['localhost','127.0.0.1','[::1]'].includes(requestedOrigin.hostname)) throw Error('Use HTTPS outside localhost.');
  const databasePath = resolve(env.APP_DATABASE || './data/app.sqlite');
  await mkdir(dirname(databasePath),{recursive:true,mode:0o700});
  const db = new DatabaseSync(databasePath);
  await chmod(databasePath,0o600);
  db.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000;CREATE TABLE IF NOT EXISTS app_records(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);CREATE INDEX IF NOT EXISTS app_records_owner ON app_records(owner_id,updated_at);');
  let auth, origin, fulfillReady;
  const ready = new Promise(resolve => {fulfillReady = resolve;});
  const limits = new Map();
  function limited(key) {
    const now = Date.now(), entry = limits.get(key);
    if (!entry || now - entry.at > 60000) {
      if (limits.size > 10000) for (const [key,value] of limits) if (now - value.at > 60000) limits.delete(key);
      if (limits.size > 10000) return true;
      limits.set(key,{at:now,count:1});return false;
    }
    return ++entry.count > 60;
  }
  const server = createServer(async (req,res) => {
    const reply = (status,value) => {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self';script-src 'self';style-src 'self';connect-src 'self';img-src data:;object-src 'none';base-uri 'none';form-action 'self';frame-ancestors 'none'");
    try {
      await ready;
      if (!auth) {reply(503,{error:'unavailable'});return;}
      if (req.headers.host !== new URL(origin).host) throw error(403,'invalid_origin');
      const url = new URL(req.url,origin), path = url.pathname;
      if ((req.headers.origin !== undefined && req.headers.origin !== origin) || (req.headers['sec-fetch-site'] && !['same-origin','none'].includes(req.headers['sec-fetch-site']))) throw error(403,'invalid_origin');
      if (!['GET','HEAD'].includes(req.method) && req.headers.origin !== origin) throw error(403,'invalid_origin');
      if (path === '/healthz' && req.method === 'GET') {reply(200,{ok:true,template:'compass-crud-v1'});return;}
      if (path === '/api/config' && req.method === 'GET') {reply(200,manifest);return;}
      if (path.startsWith('/api/auth/')) {
        if (!AUTH.has(path)) throw error(404,'not_found');
        if (AUTH.get(path) !== req.method) throw error(405,'method_not_allowed');
        if (req.method === 'POST' && limited('auth:' + req.socket.remoteAddress)) throw error(429,'rate_limited');
        const headers = new Headers();
        for (const key of ['cookie','origin','content-type','sec-fetch-site']) if (typeof req.headers[key] === 'string') headers.set(key,req.headers[key]);
        if (path === '/api/auth/sign-out' && req.headers['x-compass-app-user'] !== undefined) {
          const session = await auth.api.getSession({headers:new Headers({cookie:req.headers.cookie || ''}),query:{disableCookieCache:true,disableRefresh:true}});
          if (!session?.user?.id) throw error(401,'sign_in_required');
          if (session.user.id !== req.headers['x-compass-app-user']) throw error(403,'account_changed');
        }
        const input = req.method === 'POST' ? await jsonBody(req) : null;
        const response = await auth.handler(new Request(origin + path,{method:req.method,headers,...(input ? {body:JSON.stringify(input)} : {})}));
        res.statusCode = response.status;
        res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');
        const cookies = response.headers.getSetCookie();if (cookies.length) res.setHeader('Set-Cookie',cookies);
        res.end(await response.text());return;
      }
      if (path === '/api/records' || path.startsWith('/api/records/')) {
        const session = await auth.api.getSession({headers:new Headers({cookie:req.headers.cookie || ''}),query:{disableCookieCache:true,disableRefresh:true}});
        const owner = session?.user?.id;
        if (!owner || session.session.userId !== owner || new Date(session.session.expiresAt).getTime() <= Date.now()) throw error(401,'sign_in_required');
        if (req.headers['x-compass-app-user'] !== undefined && req.headers['x-compass-app-user'] !== owner) throw error(403,'account_changed');
        if (limited('records:' + owner)) throw error(429,'rate_limited');
        const id = path.slice('/api/records/'.length);
        const decode = row => ({id:row.id,data:JSON.parse(row.data),createdAt:row.created_at,updatedAt:row.updated_at});
        if (path === '/api/records' && req.method === 'GET') {
          const rows = db.prepare('SELECT * FROM app_records WHERE owner_id=? ORDER BY updated_at DESC LIMIT 200').all(owner);
          reply(200,{records:rows.map(decode)});return;
        }
        if (path === '/api/records' && req.method === 'POST') {
          if (db.prepare('SELECT count(*) AS total FROM app_records WHERE owner_id=?').get(owner).total >= 200) throw error(409,'record_limit');
          const input = await jsonBody(req), checked = validateApplicationRecord(manifest,input.data);
          if (!checked.ok) throw error(400,checked.error);
          const id = randomUUID(), stamp = new Date().toISOString();
          db.prepare('INSERT INTO app_records VALUES(?,?,?,?,?)').run(id,owner,JSON.stringify(checked.value),stamp,stamp);
          reply(201,{record:decode(db.prepare('SELECT * FROM app_records WHERE id=? AND owner_id=?').get(id,owner))});return;
        }
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw error(404,'not_found');
        const existing = db.prepare('SELECT * FROM app_records WHERE id=? AND owner_id=?').get(id,owner);
        if (!existing) throw error(404,'not_found');
        if (req.method === 'PUT') {
          const input = await jsonBody(req), checked = validateApplicationRecord(manifest,input.data);
          if (!checked.ok) throw error(400,checked.error);
          db.prepare('UPDATE app_records SET data=?,updated_at=? WHERE id=? AND owner_id=?').run(JSON.stringify(checked.value),new Date().toISOString(),id,owner);
          reply(200,{record:decode(db.prepare('SELECT * FROM app_records WHERE id=? AND owner_id=?').get(id,owner))});return;
        }
        if (req.method === 'DELETE') {db.prepare('DELETE FROM app_records WHERE id=? AND owner_id=?').run(id,owner);reply(200,{ok:true});return;}
        throw error(405,'method_not_allowed');
      }
      if (!['GET','HEAD'].includes(req.method)) throw error(405,'method_not_allowed');
      const asset = STATIC.get(path);
      if (!asset) throw error(404,'not_found');
      const content = await readFile(resolve(folder,'public',asset[0]));
      res.writeHead(200,{'Content-Type':asset[1],'Cache-Control':'no-store','Content-Length':content.length});res.end(req.method === 'HEAD' ? undefined : content);
    } catch(failure) {if (!res.headersSent) reply(failure.status || 503,{error:failure.code || 'unavailable'});else res.destroy();}
  });
  try {
    await new Promise((resolve,reject) => {server.once('error',reject);server.listen(Number(env.PORT ?? 3000),env.HOST || '127.0.0.1',resolve);});
    origin = requestedOrigin?.origin || 'http://127.0.0.1:' + server.address().port;
    if (requestedOrigin?.port === '0' && !production) {requestedOrigin.port = String(server.address().port);origin = requestedOrigin.origin;}
    const options = {appName:manifest.title,baseURL:origin,basePath:'/api/auth',secret:env.BETTER_AUTH_SECRET,database:db,trustedOrigins:[origin],
      emailAndPassword:{enabled:true,minPasswordLength:12,maxPasswordLength:128,autoSignIn:true},
      databaseHooks:{user:{create:{before:async user => {if (!/^[^@\s]+@(?:[a-z0-9-]+\.)*test$/i.test(user.email)) throw new APIError('FORBIDDEN',{message:'Local template accounts require a .test email.',code:'TEST_EMAIL_REQUIRED'});return {data:user};}}}},
      session:{expiresIn:86400,cookieCache:{enabled:false}},advanced:{cookiePrefix:'compass-generated-app',useSecureCookies:origin.startsWith('https:'),defaultCookieAttributes:{httpOnly:true,secure:origin.startsWith('https:'),sameSite:'lax',path:'/'},crossSubDomainCookies:{enabled:false},disableCSRFCheck:false,disableOriginCheck:false,trustedProxyHeaders:false},
      rateLimit:{enabled:true,storage:'database',window:60,max:60},telemetry:{enabled:false},logger:{disabled:true}};
    const migrations = await getMigrations(options);
    if (migrations.schemaProblems?.length || migrations.unsafeChanges?.length) throw Error('Incompatible authentication schema.');
    await migrations.runMigrations();auth = betterAuth(options);await auth.$context;fulfillReady();
    return {server,origin,async close() {await new Promise(resolve => server.close(resolve));server.closeIdleConnections();db.close();}};
  } catch(failure) {fulfillReady();server.close();db.close();throw failure;}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const app = await startApplication();
    console.log(JSON.stringify({ready:true,origin:app.origin,port:app.server.address().port}));
    for (const signal of ['SIGTERM','SIGINT']) process.once(signal,async () => {await app.close();process.exit(0);});
  } catch {console.error('Application could not start. Check manifest, database path, APP_ORIGIN and BETTER_AUTH_SECRET.');process.exit(1);}
}
