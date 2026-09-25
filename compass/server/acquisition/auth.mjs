import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { betterAuth } from 'better-auth';
import { hashPassword } from 'better-auth/crypto';
import { getMigrations } from 'better-auth/db/migration';

const AUTH_PATH = '/api/auth';
const INVITE_PATH = '/api/acquisition/accept-invite';
const ROUTES = new Map([
  [`${AUTH_PATH}/sign-in/email`, 'POST'],
  [`${AUTH_PATH}/sign-out`, 'POST'],
  [`${AUTH_PATH}/get-session`, 'GET'],
  [INVITE_PATH, 'POST'],
]);
const MAX_BODY_BYTES = 16 * 1024;
const PASSWORD_MIN = 12;
const PASSWORD_MAX = 128;
// Same email grammar as Zod 4.5.4's z.email(), used by Better Auth 1.7.6 sign-in.
const EMAIL_PATTERN = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;

export class AcquisitionAuthError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'AcquisitionAuthError';
    this.status = status;
    this.statusCode = status;
    this.code = code;
  }
}

const unavailable = () => new AcquisitionAuthError('Authentication is unavailable.', 503, 'AUTH_UNAVAILABLE');
const invalidInvite = () => new AcquisitionAuthError('Invite is invalid, expired, or already used.', 400, 'INVITE_INVALID');
const badInput = () => new AcquisitionAuthError('Invalid authentication input.', 400, 'INVALID_INPUT');

export function normalizeInviteEmail(email) {
  if (typeof email !== 'string') throw badInput();
  const normalized = email.trim().toLowerCase();
  if (normalized.length > 254 || !EMAIL_PATTERN.test(normalized)) throw badInput();
  return normalized;
}

function configuration(pool, env) {
  const fail = (message) => { throw new AcquisitionAuthError(message, 503, 'AUTH_CONFIGURATION_ERROR'); };
  if (!pool || typeof pool.connect !== 'function' || typeof pool.query !== 'function') fail('A PostgreSQL pool is required.');
  if (typeof env.BETTER_AUTH_SECRET !== 'string' || env.BETTER_AUTH_SECRET.trim().length < 32) fail('BETTER_AUTH_SECRET must contain at least 32 non-padding characters.');
  let url;
  try { url = new URL(env.BETTER_AUTH_URL); } catch { fail('BETTER_AUTH_URL must be an explicit HTTP(S) origin.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') fail('BETTER_AUTH_URL must be an explicit HTTP(S) origin without a path.');
  const production = env.NODE_ENV === 'production';
  if (url.protocol !== 'https:' && (production || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) fail('HTTPS is required except for non-production loopback development.');
  return { origin: url.origin, secure: production || url.protocol === 'https:', secret: env.BETTER_AUTH_SECRET };
}

function optionsFor(pool, config) {
  return {
    appName: 'COMPASS Acquisition',
    database: pool,
    baseURL: config.origin,
    basePath: AUTH_PATH,
    secret: config.secret,
    trustedOrigins: [config.origin],
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      autoSignIn: false,
      minPasswordLength: PASSWORD_MIN,
      maxPasswordLength: PASSWORD_MAX,
    },
    user: { modelName: 'acq_auth_users' },
    account: { modelName: 'acq_auth_accounts', accountLinking: { enabled: false } },
    verification: { modelName: 'acq_auth_verifications' },
    session: {
      modelName: 'acq_auth_sessions',
      expiresIn: 7 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      cookieCache: { enabled: false },
    },
    advanced: {
      cookiePrefix: 'compass-acquisition',
      useSecureCookies: config.secure,
      defaultCookieAttributes: { httpOnly: true, secure: config.secure, sameSite: 'strict', path: '/' },
      crossSubDomainCookies: { enabled: false },
      trustedProxyHeaders: false,
      disableCSRFCheck: false,
      disableOriginCheck: false,
    },
    rateLimit: {
      enabled: true, window: 60, max: 60,
      customRules: { '/sign-in/email': { window: 60, max: 10 } },
    },
    telemetry: { enabled: false },
    logger: { disabled: true },
  };
}

async function transaction(pool, action) {
  const client = await pool.connect();
  let discard;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) { discard = rollbackError; }
    throw error;
  } finally {
    client.release(discard);
  }
}

async function initialize(pool, options) {
  const schema = await readFile(new URL('./auth-schema.sql', import.meta.url), 'utf8');
  await transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(1128353105, 1096111176)');
    // Pin introspection AND DDL to the lock-owning transaction. Using pool here
    // would deadlock a one-connection pool and leave DDL outside the transaction.
    const connection = { query: (...args) => client.query(...args), release() {} };
    const migrationPool = { connect: async () => connection, end: async () => {} };
    const migration = await getMigrations({ ...options, database: migrationPool });
    if (migration.schemaProblems?.length || migration.unsafeChanges?.length) throw unavailable();
    await migration.runMigrations();
    await client.query(schema);
    await client.query('SELECT id, user_id, created_at FROM acq_tenants LIMIT 0');
    await client.query('SELECT id, token_hash, email, created_at, expires_at, consumed_at, consumed_by FROM acq_invites LIMIT 0');
  });
}

function header(req, name) {
  const value = req.headers?.[name];
  return typeof value === 'string' ? value : undefined;
}

function checkOrigin(req, origin) {
  const supplied = header(req, 'origin');
  const site = header(req, 'sec-fetch-site');
  if ((site && !['same-origin', 'none'].includes(site)) || (supplied !== undefined && supplied !== origin) || (req.method !== 'GET' && supplied !== origin)) {
    throw new AcquisitionAuthError('A same-origin request is required.', 403, 'INVALID_ORIGIN');
  }
}

function limiter() {
  const windows = new Map();
  return (req) => {
    if (req.method === 'GET') return;
    const now = Date.now();
    const key = req.socket?.remoteAddress || 'unknown';
    let entry = windows.get(key);
    if (!entry || entry.until <= now) {
      for (const [ip, value] of windows) if (value.until <= now) windows.delete(ip);
      if (windows.size >= 10_000 && !windows.has(key)) throw new AcquisitionAuthError('Too many authentication attempts.', 429, 'RATE_LIMITED');
      entry = { count: 0, until: now + 60_000 };
      windows.set(key, entry);
    }
    if (++entry.count > 30) throw new AcquisitionAuthError('Too many authentication attempts.', 429, 'RATE_LIMITED');
  };
}

async function readJson(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(header(req, 'content-type') || '')) throw new AcquisitionAuthError('JSON content type is required.', 415, 'UNSUPPORTED_MEDIA_TYPE');
  const declared = header(req, 'content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    req.resume();
    throw new AcquisitionAuthError('Request body is too large.', 413, 'BODY_TOO_LARGE');
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += Buffer.byteLength(chunk);
    if (size > MAX_BODY_BYTES) {
      req.resume();
      throw new AcquisitionAuthError('Request body is too large.', 413, 'BODY_TOO_LARGE');
    }
    chunks.push(Buffer.from(chunk));
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw badInput();
    return value;
  } catch { throw badInput(); }
}

function sendJson(res, status, body, cookies = []) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  if (status === 429) res.setHeader('Retry-After', '60');
  res.end(JSON.stringify(body));
}

/** The caller owns pool lifetime. No credentials or invitations are created at startup. */
export async function createAuth({ pool, env = process.env } = {}) {
  const config = configuration(pool, env);
  const options = optionsFor(pool, config);
  let auth;
  try {
    await initialize(pool, options);
    auth = betterAuth(options);
    const context = await auth.$context;
    await context.checkSchema?.();
  } catch { throw unavailable(); }
  const limit = limiter();

  async function acceptInvite(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw badInput();
    const { token, name, password } = input;
    const email = normalizeInviteEmail(input.email);
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw invalidInvite();
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 120 || /[\x00-\x1f\x7f]/.test(name)) throw badInput();
    if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) throw badInput();
    const digest = createHash('sha256').update(token).digest('hex');
    try {
      return await transaction(pool, async (client) => {
        const invite = await client.query(`SELECT id FROM acq_invites
          WHERE token_hash = $1 AND email = $2 AND consumed_at IS NULL
            AND expires_at > clock_timestamp() FOR UPDATE`, [digest, email]);
        if (!invite.rowCount) throw invalidInvite();
        const passwordHash = await hashPassword(password);
        const userId = randomUUID();
        // Match Better Auth 1.7.6's credential account mapping; use its own hasher.
        // All four writes share a pg transaction, not auth.api.signUpEmail's pool.
        await client.query(`INSERT INTO acq_auth_users
          (id, name, email, "emailVerified", "createdAt", "updatedAt")
          VALUES ($1, $2, $3, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, [userId, name.trim(), email]);
        await client.query(`INSERT INTO acq_auth_accounts
          (id, "userId", "accountId", "providerId", password, "createdAt", "updatedAt")
          VALUES ($1, $2, $2, 'credential', $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, [randomUUID(), userId, passwordHash]);
        await client.query('INSERT INTO acq_tenants (id, user_id) VALUES ($1, $2)', [randomUUID(), userId]);
        const consumed = await client.query(`UPDATE acq_invites SET consumed_at = clock_timestamp(), consumed_by = $2
          WHERE id = $1 AND consumed_at IS NULL AND expires_at > clock_timestamp()`, [invite.rows[0].id, userId]);
        if (consumed.rowCount !== 1) throw invalidInvite();
        return { ok: true };
      });
    } catch (error) {
      if (error instanceof AcquisitionAuthError) throw error;
      if (error.code === '23505') throw invalidInvite();
      throw unavailable();
    }
  }

  async function getIdentity(req) {
    const cookie = header(req, 'cookie');
    if (!cookie) return null;
    try {
      const session = await auth.api.getSession({
        headers: new Headers({ cookie }),
        query: { disableCookieCache: true, disableRefresh: true },
      });
      if (!session?.user?.id || session.session.userId !== session.user.id) return null;
      const membership = await pool.query('SELECT id FROM acq_tenants WHERE user_id = $1', [session.user.id]);
      return membership.rowCount === 1 ? { tenantId: membership.rows[0].id, userId: session.user.id } : null;
    } catch { throw unavailable(); }
  }

  /** Returns false only for a path outside this module; otherwise ends res and returns true. */
  async function handle(req, res) {
    let path;
    try { path = new URL(req.url || '/', config.origin).pathname; } catch { return false; }
    if (path !== INVITE_PATH && path !== AUTH_PATH && !path.startsWith(`${AUTH_PATH}/`)) return false;
    const method = ROUTES.get(path);
    if (!method) {
      sendJson(res, 404, { error: 'Authentication endpoint is not available.', code: 'AUTH_ROUTE_BLOCKED' });
      return true;
    }
    if (req.method !== method) {
      res.setHeader('Allow', method);
      sendJson(res, 405, { error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' });
      return true;
    }
    try {
      checkOrigin(req, config.origin);
      limit(req);
      const body = method === 'POST' ? await readJson(req) : undefined;
      if (path === INVITE_PATH) {
        sendJson(res, 200, await acceptInvite(body));
        return true;
      }
      if (path.endsWith('/sign-in/email')) {
        if (Object.keys(body).some((key) => !['email', 'password', 'rememberMe'].includes(key))) throw badInput();
        body.email = normalizeInviteEmail(body.email);
        if (typeof body.password !== 'string' || body.password.length > PASSWORD_MAX || !body.password.length) throw badInput();
      } else if (body && Object.keys(body).length) throw badInput();
      const headers = new Headers();
      for (const name of ['cookie', 'origin', 'sec-fetch-site', 'user-agent']) {
        const value = header(req, name);
        if (value !== undefined) headers.set(name, value);
      }
      if (body) headers.set('content-type', 'application/json');
      // Never build the auth URL or rate-limit key from untrusted proxy/Host headers.
      headers.set('x-forwarded-for', req.socket?.remoteAddress || 'unknown');
      const response = await auth.handler(new Request(`${config.origin}${path}`, {
        method, headers, ...(body ? { body: JSON.stringify(body) } : {}),
      }));
      if (response.status >= 500) throw unavailable();
      const payload = await response.json();
      const result = response.ok ? payload : {
        error: payload.message || 'Authentication request failed.',
        ...(payload.code ? { code: payload.code } : {}),
      };
      sendJson(res, response.status, result, response.headers.getSetCookie());
    } catch (error) {
      const safe = error instanceof AcquisitionAuthError ? error : unavailable();
      sendJson(res, safe.status, { error: safe.message, code: safe.code });
    }
    return true;
  }

  return Object.freeze({ handle, getIdentity, acceptInvite });
}
