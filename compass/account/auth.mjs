import { isAbsolute,resolve,relative,sep,dirname,basename } from 'node:path';
import {fileURLToPath} from 'node:url';
import { open, chmod,realpath } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import {isIP} from 'node:net';
import {createEmailDelivery} from './email.mjs';
import {accountDatabaseLimit,prepareProductionStorage} from './storage.mjs';


// Resolve existing ancestors as well as the final file. Startup must reject a
// public destination before creating it, including symlinked parent directories.
async function canonicalLocation(value) {
  // Preserve .. until realpath resolves symlinks, matching fs.open semantics.
  let current=isAbsolute(value)?value:resolve(value);const suffix=[];
  while(true){
    try{return resolve(await realpath(current),...suffix.reverse())}
    catch(error){
      if(!['ENOENT','ENOTDIR'].includes(error?.code)||dirname(current)===current)throw error;
      suffix.push(basename(current));current=dirname(current);
    }
  }
}
const inside=(root,file)=>{const part=relative(root,file);return part===''||part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part)};
const staticRoot=env=>resolve(env.STATIC_ROOT||fileURLToPath(new URL('../dist/',import.meta.url)));
async function privateDatabasePath(env,path) {
  try{return !inside(await canonicalLocation(staticRoot(env)),await canonicalLocation(path))}
  catch{return false}
}
// Static delivery checks the actual target, not its basename or extension. A
// legitimate public JSON asset can share the private database's filename.
export async function isAccountDatabaseAsset(file,env={}) {
  if(typeof env.COMPASS_ACCOUNT_DATABASE!=='string'||!isAbsolute(env.COMPASS_ACCOUNT_DATABASE))return false;
  try {
    const target=await canonicalLocation(file);
    if(env.COMPASS_STORAGE_MODE==='persistent-volume'&&typeof env.RAILWAY_VOLUME_MOUNT_PATH==='string'&&isAbsolute(env.RAILWAY_VOLUME_MOUNT_PATH)){
      const mount=await canonicalLocation(env.RAILWAY_VOLUME_MOUNT_PATH);
      if(mount!==sep&&inside(mount,target))return true;
    }
    const database=await canonicalLocation(env.COMPASS_ACCOUNT_DATABASE).catch(()=>resolve(env.COMPASS_ACCOUNT_DATABASE));
    for(const suffix of ['', '-wal','-shm','-journal']) {
      if(target===database+suffix)return true;
      const configured=await canonicalLocation(env.COMPASS_ACCOUNT_DATABASE+suffix).catch(()=>resolve(env.COMPASS_ACCOUNT_DATABASE+suffix));
      if(target===configured)return true;
    }
    return false;
  }catch{return true}
}

const AUTH_PATH = '/api/auth';
const MAX_BODY = 16 * 1024;
const MAX_STAGING_USERS = 50;
const PRODUCTION_ORIGIN = 'https://mycompass.world';
const METHODS = new Map([
  ['/sign-up/email', ['POST']], ['/sign-in/email', ['POST']],
  ['/sign-out', ['POST']], ['/get-session', ['GET']], ['/ok', ['GET']],
  ['/update-user', ['POST']], ['/change-password', ['POST']],
  ['/list-sessions', ['GET']], ['/revoke-session', ['POST']], ['/revoke-other-sessions', ['POST']],
  ['/list-accounts', ['GET']],
]);
const MAIL_METHODS = new Map([
  ['/send-verification-email', ['POST']], ['/verify-email', ['GET']],
  ['/request-password-reset', ['POST']], ['/reset-password', ['POST']],
  ['/change-email', ['POST']],
]);
const fail = (status, code) => ({ ok: false, status, code });

export function accountClientAddress(req,env=process.env) {
  // Enable only for Railway public HTTP ingress, which replaces X-Real-IP.
  // Private/TCP deployments must leave the opt-in off. Never trust raw XFF.
  const forwarded=req.headers?.['x-real-ip'];
  if(env.NODE_ENV==='production' && env.COMPASS_ACCOUNT_TRUST_RAILWAY_PROXY==='1'
    && env.RAILWAY_PROJECT_ID && env.RAILWAY_SERVICE_ID && typeof forwarded==='string' && isIP(forwarded))return forwarded;
  return req.socket?.remoteAddress || 'unknown';
}

function originFrom(value, production) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    if (url.protocol === 'https:') return url.origin;
    if (!production && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return url.origin;
  } catch {}
  return null;
}

function currentAppleSecret(value,clientId) {
  try {
    if(value.length>16_384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value))return false;
    const [header,body]=value.split('.').slice(0,2).map(part=>JSON.parse(Buffer.from(part,'base64url').toString('utf8')));
    const now=Math.floor(Date.now()/1000);
    // Apple verifies the ES256 signature and key ownership at token exchange.
    // Do not advertise a malformed or already expired client assertion locally.
    return header.alg==='ES256' && typeof header.kid==='string' && Boolean(header.kid.trim())
      && body.sub===clientId && body.aud==='https://appleid.apple.com'
      && typeof body.iss==='string' && Boolean(body.iss.trim())
      && Number.isSafeInteger(body.iat) && body.iat<=now+60
      && Number.isSafeInteger(body.exp) && body.exp>now+60 && body.exp>body.iat && body.exp-body.iat<=15_777_000;
  } catch {return false}
}

function configuredProviders(env, verification) {
  const providers = {};
  for (const id of ['google', 'github', 'apple']) {
    const prefix = id.toUpperCase();
    const clientId = env[`${prefix}_CLIENT_ID`], clientSecret = env[`${prefix}_CLIENT_SECRET`];
    if (typeof clientId === 'string' && clientId.trim() && typeof clientSecret === 'string' && clientSecret.trim()
      && (id!=='apple' || currentAppleSecret(clientSecret,clientId))) {
      providers[id] = { clientId, clientSecret, ...(verification ? { requireEmailVerification: true } : {}) };
    }
  }
  return providers;
}

function reply(res, status, body, cookies = []) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  if (status === 429) res.setHeader('Retry-After', '60');
  res.end(JSON.stringify(body));
}

async function readBody(req, form) {
  const contentType = typeof req.headers['content-type'] === 'string' ? req.headers['content-type'] : '';
  if (!new RegExp(form ? '^application/x-www-form-urlencoded(?:\\s*;|$)' : '^application/json(?:\\s*;|$)', 'i').test(contentType)) {
    return fail(415, 'UNSUPPORTED_MEDIA_TYPE');
  }
  const declared = req.headers['content-length'];
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY)) { req.resume(); return fail(413, 'BODY_TOO_LARGE'); }
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += Buffer.byteLength(chunk);
    if (size > MAX_BODY) { req.resume(); return fail(413, 'BODY_TOO_LARGE'); }
    chunks.push(Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString('utf8');
  if (form) return { ok: true, body };
  try {
    const value = JSON.parse(body);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(400, 'INVALID_INPUT');
    return { ok: true, body, value };
  } catch { return fail(400, 'INVALID_INPUT'); }
}

/** Explicitly configured identity; production additionally requires a verified private volume. */
export function createAccountAuth({ env = process.env, sendEmail, database: suppliedDatabase, storageOptions } = {}) {
  const production = env.COMPASS_ACCOUNT_MODE === 'production';
  const staging = env.COMPASS_ACCOUNT_MODE === 'staging';
  const enabled = staging || production;
  const origin = originFrom(env.COMPASS_ACCOUNT_ORIGIN, env.NODE_ENV === 'production');
  const suppliedSecret = env.BETTER_AUTH_SECRET;
  const path = env.COMPASS_ACCOUNT_DATABASE;
  const mail = createEmailDelivery(env, {sendEmail});
  const socialProviders = configuredProviders(env, Boolean(mail));
  const emailEnabled = staging || Boolean(mail);
  const primaryDomain = origin && ['mycompass.world', 'www.mycompass.world'].includes(new URL(origin).hostname.replace(/\.+$/, ''));
  const stagingLocation = staging && origin && !primaryDomain && typeof path === 'string' && isAbsolute(path) && path !== '/';
  // Explicit disposable-email QA only. A rotating key must never encrypt real
  // OAuth tokens or issue real verification/reset links that a restart breaks.
  // Generate inside this instance; never persist, log or return the bytes.
  const ephemeralSecret = Boolean(stagingLocation && env.COMPASS_ACCOUNT_EPHEMERAL_SECRET === '1'
    && suppliedSecret === undefined && !mail && !Object.keys(socialProviders).length);
  const secret = ephemeralSecret ? randomBytes(48).toString('base64url') : suppliedSecret;
  const valid = enabled && origin && (production ? origin === PRODUCTION_ORIGIN : !primaryDomain)
    && (!production || Boolean(mail) || Object.keys(socialProviders).length > 0)
    && typeof secret === 'string' && secret.trim().length >= 32
    && typeof path === 'string' && isAbsolute(path) && path !== '/';
  let db = null, auth = null, readyState = false, closed = false;
  const attempts = new Map(),pendingTasks = new Set();
  let unlinkQueue=Promise.resolve();

  const ready = (async () => {
    if (!valid || !await privateDatabasePath(env,path)) return;
    try {
      // Do not create/migrate identity data until the host proves that this is
      // the dedicated persistent mount, outside public assets, with a fixed key.
      if(production && (await prepareProductionStorage(env,storageOptions)).mode!=='durable')return;
      const [{ betterAuth }, { getMigrations }, { DatabaseSync }, { APIError }] = await Promise.all([
        import('better-auth'), import('better-auth/db/migration'), import('node:sqlite'), import('better-auth/api'),
      ]);
      if (suppliedDatabase) {
        db = suppliedDatabase;
        if(production){
          const actual=db.prepare('PRAGMA database_list').all().find(item=>item.name==='main')?.file;
          if(!actual || await realpath(actual)!==await realpath(path))throw new Error('Database location mismatch.');
        }
      }
      else {
        if(!production){
          const file = await open(path, 'a', 0o600);
          await file.close();
          await chmod(path, 0o600);
        }
        db = new DatabaseSync(path);
      }
      db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
      const pageSize = Number(db.prepare('PRAGMA page_size').get().page_size);
      if (!Number.isSafeInteger(pageSize) || pageSize < 512) throw new Error('Unsupported account database.');
      const maxPages = Math.floor(accountDatabaseLimit(env) / pageSize);
      const appliedMax = Number(db.prepare(`PRAGMA max_page_count = ${maxPages}`).get().max_page_count);
      // SQLite cannot shrink a limit below an already larger database. Refuse
      // that configuration instead of reporting a resource cap we did not set.
      if (appliedMax > maxPages) throw new Error('Account database exceeds its resource limit.');
      const options = {
        appName: 'COMPASS', baseURL: origin, basePath: AUTH_PATH, secret,
        database: db, trustedOrigins: [origin, ...(socialProviders.apple ? ['https://appleid.apple.com'] : [])], socialProviders,
        emailAndPassword: {
          enabled: emailEnabled, minPasswordLength: 12, maxPasswordLength: 128,
          requireEmailVerification: Boolean(mail), autoSignIn: !mail,
          ...(mail ? { revokeSessionsOnPasswordReset: true, sendResetPassword: async ({ user, url }) => {
            await mail({ kind: 'reset-password', to: user.email, subject: 'Reset your COMPASS password', text: `Reset your password: ${url}` });
          } } : {}),
        },
        ...(mail ? { emailVerification: {
          sendOnSignUp: true, sendOnSignIn: true, autoSignInAfterVerification: true,
          sendVerificationEmail: async ({ user, url }) => {
            await mail({ kind: 'verify-email', to: user.email, subject: 'Verify your COMPASS email', text: `Verify your email: ${url}` });
          },
        } } : {}),
        databaseHooks: { user: { create: { before: async (user, context) => {
          // Without delivery, only reserved test addresses may use email registration.
          // Verified social identities are managed by the configured OAuth provider.
          if (staging && !mail && context?.path === '/sign-up/email' && !/^[^@\s]+@(?:[a-z0-9-]+\.)*test$/i.test(user.email)) {
            throw new APIError('FORBIDDEN', { message: 'Staging email registration requires a .test address.', code: 'TEST_EMAIL_REQUIRED' });
          }
          if (staging && db.prepare('SELECT count(*) AS count FROM compass_account_user').get().count >= MAX_STAGING_USERS) {
            throw new APIError('TOO_MANY_REQUESTS', { message: 'This isolated preview has reached its test-account limit.', code: 'STAGING_ACCOUNT_LIMIT' });
          }
          return { data: user };
        } } } },
        user: { modelName: 'compass_account_user', changeEmail: { enabled: Boolean(mail), ...(mail ? {
          sendChangeEmailConfirmation: async ({user,url}) => {
            await mail({kind:'confirm-email-change',to:user.email,subject:'Confirm your COMPASS email change',text:`Confirm your email change: ${url}`});
          },
        } : {}) } },
        // Keep Better Auth's verified-email requirement for implicit linking.
        // trustedProviders would bypass that check for unverified identities.
        account: { modelName: 'compass_account_identity', encryptOAuthTokens: true, accountLinking: { enabled: true } },
        verification: { modelName: 'compass_account_verification' },
        session: { modelName: 'compass_account_session', expiresIn: 7 * 86400, updateAge: 86400, cookieCache: { enabled: false } },
        advanced: {
          cookiePrefix: production ? 'compass-account' : 'compass-account-staging', useSecureCookies: origin.startsWith('https:'),
          defaultCookieAttributes: { httpOnly: true, secure: origin.startsWith('https:'), sameSite: 'lax', path: '/' },
          // Apple's form_post callback is a cross-site POST. Only the short-lived
          // signed state cookies need SameSite=None; session cookies stay Lax.
          ...(socialProviders.apple ? {cookies:{state:{attributes:{sameSite:'none',secure:true}},oauth_state:{attributes:{sameSite:'none',secure:true}}}} : {}),
          // Awaiting a provider only for an existing email address leaks delivery
          // timing. Production sends in the background, drained before shutdown.
          ...(production && mail ? {backgroundTasks:{handler(promise){
            const task=Promise.resolve(promise).catch(()=>{});pendingTasks.add(task);
            task.finally(()=>pendingTasks.delete(task));
          }}} : {}),
          crossSubDomainCookies: { enabled: false }, trustedProxyHeaders: false,
          disableCSRFCheck: false, disableOriginCheck: false,
        },
        rateLimit: { enabled: true, storage: 'database', window: 60, max: 60,
          customRules: { '/sign-in/email': { window: 60, max: 10 }, '/sign-up/email': { window: 60, max: 10 } } },
        telemetry: { enabled: false }, logger: { disabled: true },
      };
      const migration = await getMigrations(options);
      if (migration.schemaProblems?.length || migration.unsafeChanges?.length) throw new Error('Incompatible account schema.');
      await migration.runMigrations();
      // A database trigger also covers simultaneous signups and every provider;
      // the friendlier hook above alone would allow a count/insert race.
      if(staging)db.exec(`CREATE TRIGGER IF NOT EXISTS compass_account_staging_user_limit
        BEFORE INSERT ON compass_account_user
        WHEN (SELECT count(*) FROM compass_account_user) >= ${MAX_STAGING_USERS}
        BEGIN SELECT RAISE(ABORT, 'staging_account_limit'); END;`);
      else db.exec('DROP TRIGGER IF EXISTS compass_account_staging_user_limit');
      auth = betterAuth(options);
      const context = await auth.$context;
      await context.checkSchema?.();
      readyState = true;
    } catch {
      auth = null;
      if (db && !suppliedDatabase) { try { db.close(); } catch {} }
      db = null;
    }
  })();

  function publicConfig() {
    return { enabled, configured: readyState && !closed, provider: 'better-auth',
      providers: readyState && !closed ? [...(emailEnabled ? ['email'] : []), ...Object.keys(socialProviders)] : [],
      emailMode: mail ? 'verification' : production ? 'disabled' : 'test', origin: origin || null,
      secretMode: readyState && !closed ? ephemeralSecret ? 'ephemeral' : 'configured' : null,
      features: {accountManagement:readyState && !closed,passwordRecovery:readyState && !closed && Boolean(mail),
        emailVerification:readyState && !closed && Boolean(mail),accountLinking:readyState && !closed && Boolean(Object.keys(socialProviders).length)} };
  }

  async function getIdentity(input) {
    await ready;
    if (!auth || !readyState || closed) return null;
    const headers = input instanceof Headers ? input : new Headers(input);
    const cookie = headers.get('cookie');
    if (!cookie) return null;
    const suppliedOrigin = headers.get('origin'), site = headers.get('sec-fetch-site');
    if ((suppliedOrigin && suppliedOrigin !== origin) || (site && !['same-origin', 'none'].includes(site))) return null;
    try {
      const result = await auth.api.getSession({ headers: new Headers({ cookie }), query: { disableCookieCache: true, disableRefresh: true } });
      const expiresAt = new Date(result?.session?.expiresAt).getTime();
      if (typeof result?.user?.id !== 'string' || !result.user.id || result.session?.userId !== result.user.id
          || typeof result.session?.id !== 'string' || !result.session.id || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
      return { userId: result.user.id, sessionId: result.session.id };
    } catch { throw Object.assign(new Error('Authentication unavailable.'), { status: 503, code: 'AUTH_UNAVAILABLE' }); }
  }

  function limit(req) {
    const now = Date.now(), key = accountClientAddress(req,env);
    let entry = attempts.get(key);
    if (!entry || entry.until <= now) {
      for (const [ip, item] of attempts) if (item.until <= now) attempts.delete(ip);
      if (attempts.size >= 10_000) return false;
      attempts.set(key, entry = { count: 0, until: now + 60_000 });
    }
    return ++entry.count <= 30;
  }

  async function handleNode(req, res) {
    let url;
    try { url = new URL(req.url || '/', origin || 'http://localhost'); } catch { return false; }
    if (url.pathname !== AUTH_PATH && !url.pathname.startsWith(`${AUTH_PATH}/`)) return false;
    await ready;
    if (!auth || !readyState || closed) { reply(res, 503, { error: 'Account sign-in is not configured.', code: 'AUTH_UNAVAILABLE' }); return true; }
    const relative = url.pathname.slice(AUTH_PATH.length);
    const callback = relative.match(/^\/callback\/(google|github|apple)$/);
    const validCallback = callback && Object.hasOwn(socialProviders, callback[1]);
    const emailEntry = mail && req.method === 'GET'
      && (relative === '/verify-email' || /^\/reset-password\/[^/]{1,200}$/.test(relative));
    let methods = METHODS.get(relative) || (mail ? MAIL_METHODS.get(relative) : undefined);
    if(!emailEnabled && ['/sign-up/email','/sign-in/email','/change-password'].includes(relative))methods=undefined;
    if (relative === '/sign-in/social' && Object.keys(socialProviders).length) methods = ['POST'];
    if (['/link-social','/unlink-account'].includes(relative) && Object.keys(socialProviders).length) methods = ['POST'];
    if (validCallback) methods = callback[1] === 'apple' ? ['GET', 'POST'] : ['GET'];
    if (mail && /^\/reset-password\/[^/]{1,200}$/.test(relative)) methods = ['GET'];
    if (!methods) { reply(res, 404, { error: 'Authentication endpoint not available.', code: 'AUTH_ROUTE_BLOCKED' }); return true; }
    if (!methods.includes(req.method)) { res.setHeader('Allow', methods.join(', ')); reply(res, 405, { error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' }); return true; }
    const suppliedOrigin = req.headers.origin, site = req.headers['sec-fetch-site'];
    // OAuth state/PKCE and email-entry tokens are verified by Better Auth.
    // Their external top-level navigations necessarily arrive cross-site.
    // POSTs and ordinary session/data reads retain strict origin checks.
    if (!validCallback && !emailEntry && ((suppliedOrigin !== undefined && suppliedOrigin !== origin)
        || (site && !['same-origin', 'none'].includes(site)) || (req.method !== 'GET' && suppliedOrigin !== origin))) {
      reply(res, 403, { error: 'A same-origin request is required.', code: 'INVALID_ORIGIN' }); return true;
    }
    if (req.headers.host !== new URL(origin).host || url.origin !== origin) {
      reply(res, 403, { error: 'A same-origin request is required.', code: 'INVALID_ORIGIN' }); return true;
    }
    if (req.method === 'POST' && !limit(req)) { reply(res, 429, { error: 'Too many attempts.', code: 'RATE_LIMITED' }); return true; }
    let releaseUnlink;
    try {
      if (req.headers['x-compass-user'] !== undefined) {
        const headers = new Headers();
        for (const name of ['cookie','origin','sec-fetch-site']) if (typeof req.headers[name] === 'string') headers.set(name,req.headers[name]);
        const identity = await getIdentity(headers);
        if (!identity) { reply(res,401,{error:'Sign in again.',code:'SIGN_IN_REQUIRED'}); return true; }
        if (identity.userId !== req.headers['x-compass-user']) { reply(res,403,{error:'The account changed.',code:'account_changed'}); return true; }
      }
      const input = req.method === 'POST' ? await readBody(req, validCallback && callback[1] === 'apple') : null;
      if (input && !input.ok) { reply(res, input.status, { error: 'Invalid authentication request.', code: input.code }); return true; }
      if (['/sign-in/social','/link-social'].includes(relative) && !Object.hasOwn(socialProviders, input?.value?.provider)) {
        reply(res, 400, { error: 'Sign-in provider is not configured.', code: 'PROVIDER_UNAVAILABLE' }); return true;
      }
      if(relative==='/unlink-account'){
        // Serialize this single-instance operation so two concurrent disconnects
        // cannot each count the other method and leave the owner locked out.
        const previous=unlinkQueue;
        unlinkQueue=new Promise(resolve=>{releaseUnlink=resolve});
        await previous;
        const identity=await getIdentity(new Headers({cookie:typeof req.headers.cookie==='string'?req.headers.cookie:''}));
        if(!identity){reply(res,401,{error:'Sign in again.',code:'SIGN_IN_REQUIRED'});return true}
        const methods=db.prepare('SELECT id,providerId,password FROM compass_account_identity WHERE userId=?').all(identity.userId);
        const target=methods.find(method=>method.id===input?.value?.accountId);
        if(!target||!Object.hasOwn(socialProviders,target.providerId)){reply(res,400,{error:'Sign-in method is not available.',code:'PROVIDER_UNAVAILABLE'});return true}
        const verified=Boolean(db.prepare('SELECT emailVerified FROM compass_account_user WHERE id=?').get(identity.userId)?.emailVerified);
        const usable=method=>Object.hasOwn(socialProviders,method.providerId)
          || method.providerId==='credential'&&emailEnabled&&typeof method.password==='string'&&Boolean(method.password)&&(!mail||verified);
        if(!methods.some(method=>method.id!==target.id&&usable(method))){reply(res,400,{error:'Keep one working sign-in method.',code:'FAILED_TO_UNLINK_LAST_ACCOUNT'});return true}
      }
      if (relative === '/update-user') {
        const name = input?.value?.name;
        if (Object.keys(input?.value || {}).some(key=>key!=='name') || typeof name!=='string' || !name.trim() || name.trim().length>80 || /[\x00-\x1f\x7f]/.test(name)) {
          reply(res,400,{error:'Enter a name of up to 80 characters.',code:'INVALID_NAME'}); return true;
        }
        input.body = JSON.stringify({name:name.trim()});
      }
      if (relative === '/change-password') input.body = JSON.stringify({...input.value,revokeOtherSessions:true});
      const headers = new Headers();
      for (const name of ['cookie', 'origin', 'sec-fetch-site', 'user-agent', 'content-type']) {
        if (typeof req.headers[name] === 'string') headers.set(name, req.headers[name]);
      }
      headers.set('x-forwarded-for', accountClientAddress(req,env));
      const response = await auth.handler(new Request(origin + url.pathname + url.search, {
        method: req.method, headers, ...(input ? { body: input.body } : {}),
      }));
      res.statusCode = response.status;
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (response.headers.has('location')) res.setHeader('Location', response.headers.get('location'));
      res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
      const cookies = response.headers.getSetCookie();
      if (cookies.length) res.setHeader('Set-Cookie', cookies);
      if (response.status >= 500) { reply(res, 503, { error: 'Authentication unavailable.', code: 'AUTH_UNAVAILABLE' }); return true; }
      res.end(await response.text());
    } catch { reply(res, 503, { error: 'Authentication unavailable.', code: 'AUTH_UNAVAILABLE' }); }
    finally {releaseUnlink?.()}
    return true;
  }

  return { enabled, mode:production?'production':staging?'staging':'disabled', ready, publicConfig, handleNode, getIdentity,
    get database() { return db; },
    async close() { await ready; closed = true; readyState = false; auth = null; await Promise.allSettled([...pendingTasks]);
      if (db && !suppliedDatabase) { try { db.close(); } catch {} } db = null; },
  };
}
