import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { Client, Pool } from 'pg';
import { createAuth } from '../server/acquisition/auth.mjs';
import { createInvite } from '../scripts/acquisition-invite.mjs';
import { createWorkspaces } from '../server/workspaces/index.mjs';

const databaseURL = process.env.WORKSPACES_TEST_DATABASE_URL || process.env.ACQUISITION_TEST_DATABASE_URL;
const secret = randomBytes(48).toString('base64url');
const password = 'Synthetic-workspace-test-password-9482!';
const digest = (v) => createHash('sha256').update(v).digest('hex');
const cmd = () => randomUUID();

async function hostFor({ databaseURL, auth = false, env: overrides = {} } = {}) {
  let workspaces, authentication;
  const sockets = new Set();
  const server = createServer(async (req, res) => {
    try {
      if (await workspaces.handle(req, res)) return;
      if (authentication && await authentication.handle(req, res)) return;
      res.writeHead(404); res.end();
    } catch { res.writeHead(500); res.end('Test host error'); }
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const env = { NODE_ENV: 'test', BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: secret, DATABASE_URL: databaseURL, ...overrides };
  const pool = auth ? new Pool({ connectionString: databaseURL }) : null;
  if (auth) authentication = await createAuth({ pool, env });
  const getIdentity = auth ? (req) => authentication.getIdentity(req) : async () => ({ userId: 'test-user', tenantId: 'ignored' });
  workspaces = createWorkspaces({ env, getIdentity });
  let closed = false;
  return {
    origin, pool, env, authentication, get workspaces() { return workspaces; },
    async restart() { await workspaces.close(); workspaces = createWorkspaces({ env, getIdentity }); },
    async raw(path, { user, method = 'GET', body, headers = {}, signal } = {}) {
      return fetch(`${origin}${path}`, { method, signal, headers: { ...(user ? { cookie: user.cookie } : {}),
        ...(method !== 'GET' ? { origin, 'content-type': 'application/json' } : {}), ...headers },
        ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
    },
    async api(path, options) {
      const response = await this.raw(path, options);
      return { status: response.status, body: await response.json(), headers: response.headers };
    },
    async signIn(email) {
      const response = await this.raw('/api/auth/sign-in/email', { method: 'POST', body: { email, password } });
      assert.equal(response.status, 200, await response.clone().text());
      const cookie = response.headers.getSetCookie().map((v) => v.split(';')[0]).join('; ');
      await response.arrayBuffer();
      const account = (await pool.query('SELECT id,name,email,"emailVerified" FROM acq_auth_users WHERE email=$1', [email])).rows[0];
      return { ...account, cookie };
    },
    async account(email) {
      const invite = await createInvite({ pool, email });
      await authentication.acceptInvite({ token: invite.token, email, name: 'Synthetic workspace user', password });
      return this.signIn(email);
    },
    async close() {
      if (closed) return;
      closed = true;
      await workspaces.close();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
      await pool?.end();
    },
  };
}

async function eventReader(response) {
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/event-stream/);
  const reader = response.body.getReader();
  let buffer = '';
  return {
    async next() {
      for (;;) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary !== -1) { const value = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2); return value; }
        const result = await reader.read();
        if (result.done) return null;
        buffer += new TextDecoder().decode(result.value);
      }
    },
    async cancel() { await reader.cancel(); },
  };
}
async function nextState(reader) {
  for (let i = 0; i < 15; i++) {
    const value = await reader.next();
    assert.notEqual(value, null, 'stream closed before expected state');
    if (value.includes('event: state')) return { id: value.match(/^id: (\d+)/m)[1],
      snapshot: JSON.parse(value.split('\ndata: ')[1]) };
  }
  assert.fail('No snapshot received');
}

test('workspace module fails closed, safe public status and independent routing', async (t) => {
  const host = await hostFor(); t.after(() => host.close());
  const status = await host.api('/api/workspaces/status');
  assert.equal(status.status, 200); assert.equal(status.body.status, 'BLOCKED');
  assert.equal(status.body.ai.status, 'BLOCKED');
  assert.ok(!JSON.stringify(status.body).includes(secret));
  for (const path of ['/api/workspaces', `/api/workspaces/${randomUUID()}`]) assert.equal((await host.api(path)).status, 503);
  assert.equal((await host.raw('/api/workspaces-other')).status, 404);
  assert.equal((await host.raw('/api/acquisition/status')).status, 404);
  assert.equal((await host.api('/api/workspaces/status', { method: 'POST', body: {} })).status, 405);
  await host.workspaces.close();
  assert.equal((await host.api('/api/workspaces/status')).body.database, 'closed');
});

test('workspace connection errors do not leak PostgreSQL credentials', async (t) => {
  const host = await hostFor({ databaseURL: 'postgresql://DO_NOT_EXPOSE:PRIVATE_PASSWORD@127.0.0.1:1/missing' });
  t.after(() => host.close());
  const response = await host.api('/api/workspaces');
  assert.equal(response.status, 503);
  assert.ok(!JSON.stringify(response.body).includes('PRIVATE'));
  assert.equal(host.workspaces.status().status, 'BLOCKED');
});

test('PostgreSQL workspace security, persistence, invitations and snapshot SSE', {
  skip: databaseURL ? false : 'Set ACQUISITION_TEST_DATABASE_URL to an expendable PostgreSQL database.', timeout: 120_000,
}, async (t) => {
  const host = await hostFor({ databaseURL, auth: true });
  const prefix = `workspace-${randomUUID()}`;
  const emails = [];
  const email = (name) => { const value = `${prefix}-${name}@example.test`; emails.push(value); return value; };
  const newEmail = email('new'), expiredEmail = email('expired');
  t.after(async () => {
    await host.workspaces.close();
    const users = (await host.pool.query('SELECT id FROM acq_auth_users WHERE email=ANY($1::text[])', [emails])).rows.map((r) => r.id);
    await host.pool.query('DELETE FROM ws_workspaces WHERE owner_id=ANY($1::text[])', [users]);
    await host.pool.query('DELETE FROM acq_invites WHERE email=ANY($1::text[])', [emails]);
    await host.pool.query('DELETE FROM acq_auth_users WHERE id=ANY($1::text[])', [users]);
    await host.close();
  });
  const owner = await host.account(email('owner'));
  const member = await host.account(email('member'));
  const outsider = await host.account(email('outsider'));
  const actor = (user, method, body) => ({ user, method, body });
  const create = { name: 'Real test workspace', goal: 'Persist human work', deadline: '2027-01-02', commandId: cmd() };
  const created = await host.api('/api/workspaces', actor(owner, 'POST', create));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const w = created.body.workspace.id, path = `/api/workspaces/${w}`;
  const other = await host.api('/api/workspaces', actor(outsider, 'POST', { name: 'Isolated workspace', commandId: cmd() }));
  const otherPath = `/api/workspaces/${other.body.workspace.id}`;
  let memberInvite, task;

  await t.test('uses actual Better Auth identity, no tenant headers, no fixtures', async () => {
    assert.equal(owner.emailVerified, false, 'ordinary existing signup must work');
    assert.equal((await host.api('/api/workspaces')).status, 401);
    const list = await host.api('/api/workspaces', { user: owner });
    assert.deepEqual(list.body.workspaces, [created.body.workspace]);
    const state = await host.api(path, { user: owner });
    assert.equal(state.status, 200);
    assert.deepEqual(state.body.members, [{ userId: owner.id, name: owner.name, email: owner.email, role: 'owner' }]);
    assert.deepEqual(state.body.tasks, []); assert.deepEqual(state.body.materials, []); assert.deepEqual(state.body.proposals, []);
    assert.equal(state.body.ai.status, 'BLOCKED'); assert.equal(state.body.events[0].source, 'human');
    assert.equal(state.body.events[0].type, 'workspace.created'); assert.equal(typeof state.body.events[0].id, 'string');
    assert.equal(state.body.seq, '1');
    assert.equal((await host.api(path, { user: outsider })).status, 404);
    assert.equal((await host.api(`${path}/events`, { user: outsider })).status, 404);
    assert.equal((await host.api(`${path}?tenantId=${outsider.id}`, { user: owner })).status, 400);
    assert.equal((await host.api(path, { user: owner, headers: { 'x-user-id': outsider.id } })).status, 400);
    assert.equal((await host.api('/api/workspaces', actor(owner, 'POST', { ...create, commandId: cmd(), tenantId: outsider.id }))).status, 400);
    assert.equal((await host.api(`${path}/proposals/${randomUUID()}/accept`, actor(owner, 'POST', { commandId: cmd() }))).status, 404);
  });

  await t.test('origin, schema, body and date validation precede writes', async () => {
    for (const headers of [{ origin: 'https://evil.test' }, { 'sec-fetch-site': 'cross-site' }, { origin: '' }]) {
      assert.equal((await host.api('/api/workspaces', { ...actor(owner, 'POST', create), headers })).status, 403);
    }
    assert.equal((await host.api('/api/workspaces', { ...actor(owner, 'POST', create), headers: { 'content-type': 'text/plain' } })).status, 415);
    for (const body of ['{', 'null', '[]', { ...create, deadline: '2027-02-29' }, { ...create, name: '\u0000' },
      { ...create, name: '\ud800' }, { ...create, commandId: 123 }, { ...create, commandId: '' }]) {
      assert.equal((await host.api('/api/workspaces', actor(owner, 'POST', body))).status, 400);
    }
    assert.equal((await host.api(`${path}/events?after=-1`, { user: owner })).status, 400);
    assert.equal((await host.api(`${path}/events?after=1&after=2`, { user: owner })).status, 400);
    assert.equal((await host.api(`${path}/events`, { user: owner, headers: { 'last-event-id': '9223372036854775808' } })).status, 400);
  });

  await t.test('concurrent duplicate creation and changed-body detection survive restarts', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => host.api('/api/workspaces', actor(owner, 'POST', create))));
    for (const result of results) { assert.equal(result.status, 201); assert.deepEqual(result.body, created.body); }
    const reordered = { commandId: create.commandId, deadline: create.deadline, goal: create.goal, name: create.name };
    assert.deepEqual((await host.api('/api/workspaces', actor(owner, 'POST', reordered))).body, created.body);
    assert.equal((await host.api('/api/workspaces', actor(owner, 'POST', { ...create, name: 'Changed' }))).status, 409);
    await host.restart();
    assert.deepEqual((await host.api('/api/workspaces', actor(owner, 'POST', create))).body, created.body);
    assert.equal((await host.api(path, { user: owner })).body.events.length, 1);
  });

  await t.test('existing-account invites are owner-only, hash-only, matched, one-use and idempotent', async () => {
    const body = { email: member.email.toUpperCase(), commandId: cmd() };
    assert.equal((await host.api(`${path}/invites`, actor(outsider, 'POST', body))).status, 404);
    const result = await host.api(`${path}/invites`, actor(owner, 'POST', body));
    assert.equal(result.status, 201, JSON.stringify(result.body)); memberInvite = result.body;
    assert.equal(memberInvite.signupRequired, false); assert.match(memberInvite.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(result.headers.get('referrer-policy'), 'no-referrer');
    await host.restart();
    assert.deepEqual((await host.api(`${path}/invites`, actor(owner, 'POST', body))).body, memberInvite);
    const persisted = await host.pool.query('SELECT * FROM ws_invites WHERE token_hash=$1', [digest(memberInvite.token)]);
    assert.equal(persisted.rowCount, 1);
    assert.ok(!JSON.stringify(persisted.rows).includes(memberInvite.token));
    const commands = await host.pool.query('SELECT * FROM ws_commands WHERE workspace_id=$1', [w]);
    assert.ok(!JSON.stringify(commands.rows).includes(memberInvite.token));
    const accept = { token: memberInvite.token, commandId: cmd() };
    assert.equal((await host.api('/api/workspaces/accept-invite', actor(null, 'POST', accept))).status, 401);
    assert.equal((await host.api('/api/workspaces/accept-invite', actor(outsider, 'POST', accept))).status, 400);
    const accepted = await Promise.all([1, 2].map(() => host.api('/api/workspaces/accept-invite', actor(member, 'POST', accept))));
    for (const response of accepted) { assert.equal(response.status, 200); assert.equal(response.body.workspace.role, 'member'); }
    assert.equal((await host.api('/api/workspaces/accept-invite', actor(member, 'POST', { ...accept, commandId: cmd() }))).status, 400);
    assert.equal((await host.api(`${path}/invites`, actor(member, 'POST', { email: outsider.email, commandId: cmd() }))).status, 403);
    assert.equal((await host.api(`${path}/members/${owner.id}`, actor(owner, 'DELETE', { commandId: cmd() }))).status, 403);
    assert.equal((await host.api(`${path}/members/${owner.id}`, actor(member, 'DELETE', { commandId: cmd() }))).status, 403);
    assert.equal((await host.api(path, { user: member })).body.members.length, 2);
  });

  await t.test('new-account invitation coexists with unchanged signup and team consumption', async () => {
    const result = await host.api(`${path}/invites`, actor(owner, 'POST', { email: newEmail, commandId: cmd() }));
    assert.equal(result.status, 201); assert.equal(result.body.signupRequired, true);
    const tokenHash = digest(result.body.token);
    const team = (await host.pool.query('SELECT * FROM ws_invites WHERE token_hash=$1', [tokenHash])).rows[0];
    const signup = (await host.pool.query('SELECT * FROM acq_invites WHERE token_hash=$1', [tokenHash])).rows[0];
    assert.equal(signup.email, team.email); assert.equal(signup.expires_at.toISOString(), team.expires_at.toISOString());
    assert.equal((await host.pool.query('SELECT 1 FROM acq_auth_users WHERE email=$1', [newEmail])).rowCount, 0);
    const registration = await host.api('/api/acquisition/accept-invite', actor(null, 'POST', { token: result.body.token, email: newEmail, name: 'New workspace user', password }));
    assert.equal(registration.status, 200, JSON.stringify(registration.body));
    assert.equal((await host.pool.query('SELECT consumed_at FROM ws_invites WHERE token_hash=$1', [tokenHash])).rows[0].consumed_at, null);
    const newUser = await host.signIn(newEmail);
    assert.equal(newUser.emailVerified, false);
    assert.equal((await host.api('/api/workspaces', { user: newUser })).body.workspaces.length, 0);
    const accepts = await Promise.all([1, 2].map(() => host.api('/api/workspaces/accept-invite', actor(newUser, 'POST', { token: result.body.token, commandId: cmd() }))));
    assert.deepEqual(accepts.map((r) => r.status).sort(), [200, 400]);
    assert.equal((await host.api(path, { user: newUser })).body.workspace.role, 'member');
    assert.ok((await host.pool.query('SELECT consumed_at FROM acq_invites WHERE token_hash=$1', [tokenHash])).rows[0].consumed_at);
    assert.ok((await host.pool.query('SELECT consumed_at FROM ws_invites WHERE token_hash=$1', [tokenHash])).rows[0].consumed_at);
  });

  await t.test('expired invites fail without consuming or adding members', async () => {
    const user = await host.account(expiredEmail);
    const invite = await host.api(`${path}/invites`, actor(owner, 'POST', { email: expiredEmail, commandId: cmd() }));
    await host.pool.query("UPDATE ws_invites SET created_at=now()-interval '4 days',expires_at=now()-interval '1 day' WHERE token_hash=$1", [digest(invite.body.token)]);
    const result = await host.api('/api/workspaces/accept-invite', actor(user, 'POST', { token: invite.body.token, commandId: cmd() }));
    assert.equal(result.status, 400); assert.equal(result.body.code, 'INVITE_INVALID');
    assert.equal((await host.api(path, { user })).status, 404);
  });

  await t.test('materials support 5 MiB text, bounded JSON and source audit', async () => {
    const body = { title: 'Evidence notes', content: 'x'.repeat(5 * 1024 * 1024), commandId: cmd() };
    const result = await host.api(`${path}/materials`, actor(member, 'POST', body));
    assert.equal(result.status, 201, JSON.stringify(result.body).slice(0, 200));
    assert.equal(result.body.material.authorId, member.id); assert.equal(result.body.material.content.length, 5 * 1024 * 1024);
    assert.equal((await host.api(`${path}/materials`, actor(member, 'POST', body))).body.material.id, result.body.material.id);
    assert.equal((await host.api(`${path}/materials`, actor(member, 'POST', { ...body, content: 'Different' }))).status, 409);
    assert.equal((await host.api(`${path}/materials`, actor(outsider, 'POST', { title: 'No', content: 'No', commandId: cmd() }))).status, 404);
    assert.equal((await host.api(`${path}/materials`, actor(member, 'POST', { ...body, content: 'x'.repeat(6 * 1024 * 1024), commandId: cmd() }))).status, 413);
    const event = (await host.pool.query("SELECT * FROM ws_events WHERE workspace_id=$1 AND kind='material.created'", [w])).rows[0];
    assert.equal(event.actor_id, member.id); assert.equal(event.details.contentSha256, digest(body.content));
    assert.ok(!Object.hasOwn(event.details, 'content'));
    // Keep later SSE frames small; this direct test-only cleanup is not an API.
    await host.pool.query('DELETE FROM ws_materials WHERE workspace_id=$1', [w]);
    const small = await host.api(`${path}/materials`, actor(member, 'POST', { title: 'Notes', content: 'Human source\nSecond line', commandId: cmd() }));
    assert.equal(small.status, 201);
  });

  await t.test('chunked bodies cannot evade the 6 MiB bound', async () => {
    const result = await new Promise((resolve, reject) => {
      const req = httpRequest(`${host.origin}${path}/materials`, { method: 'POST', headers: {
        origin: host.origin, cookie: owner.cookie, 'content-type': 'application/json', 'transfer-encoding': 'chunked',
      } }, (res) => { let text = ''; res.setEncoding('utf8'); res.on('data', (v) => { text += v; }); res.on('end', () => resolve({ status: res.statusCode, text })); });
      req.on('error', reject);
      for (let i = 0; i < 7; i++) req.write('x'.repeat(1024 * 1024));
      req.end();
    });
    assert.equal(result.status, 413);
  });

  await t.test('task membership isolation and version conflicts are atomic', async () => {
    const body = { title: 'Human task', assigneeId: member.id, status: 'todo', dueDate: '2027-02-28', commandId: cmd() };
    assert.equal((await host.api(`${path}/tasks`, actor(owner, 'POST', { ...body, assigneeId: outsider.id }))).status, 400);
    const results = await Promise.all([1, 2, 3].map(() => host.api(`${path}/tasks`, actor(member, 'POST', body))));
    for (const result of results) assert.equal(result.status, 201);
    task = results[0].body.task;
    assert.equal(task.version, 1); assert.equal(new Set(results.map((r) => r.body.task.id)).size, 1);
    assert.equal((await host.api(`${otherPath}/tasks/${task.id}`, actor(outsider, 'PATCH', { version: 1, title: 'Cross-workspace', commandId: cmd() }))).status, 404);
    const changes = [{ version: 1, title: 'Owner edit', commandId: cmd() }, { version: 1, title: 'Member edit', commandId: cmd() }];
    const concurrent = await Promise.all(changes.map((body, i) => host.api(`${path}/tasks/${task.id}`, actor(i ? member : owner, 'PATCH', body))));
    assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
    const winner = concurrent.findIndex((r) => r.status === 200);
    task = concurrent[winner].body.task; assert.equal(task.version, 2);
    assert.deepEqual((await host.api(`${path}/tasks/${task.id}`, actor(winner ? member : owner, 'PATCH', changes[winner]))).body.task, task);
    assert.equal((await host.api(`${path}/tasks/${task.id}`, actor(owner, 'PATCH', { version: 2, commandId: cmd() }))).status, 400);
    const latest = await host.api(`${path}/tasks/${task.id}`, actor(member, 'PATCH', { version: 2, assigneeId: null, dueDate: null, status: 'doing', commandId: cmd() }));
    assert.equal(latest.status, 200); task = latest.body.task;
    assert.equal(task.version, 3); assert.equal(task.dueDate, null); assert.equal(task.assigneeId, null);
    await assert.rejects(host.pool.query(`INSERT INTO ws_tasks (id,workspace_id,title,assignee_id,status) VALUES ($1,$2,'Forbidden',$3,'todo')`, [randomUUID(), w, outsider.id]), { code: '23503' });
  });

  await t.test('SSE snapshots use durable monotonic IDs, skip unchanged material reads, and bound streams', async (sub) => {
    const query = Client.prototype.query;
    let materialReads = 0;
    sub.mock.method(Client.prototype, 'query', function (...args) {
      if (typeof args[0] === 'string' && /^SELECT .* FROM ws_materials /.test(args[0]) && args[1]?.[0] === w) materialReads++;
      return query.apply(this, args);
    });
    const response = await host.raw(`${path}/events`, { user: member });
    assert.equal(response.headers.get('x-accel-buffering'), 'no');
    const reader = await eventReader(response);
    try {
      const first = await nextState(reader); assert.equal(first.id, first.snapshot.seq);
      assert.equal(materialReads, 1);
      assert.match(await reader.next(), /^: heartbeat/);
      assert.equal(materialReads, 1, 'unchanged poll must not load material content');
      const change = await host.api(`${path}/tasks/${task.id}`, actor(owner, 'PATCH', { version: task.version, status: 'done', assigneeId: member.id, commandId: cmd() }));
      assert.equal(change.status, 200); task = change.body.task;
      const next = await nextState(reader); assert.ok(BigInt(next.id) > BigInt(first.id));
      assert.equal(materialReads, 2, 'changed poll loads a fresh full snapshot');
      assert.equal(next.snapshot.tasks.find((v) => v.id === task.id).status, 'done');
      const same = await eventReader(await host.raw(`${path}/events?after=0`, { user: member, headers: { 'last-event-id': next.id } }));
      try {
        assert.match(await same.next(), /^: heartbeat/);
        assert.equal(materialReads, 2, 'equal reconnect cursor must not load materials');
        assert.equal((await host.api(`${path}/events`, { user: member })).status, 429);
      } finally { await same.cancel(); }
      const ahead = await host.api(`${path}/events?after=9223372036854775807`, { user: owner });
      assert.equal(ahead.status, 409);
      assert.equal(materialReads, 2, 'ahead cursor must fail before loading materials');
      const resumed = await eventReader(await host.raw(`${path}/events?after=${first.id}`, { user: owner }));
      try {
        assert.equal((await nextState(resumed)).id, next.id);
        assert.equal(materialReads, 3, 'older reconnect cursor loads current snapshot');
      } finally { await resumed.cancel(); }
    } finally { await reader.cancel(); }
  });

  await t.test('task deletion requires the current version, is isolated and records a durable tombstone', async () => {
    const created = await host.api(`${path}/tasks`, actor(member, 'POST', { title: 'Delete this task', commandId: cmd() }));
    const doomed = created.body.task;
    const remove = { version: doomed.version, commandId: cmd() };
    assert.equal((await host.api(`${path}/tasks/${doomed.id}`, actor(outsider, 'DELETE', remove))).status, 404);
    assert.equal((await host.api(`${otherPath}/tasks/${doomed.id}`, actor(outsider, 'DELETE', remove))).status, 404);
    assert.equal((await host.api(`${path}/tasks/${doomed.id}`, actor(member, 'DELETE', { commandId: cmd() }))).status, 400);
    assert.equal((await host.api(`${path}/tasks/${doomed.id}`, actor(member, 'DELETE', { version: 2, commandId: cmd() }))).status, 409);
    const results = await Promise.all([1, 2].map(() => host.api(`${path}/tasks/${doomed.id}`, actor(member, 'DELETE', remove))));
    for (const result of results) { assert.equal(result.status, 200); assert.deepEqual(result.body, { ok: true }); }
    assert.equal((await host.api(`${path}/tasks/${doomed.id}`, actor(member, 'DELETE', { ...remove, version: 2 }))).status, 409);
    assert.equal((await host.api(path, { user: owner })).body.tasks.some((v) => v.id === doomed.id), false);
    const event = (await host.pool.query("SELECT details FROM ws_events WHERE workspace_id=$1 AND entity_id=$2 AND kind='task.deleted'", [w, doomed.id])).rows[0];
    assert.equal(event.details.deleted, true); assert.deepEqual(event.details.before, doomed);
  });

  await t.test('removal revokes reads, writes, command replay and active SSE; unassigns tasks', async () => {
    const reader = await eventReader(await host.raw(`${path}/events`, { user: member }));
    await nextState(reader);
    const removal = { commandId: cmd() };
    assert.equal((await host.api(`${path}/members/${member.id}`, actor(owner, 'DELETE', removal))).status, 200);
    assert.equal((await host.api(`${path}/members/${member.id}`, actor(owner, 'DELETE', removal))).status, 200);
    assert.equal((await host.api(path, { user: member })).status, 404);
    assert.equal((await host.api(`${path}/tasks`, actor(member, 'POST', { title: 'Revoked', commandId: cmd() }))).status, 404);
    const oldCommand = (await host.pool.query("SELECT command_id FROM ws_events WHERE workspace_id=$1 AND actor_id=$2 AND kind='member.joined'", [w, member.id])).rows[0].command_id;
    assert.equal((await host.api('/api/workspaces/accept-invite', actor(member, 'POST', { token: memberInvite.token, commandId: oldCommand }))).status, 404);
    let end;
    for (let i = 0; i < 5; i++) { end = await reader.next(); if (end === null || end.includes('workspace-error')) break; }
    assert.match(end, /WORKSPACE_NOT_FOUND/); assert.equal(await reader.next(), null);
    const current = (await host.api(path, { user: owner })).body.tasks.find((v) => v.id === task.id);
    assert.equal(current.assigneeId, null); assert.equal(current.version, task.version + 1);
  });

  await t.test('a membership check queued behind revocation cannot use a stale join snapshot', async () => {
    const invitation = await host.api(`${path}/invites`, actor(owner, 'POST', { email: member.email, commandId: cmd() }));
    assert.equal((await host.api('/api/workspaces/accept-invite', actor(member, 'POST', { token: invitation.body.token, commandId: cmd() }))).status, 200);
    const lock = await host.pool.connect();
    try {
      await lock.query('BEGIN'); await lock.query('SELECT id FROM ws_workspaces WHERE id=$1 FOR UPDATE', [w]);
      const pending = host.api(`${path}/tasks`, actor(member, 'POST', { title: 'Queued revoked write', commandId: cmd() }));
      await delay(100);
      await lock.query('DELETE FROM ws_members WHERE workspace_id=$1 AND user_id=$2', [w, member.id]);
      await lock.query('UPDATE ws_workspaces SET seq=seq+1 WHERE id=$1', [w]);
      await lock.query('COMMIT');
      assert.equal((await pending).status, 404);
    } finally { await lock.query('ROLLBACK'); lock.release(); }
  });

  await t.test('real auth sign-out revokes SSE, and module shutdown closes streams', async () => {
    const disposable = await host.signIn(owner.email);
    const reader = await eventReader(await host.raw(`${path}/events`, { user: disposable }));
    await nextState(reader);
    assert.equal((await host.api('/api/auth/sign-out', actor(disposable, 'POST', {}))).status, 200);
    const error = await reader.next(); assert.match(error, /SESSION_REQUIRED/); assert.equal(await reader.next(), null);
    const stillSignedIn = await host.signIn(owner.email);
    const closing = await eventReader(await host.raw(`${path}/events`, { user: stillSignedIn }));
    await nextState(closing); await host.workspaces.close(); assert.equal(await closing.next(), null);
    await host.restart();
  });

  await t.test('fresh Node process sees persisted state and replays a command without duplicating it', async () => {
    const identity = await host.authentication.getIdentity({ headers: { cookie: (await host.signIn(owner.email)).cookie } });
    const script = `
      import {createWorkspaces} from ${JSON.stringify(new URL('../server/workspaces/index.mjs', import.meta.url).href)};
      import {createServer} from 'node:http';
      import {once} from 'node:events';
      const origin = process.env.WS_ORIGIN;
      const app=createWorkspaces({env:{...process.env,BETTER_AUTH_URL:origin},getIdentity:async()=>JSON.parse(process.env.WS_IDENTITY)});
      const server=createServer((req,res)=>void app.handle(req,res));
      server.listen(0,'127.0.0.1'); await once(server,'listening');
      const base='http://127.0.0.1:'+server.address().port;
      const snapshot=await (await fetch(base+process.env.WS_PATH)).json();
      const replay=await fetch(base+'/api/workspaces',{method:'POST',headers:{origin,'content-type':'application/json'},body:process.env.WS_CREATE});
      console.log(JSON.stringify({snapshot,replayStatus:replay.status,replay:await replay.json()}));
      await app.close();server.closeAllConnections();await new Promise(r=>server.close(r));
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env,
      DATABASE_URL: databaseURL, BETTER_AUTH_SECRET: secret, NODE_ENV: 'test', WS_ORIGIN: host.origin,
      WS_IDENTITY: JSON.stringify(identity), WS_PATH: path, WS_CREATE: JSON.stringify(create) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = ''; child.stdout.on('data', (v) => { output += v; }); child.stderr.on('data', (v) => { errors += v; });
    const [code] = await once(child, 'exit'); assert.equal(code, 0, errors);
    const value = JSON.parse(output); assert.equal(value.replayStatus, 201); assert.deepEqual(value.replay, created.body);
    assert.equal(value.snapshot.workspace.id, w); assert.equal(value.snapshot.tasks.length, 1); assert.equal(value.snapshot.materials.length, 1);
    const events = value.snapshot.events.map((e) => BigInt(e.seq));
    assert.ok(events.every((e, i) => i === 0 || e > events[i - 1]));
    assert.equal(value.snapshot.ai.status, 'BLOCKED');
  });
});
