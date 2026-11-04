import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { Pool } from 'pg';
import { createCompassServer } from '../server.mjs';
import { createInvite } from '../scripts/acquisition-invite.mjs';

const testDsn = process.env.ACQUISITION_TEST_DATABASE_URL;
test('core server signs in an invited user and persists work across restart without legacy services', {
  skip: testDsn ? false : 'Requires an explicit expendable PostgreSQL test DSN.', timeout: 30_000,
}, async (t) => {
  const schema = `core_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: testDsn });
  let app, pool;
  t.after(async () => {
    await app?.close(); await pool?.end();
    try { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await admin.end(); }
  });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(testDsn); url.searchParams.set('options', `-c search_path=${schema}`);
  const env = { DATABASE_URL: url.href, BETTER_AUTH_SECRET: 'synthetic-core-test-secret-at-least-32-characters',
    BETTER_AUTH_URL: 'http://127.0.0.1:18779', NODE_ENV: 'test' };
  pool = new Pool({ connectionString: url.href });
  async function start() {
    app = await createCompassServer({ env });
    app.server.listen(18779, '127.0.0.1'); await once(app.server, 'listening');
  }
  await start();
  const origin = env.BETTER_AUTH_URL;
  const invite = await createInvite({ pool, email: 'core-fixture@example.test' });
  let cookie;
  const send = (path, body) => fetch(origin + path, { method: 'POST', headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  assert.equal((await send('/api/acquisition/accept-invite', { token: invite.token, name: 'Core Fixture', email: 'core-fixture@example.test', password: 'synthetic-test-password-456' })).status, 200);
  const login = await send('/api/auth/sign-in/email', { email: 'core-fixture@example.test', password: 'synthetic-test-password-456' });
  assert.equal(login.status, 200); cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  assert.ok(cookie);
  const created = await send('/api/workspaces', { commandId: randomUUID(), name: 'Core restart fixture' });
  assert.equal(created.status, 201); const { workspace } = await created.json();
  const command = { commandId: randomUUID(), title: 'Preserve real work' };
  assert.equal((await send(`/api/workspaces/${workspace.id}/tasks`, command)).status, 201);
  assert.equal((await fetch(origin + '/api/acquisition/state', { headers: { cookie } })).status, 404);
  await app.close(); app = null; await start();
  const snapshot = await fetch(`${origin}/api/workspaces/${workspace.id}`, { headers: { cookie } });
  assert.equal(snapshot.status, 200); assert.equal((await snapshot.json()).tasks[0].title, 'Preserve real work');
  assert.equal((await send(`/api/workspaces/${workspace.id}/tasks`, command)).status, 201);
  const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname=$1", [schema]);
  assert.ok(tables.rows.some(row => row.tablename === 'ws_tasks'));
  assert.ok(!tables.rows.some(row => row.tablename === 'acq_projects'), 'retired acquisition schema was not initialized');
});
