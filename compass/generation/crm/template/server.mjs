import {chmod, mkdir, readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {dirname, resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {betterAuth} from 'better-auth';
import {APIError} from 'better-auth/api';
import {getMigrations} from 'better-auth/db/migration';
import {crmEntities, crmId} from './lib/records.mjs';
import {validateApplicationManifest} from './lib/schema.mjs';
import {createCrmStore} from './lib/store.mjs';

const folder = dirname(fileURLToPath(import.meta.url));
const staticRoutes = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/crm.js', ['crm.js', 'text/javascript; charset=utf-8']],
  ['/crm.css', ['crm.css', 'text/css; charset=utf-8']],
]);
const authRoutes = new Map([
  ['/api/auth/sign-up/email', 'POST'], ['/api/auth/sign-in/email', 'POST'],
  ['/api/auth/get-session', 'GET'], ['/api/auth/sign-out', 'POST'],
]);
const csp = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'";
const failure = (status, code) => Object.assign(new Error(code), {status, code});

async function readBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw failure(415, 'json_required');
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req.iterator({destroyOnReturn: false})) {
    bytes += chunk.length;
    if (bytes > 8192) {req.resume();throw failure(413, 'body_too_large');}
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
    return value;
  } catch {throw failure(400, 'invalid_json');}
}

function verifyOrigin(req, origin) {
  if (req.headers.host !== new URL(origin).host ||
      (req.headers.origin !== undefined && req.headers.origin !== origin) ||
      (req.headers['sec-fetch-site'] && !['same-origin','none'].includes(req.headers['sec-fetch-site'])) ||
      (!['GET','HEAD'].includes(req.method) && req.headers.origin !== origin)) throw failure(403, 'invalid_origin');
}

export async function startApplication({env = process.env} = {}) {
  const manifest = validateApplicationManifest(JSON.parse(await readFile(resolve(folder, 'manifest.json'), 'utf8')));
  if (!manifest?.crm) throw Error('A complete CRM manifest is required.');
  if (typeof env.BETTER_AUTH_SECRET !== 'string' || env.BETTER_AUTH_SECRET.length < 32) {
    throw Error('Set a private BETTER_AUTH_SECRET with at least 32 characters.');
  }
  const production = env.NODE_ENV === 'production';
  const requestedOrigin = env.APP_ORIGIN ? new URL(env.APP_ORIGIN) : null;
  if (requestedOrigin && (requestedOrigin.pathname !== '/' || requestedOrigin.search || requestedOrigin.hash ||
      requestedOrigin.username || requestedOrigin.password || !['http:','https:'].includes(requestedOrigin.protocol))) throw Error('APP_ORIGIN must be an exact web origin.');
  if (production && requestedOrigin?.protocol !== 'https:') throw Error('Use an HTTPS APP_ORIGIN in production.');
  if (requestedOrigin?.protocol === 'http:' && !['127.0.0.1','localhost','[::1]'].includes(requestedOrigin.hostname)) throw Error('Use HTTPS outside localhost.');
  const content = new Map(await Promise.all([...staticRoutes].map(async ([path, [name, type]]) =>
    [path, {type, bytes: await readFile(resolve(folder, 'public', name))}])));
  const dbPath = resolve(env.APP_DATABASE || 'data/crm.sqlite');
  await mkdir(dirname(dbPath), {recursive: true, mode: 0o700});
  const database = new DatabaseSync(dbPath);
  await chmod(dbPath, 0o600);
  database.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  const store = createCrmStore(database, {
    getApplication: () => ({manifest, version: 1}),
    atomic(callback) {
      database.exec('BEGIN IMMEDIATE');
      try {const result = callback();database.exec('COMMIT');return result;}
      catch (error) {database.exec('ROLLBACK');throw error;}
    },
  });
  const scope = 'standalone-crm';
  let auth, origin, releaseReady;
  const ready = new Promise(resolve => {releaseReady = resolve;});
  async function verifiedOwner(req) {
    const headers = new Headers({cookie: req.headers.cookie || ''});
    const session = await auth.api.getSession({headers, query: {disableCookieCache: true, disableRefresh: true}});
    const owner = session?.user?.id;
    if (!owner || session.session.userId !== owner || new Date(session.session.expiresAt).getTime() <= Date.now()) {
      throw failure(401, 'sign_in_required');
    }
    if (req.headers['x-crm-user'] !== owner) throw failure(403, 'account_changed');
    return owner;
  }
  const requestCounts = new Map();
  function rateLimited(owner) {
    const minute = Math.floor(Date.now() / 60000);
    for (const [id, counter] of requestCounts) {
      if (counter.minute < minute) requestCounts.delete(id);
    }
    const counter = requestCounts.get(owner);
    if (counter) return ++counter.count > 120;
    if (requestCounts.size >= 2000) return true;
    requestCounts.set(owner, {minute, count: 1});
    return false;
  }
  const server = createServer(async (req, res) => {
    const json = (status, value) => {
      res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'});
      res.end(JSON.stringify(value));
    };
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','no-referrer');
    try {
      await ready;
      if (!auth) throw failure(503, 'unavailable');
      verifyOrigin(req, origin);
      const path = new URL(req.url, origin).pathname;
      if (req.method === 'GET' && path === '/healthz') return json(200, {ok: true, template: 'compass-consulting-crm-v1'});
      if (req.method === 'GET' && path === '/api/config') {
        const {title, description, theme, crm} = manifest;
        return json(200, {title, description, theme, crm});
      }
      if (path.startsWith('/api/auth/')) {
        if (!authRoutes.has(path)) throw failure(404, 'not_found');
        if (req.method !== authRoutes.get(path)) throw failure(405, 'method_not_allowed');
        if (path === '/api/auth/sign-out') await verifiedOwner(req);
        const headers = new Headers();
        for (const name of ['cookie','origin','content-type','sec-fetch-site']) {
          if (typeof req.headers[name] === 'string') headers.set(name, req.headers[name]);
        }
        const body = req.method === 'POST' ? JSON.stringify(await readBody(req)) : undefined;
        const response = await auth.handler(new Request(origin + path, {method: req.method, headers, body}));
        const cookies = response.headers.getSetCookie();
        if (cookies.length) res.setHeader('Set-Cookie', cookies);
        res.writeHead(response.status, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(await response.text());return;
      }
      const resource = /^\/api\/crm\/([a-z]+)(?:\/([A-Za-z0-9_-]{1,80}))?$/.exec(path);
      if (resource && crmEntities.includes(resource[1])) {
        const owner = await verifiedOwner(req);
        if (rateLimited(owner)) throw failure(429, 'rate_limited');
        const [, entity, id] = resource;
        if (id && !crmId(id)) throw failure(404, 'not_found');
        if (!id && req.method === 'GET') return json(200, {records: store.list(owner, scope, entity, 1)});
        if ((!id && req.method === 'POST') || (id && req.method === 'PUT')) {
          const body = await readBody(req);
          if (Object.keys(body).some(key => !(id ? ['data','version'] : ['data']).includes(key))) throw failure(400, 'invalid_record');
          const record = store.save(owner, scope, entity, 1, body.data, id, body.version);
          return json(id ? 200 : 201, {record});
        }
        if (id && req.method === 'DELETE') {
          const version = req.headers['x-compass-record-version'];
          store.deleteRecord(owner, scope, entity, 1, id, typeof version === 'string' && /^\d{1,10}$/.test(version) ? Number(version) : null);
          return json(200, {ok: true});
        }
        throw failure(405, 'method_not_allowed');
      }
      if (!content.has(path)) throw failure(404, 'not_found');
      if (!['GET','HEAD'].includes(req.method)) throw failure(405, 'method_not_allowed');
      const asset = content.get(path);
      res.writeHead(200, {'Content-Type': asset.type, 'Content-Length': asset.bytes.length});
      res.end(req.method === 'HEAD' ? undefined : asset.bytes);
    } catch (error) {
      if (!res.headersSent) json(error.status || 503, {error: error.code || 'unavailable'});
      else res.destroy();
    }
  });

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(Number(env.PORT ?? 3000), env.HOST || '127.0.0.1', resolve);
    });
    if (requestedOrigin?.port === '0' && !production) requestedOrigin.port = String(server.address().port);
    origin = requestedOrigin?.origin || 'http://127.0.0.1:' + server.address().port;
    const config = {
      appName: manifest.title, baseURL: origin, basePath: '/api/auth', secret: env.BETTER_AUTH_SECRET,
      database, trustedOrigins: [origin],
      emailAndPassword: {enabled: true, minPasswordLength: 12, maxPasswordLength: 128, autoSignIn: true},
      databaseHooks: {user: {create: {before: async user => {
        if (!/^[^@\s]+@(?:[a-z0-9-]+\.)*test$/i.test(user.email)) throw new APIError('FORBIDDEN', {code: 'TEST_EMAIL_REQUIRED', message: 'Use a local .test email.'});
        return {data: user};
      }}}},
      session: {expiresIn: 86400, cookieCache: {enabled: false}},
      advanced: {cookiePrefix: 'compass-local-crm', useSecureCookies: origin.startsWith('https:'),
        defaultCookieAttributes: {httpOnly:true,secure:origin.startsWith('https:'),sameSite:'lax',path:'/'},
        crossSubDomainCookies: {enabled: false}, disableCSRFCheck: false, disableOriginCheck: false, trustedProxyHeaders: false},
      rateLimit: {enabled: true, storage: 'database', window: 60, max: 60},
      telemetry: {enabled: false},
      logger: {disabled: true},
    };
    const migrations = await getMigrations(config);
    if (migrations.schemaProblems?.length || migrations.unsafeChanges?.length) throw Error('Incompatible authentication schema.');
    await migrations.runMigrations();
    auth = betterAuth(config);
    await auth.$context;
    releaseReady();
    return {origin, async close() {
      await new Promise(resolve => server.close(resolve));
      database.close();
    }};
  } catch (error) {
    releaseReady();
    server.close();
    database.close();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const app = await startApplication();
    console.log('CRM ready at ' + app.origin);
    for (const signal of ['SIGTERM','SIGINT']) process.once(signal, async () => {await app.close();process.exit(0);});
  } catch {
    console.error('CRM could not start. Check the built assets, manifest, database path, origin and BETTER_AUTH_SECRET.');
    process.exitCode = 1;
  }
}
