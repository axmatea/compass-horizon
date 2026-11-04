import { Pool } from 'pg';
import { createAuth } from './acquisition/auth.mjs';

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

// Keep the existing auth tables, invite endpoint and cookie names. Retiring a
// product surface must not reset accounts or run the old acquisition workers.
export async function createIdentityService({ env = process.env, pool: suppliedPool, initialize = createAuth } = {}) {
  let pool = suppliedPool, auth, database = 'blocked';
  if (!pool && /^postgres(?:ql)?:\/\//.test(env.DATABASE_URL || '')) {
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 8, connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30_000, ...(env.PGSSL === 'require' ? { ssl: { rejectUnauthorized: true } } : {}) });
    pool.on('error', () => { database = 'unavailable'; });
  }
  if (pool) {
    try { auth = await initialize({ pool, env }); database = 'ready'; }
    catch { console.error('[auth] initialization blocked; check database and secure auth configuration.'); }
  }
  return {
    status: () => ({ database }),
    getIdentity: (req) => auth ? auth.getIdentity(req) : Promise.resolve(null),
    async handle(req, res) {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (path !== '/api/auth' && !path.startsWith('/api/auth/') && path !== '/api/acquisition/accept-invite') return false;
      if (path === '/api/auth/status') {
        if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); json(res, 405, { error: 'Method not allowed.' }); }
        else json(res, 200, { database });
        return true;
      }
      if (!auth) {
        json(res, 503, { error: 'Sign-in is unavailable. PostgreSQL and secure authentication must be configured.', code: 'AUTH_UNAVAILABLE' });
        return true;
      }
      return auth.handle(req, res);
    },
    async close() { if (pool && !suppliedPool) await pool.end(); },
  };
}
