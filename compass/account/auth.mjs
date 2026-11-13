import { isAbsolute } from 'node:path';
import { open, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

const AUTH_PATH = '/api/auth';
const MAX_BODY = 16 * 1024;
// Technical limits for disposable QA infrastructure, not a commercial plan.
const MAX_DATABASE_BYTES = 64 * 1024 * 1024;
const MAX_STAGING_USERS = 50;
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

function originFrom(value, production) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    if (url.protocol === 'https:') return url.origin;
    if (!production && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return url.origin;
  } catch {}
  return null;
}

function emailDelivery(env, supplied) {
  if (typeof supplied === 'function') return supplied;
  let target;
  try {
    const url = new URL(env.COMPASS_ACCOUNT_EMAIL_WEBHOOK_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null;
    target = url.href;
  } catch { return null; }
  return async (message) => {
    const headers = { 'content-type': 'application/json' };
    if (env.COMPASS_ACCOUNT_EMAIL_WEBHOOK_TOKEN) headers.authorization = `Bearer ${env.COMPASS_ACCOUNT_EMAIL_WEBHOOK_TOKEN}`;
    const response = await fetch(target, { method: 'POST', headers, body: JSON.stringify(message), signal: AbortSignal.timeout(8_000), redirect: 'error' });
    if (!response.ok) throw new Error('Email delivery unavailable.');
  };
}

function configuredProviders(env, verification) {
  const providers = {};
  for (const id of ['google', 'github', 'apple']) {
    const prefix = id.toUpperCase();
    const clientId = env[`${prefix}_CLIENT_ID`], clientSecret = env[`${prefix}_CLIENT_SECRET`];
    if (typeof clientId === 'string' && clientId.trim() && typeof clientSecret === 'string' && clientSecret.trim()) {
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

/** Isolated staging identity. The factory never opens a database unless explicitly configured. */
export function createAccountAuth({ env = process.env, sendEmail, database: suppliedDatabase } = {}) {
  const enabled = env.COMPASS_ACCOUNT_MODE === 'staging';
  const origin = originFrom(env.COMPASS_ACCOUNT_ORIGIN, env.NODE_ENV === 'production');
  const suppliedSecret = env.BETTER_AUTH_SECRET;
  const path = env.COMPASS_ACCOUNT_DATABASE;
  const mail = emailDelivery(env, sendEmail);
  const socialProviders = configuredProviders(env, Boolean(mail));
  const primaryDomain = origin && ['mycompass.world', 'www.mycompass.world'].includes(new URL(origin).hostname.replace(/\.+$/, ''));
  const stagingLocation = enabled && origin && !primaryDomain && typeof path === 'string' && isAbsolute(path) && path !== '/';
  // Explicit disposable-email QA only. A rotating key must never encrypt real
  // OAuth tokens or issue real verification/reset links that a restart breaks.
  // Generate inside this instance; never persist, log or return the bytes.
  const ephemeralSecret = Boolean(stagingLocation && env.COMPASS_ACCOUNT_EPHEMERAL_SECRET === '1'
    && suppliedSecret === undefined && !mail && !Object.keys(socialProviders).length);
  const secret = ephemeralSecret ? randomBytes(48).toString('base64url') : suppliedSecret;
  const valid = enabled && origin && !primaryDomain && typeof secret === 'string' && secret.trim().length >= 32
    && typeof path === 'string' && isAbsolute(path) && path !== '/';
  let db = null, auth = null, readyState = false, closed = false;
  const attempts = new Map();

  const ready = (async () => {
    if (!valid) return;
    try {
      const [{ betterAuth }, { getMigrations }, { DatabaseSync }, { APIError }] = await Promise.all([
        import('better-auth'), import('better-auth/db/migration'), import('node:sqlite'), import('better-auth/api'),
      ]);
      if (suppliedDatabase) db = suppliedDatabase;
      else {
        const file = await open(path, 'a', 0o600);
        await file.close();
        await chmod(path, 0o600);
        db = new DatabaseSync(path);
      }
      db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
      const pageSize = Number(db.prepare('PRAGMA page_size').get().page_size);
      if (!Number.isSafeInteger(pageSize) || pageSize < 512) throw new Error('Unsupported staging database.');
      const maxPages = Math.floor(MAX_DATABASE_BYTES / pageSize);
      const appliedMax = Number(db.prepare(`PRAGMA max_page_count = ${maxPages}`).get().max_page_count);
      // SQLite cannot shrink a limit below an already larger database. Refuse
      // that configuration instead of reporting a resource cap we did not set.
      if (appliedMax > maxPages) throw new Error('Staging database exceeds its resource limit.');
      const options = {
        appName: 'COMPASS', baseURL: origin, basePath: AUTH_PATH, secret,
        database: db, trustedOrigins: [origin], socialProviders,
        emailAndPassword: {
          enabled: true, minPasswordLength: 12, maxPasswordLength: 128,
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
          if (!mail && context?.path === '/sign-up/email' && !/^[^@\s]+@(?:[a-z0-9-]+\.)*test$/i.test(user.email)) {
            throw new APIError('FORBIDDEN', { message: 'Staging email registration requires a .test address.', code: 'TEST_EMAIL_REQUIRED' });
          }
          if (db.prepare('SELECT count(*) AS count FROM compass_account_user').get().count >= MAX_STAGING_USERS) {
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
          cookiePrefix: 'compass-account-staging', useSecureCookies: origin.startsWith('https:'),
          defaultCookieAttributes: { httpOnly: true, secure: origin.startsWith('https:'), sameSite: 'lax', path: '/' },
          crossSubDomainCookies: { enabled: false }, trustedProxyHeaders: false,
          disableCSRFCheck: false, disableOriginCheck: false,
        },
        rateLimit: { enabled: true, storage: 'database', window: 60, max: 60,
          customRules: { '/sign-in/email': { window: 60, max: 10 }, '/sign-up/email': { window: 60, max: 10 } } },
        telemetry: { enabled: false }, logger: { disabled: true },
      };
      const migration = await getMigrations(options);
      if (migration.schemaProblems?.length || migration.unsafeChanges?.length) throw new Error('Incompatible staging schema.');
      await migration.runMigrations();
      // A database trigger also covers simultaneous signups and every provider;
      // the friendlier hook above alone would allow a count/insert race.
      db.exec(`CREATE TRIGGER IF NOT EXISTS compass_account_staging_user_limit
        BEFORE INSERT ON compass_account_user
        WHEN (SELECT count(*) FROM compass_account_user) >= ${MAX_STAGING_USERS}
        BEGIN SELECT RAISE(ABORT, 'staging_account_limit'); END;`);
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
      providers: readyState && !closed ? ['email', ...Object.keys(socialProviders)] : [],
      emailMode: mail ? 'verification' : 'test', origin: origin || null,
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
    const now = Date.now(), key = req.socket?.remoteAddress || 'unknown';
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
      headers.set('x-forwarded-for', req.socket?.remoteAddress || 'unknown');
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
    return true;
  }

  return { enabled, ready, publicConfig, handleNode, getIdentity,
    get database() { return db; },
    async close() { await ready; closed = true; readyState = false; auth = null; if (db && !suppliedDatabase) { try { db.close(); } catch {} } db = null; },
  };
}
