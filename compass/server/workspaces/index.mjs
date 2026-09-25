import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { normalizeInviteEmail } from '../acquisition/auth.mjs';

const PREFIX = '/api/workspaces';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const LIMITS = Object.freeze({ bodyBytes: 6 * 1024 * 1024, materialBytes: 5 * 1024 * 1024,
  workspaceMaterialBytes: 20 * 1024 * 1024, tasks: 1000, materials: 100, members: 100,
  workspacesPerUser: 100, recentEvents: 200, streams: 50, streamsPerUser: 2, pollMs: 1000 });
const AI = Object.freeze({ status: 'BLOCKED', reason: 'No verified team-workspace AI runtime is available. No model calls or proposals are generated.' });
const hash = (text) => createHash('sha256').update(text).digest('hex');
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const canonical = (v) => record(v) ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
  : Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : JSON.stringify(v);

class WorkspaceError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new WorkspaceError(status, code, message); };
const invalid = () => fail(400, 'INVALID_INPUT', 'Invalid workspace request.');
const missing = () => fail(404, 'WORKSPACE_NOT_FOUND', 'Workspace is not available.');
const unavailable = () => new WorkspaceError(503, 'WORKSPACES_UNAVAILABLE', 'Persistent workspaces are unavailable. No success is assumed; retry with the same commandId.');
const inviteInvalid = () => fail(400, 'INVITE_INVALID', 'Invite is invalid, expired, already used, or belongs to another email.');

function textField(v, max, empty = false, multiline = false) {
  if (typeof v !== 'string' || !v.isWellFormed() || Buffer.byteLength(v) > max
    || (multiline ? /\x00/ : /[\x00-\x1f\x7f]/).test(v) || (!empty && !v.trim())) invalid();
  return multiline ? v : v.trim();
}
function dateField(v) {
  if (v === null) return null;
  if (typeof v !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(v)) invalid();
  const d = new Date(`${v}T00:00:00.000Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== v) invalid();
  return v;
}
function userField(v) {
  if (v === null) return null;
  return textField(v, 128);
}
function stateField(v) { if (!['todo', 'doing', 'done'].includes(v)) invalid(); return v; }
function inputFor(kind, body) {
  const allowed = { create: ['name', 'goal', 'deadline'], material: ['title', 'content'],
    task: ['title', 'assigneeId', 'status', 'dueDate'], patch: ['version', 'title', 'assigneeId', 'status', 'dueDate'],
    invite: ['email'], accept: ['token'], remove: [], deleteTask: ['version'] }[kind];
  if (!record(body) || Object.keys(body).some((k) => k !== 'commandId' && !allowed.includes(k)) || typeof body.commandId !== 'string' || !KEY.test(body.commandId)) invalid();
  const result = { commandId: body.commandId };
  if (kind === 'create') Object.assign(result, { name: textField(body.name, 160), goal: textField(body.goal ?? '', 8192, true, true), deadline: dateField(body.deadline ?? null) });
  if (kind === 'material') Object.assign(result, { title: textField(body.title, 240), content: textField(body.content, LIMITS.materialBytes, false, true) });
  if (kind === 'task') Object.assign(result, { title: textField(body.title, 240), assigneeId: userField(body.assigneeId ?? null), status: stateField(body.status ?? 'todo'), dueDate: dateField(body.dueDate ?? null) });
  if (kind === 'patch') {
    if (!Number.isInteger(body.version) || body.version < 1 || body.version >= 2147483647 || Object.keys(body).length < 3) invalid();
    result.version = body.version;
    for (const [k, validate] of Object.entries({ title: (v) => textField(v, 240), assigneeId: userField, status: stateField, dueDate: dateField })) {
      if (Object.hasOwn(body, k)) result[k] = validate(body[k]);
    }
  }
  if (kind === 'deleteTask') {
    if (!Number.isInteger(body.version) || body.version < 1 || body.version > 2147483647) invalid();
    result.version = body.version;
  }
  if (kind === 'invite') { try { result.email = normalizeInviteEmail(body.email); } catch { invalid(); } }
  if (kind === 'accept') { if (typeof body.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.token)) inviteInvalid(); result.token = body.token; }
  return result;
}

async function readBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) fail(415, 'JSON_REQUIRED', 'Use application/json.');
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') fail(415, 'ENCODING_UNSUPPORTED', 'Compressed request bodies are not supported.');
  const declared = req.headers['content-length'];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > LIMITS.bodyBytes)) {
    req.resume(); fail(413, 'BODY_TOO_LARGE', 'Request exceeds the 6 MiB JSON limit.');
  }
  const buffer = await new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    const finish = (error) => {
      clearTimeout(timer);
      req.off('data', data); req.off('end', end); req.off('error', abort); req.off('aborted', abort);
      if (error) { req.resume(); reject(error); } else resolve(Buffer.concat(chunks));
    };
    const data = (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > LIMITS.bodyBytes) finish(new WorkspaceError(413, 'BODY_TOO_LARGE', 'Request exceeds the 6 MiB JSON limit.'));
      else chunks.push(Buffer.from(chunk));
    };
    const end = () => finish();
    const abort = () => finish(new WorkspaceError(400, 'BODY_INTERRUPTED', 'Request body was interrupted.'));
    const timer = setTimeout(() => finish(new WorkspaceError(408, 'BODY_TIMEOUT', 'Request body timed out.')), 15_000);
    req.on('data', data); req.once('end', end); req.once('error', abort); req.once('aborted', abort);
    if (req.aborted || req.destroyed) abort();
  });
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)); } catch { invalid(); }
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  res.end(JSON.stringify(body));
}
function configFor(env, getIdentity) {
  try {
    if (!/^postgres(?:ql)?:\/\//.test(env.DATABASE_URL || '') || typeof getIdentity !== 'function') return null;
    const url = new URL(env.BETTER_AUTH_URL);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return null;
    return { origin: url.origin };
  } catch { return null; }
}
function routeFor(path, method) {
  if (path === PREFIX) return { kind: method === 'GET' ? 'list' : 'create', methods: ['GET', 'POST'] };
  if (path === `${PREFIX}/status`) return { kind: 'status', methods: ['GET'] };
  if (path === `${PREFIX}/accept-invite`) return { kind: 'accept', methods: ['POST'] };
  const parts = path.slice(PREFIX.length + 1).split('/');
  if (!UUID.test(parts[0])) return null;
  const base = { workspaceId: parts[0] };
  if (parts.length === 1) return { ...base, kind: 'snapshot', methods: ['GET'] };
  const kinds = { materials: ['material', 'POST'], tasks: ['task', 'POST'], invites: ['invite', 'POST'], events: ['events', 'GET'] };
  if (parts.length === 2 && kinds[parts[1]]) return { ...base, kind: kinds[parts[1]][0], methods: [kinds[parts[1]][1]] };
  if (parts.length === 3 && parts[1] === 'tasks' && UUID.test(parts[2])) return { ...base, kind: method === 'DELETE' ? 'deleteTask' : 'patch', taskId: parts[2], methods: ['PATCH', 'DELETE'] };
  if (parts.length === 3 && parts[1] === 'members' && KEY.test(parts[2])) return { ...base, kind: 'remove', userId: parts[2], methods: ['DELETE'] };
  return null;
}

const workspace = (r, userId) => ({ id: r.id, name: r.name, goal: r.goal, deadline: r.deadline, role: r.owner_id === userId ? 'owner' : 'member' });
const taskColumns = 'id, title, assignee_id AS "assigneeId", status, due_date::text AS "dueDate", version';
const materialColumns = 'id, title, content, created_at AS "createdAt", author_id AS "authorId"';

/** Independent pool, lazy additive migration, no background AI/runtime work.
 * Returns false only for paths outside /api/workspaces. Await close() at shutdown.
 */
export function createWorkspaces({ env = process.env, getIdentity } = {}) {
  const config = configFor(env, getIdentity);
  const inviteSecret = typeof env.BETTER_AUTH_SECRET === 'string' && env.BETTER_AUTH_SECRET.trim().length >= 32 ? env.BETTER_AUTH_SECRET : null;
  let pool, initialization, initialized = false, closed = false, database = config ? 'configured' : 'blocked', closing;
  const streams = new Map();
  if (config) {
    try {
      pool = new Pool({ connectionString: env.DATABASE_URL, max: 8, connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30_000, statement_timeout: 15_000, idle_in_transaction_session_timeout: 20_000 });
      pool.on('error', () => { database = 'unavailable'; });
    } catch { database = 'blocked'; }
  }
  const status = () => ({ status: closed || !pool || database === 'unavailable' ? 'BLOCKED' : database === 'ready' ? 'READY' : 'CONFIGURED',
    database: closed ? 'closed' : database, reason: closed ? 'Workspace service is closed.' : database === 'ready' ? 'PostgreSQL workspace storage is ready.'
      : pool ? 'Database availability is checked on authenticated requests.' : 'PostgreSQL and verified same-origin authentication must be configured.',
    ai: AI, invitesConfigured: Boolean(inviteSecret), limits: LIMITS });

  async function transaction(action) {
    if (closed || !pool) throw unavailable();
    const client = await pool.connect();
    let discard;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '5s'");
      const result = await action(client);
      await client.query('COMMIT');
      database = 'ready';
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (e) { discard = e; }
      throw error;
    } finally { client.release(discard); }
  }
  async function ready() {
    if (closed || !pool) throw unavailable();
    if (initialized) return;
    if (!initialization) initialization = (async () => {
      const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
      await transaction(async (c) => {
        await c.query('SELECT pg_advisory_xact_lock(1128353105, 1465073665)');
        await c.query('SELECT id, name, email FROM acq_auth_users LIMIT 0');
        await c.query('SELECT token_hash, email, expires_at FROM acq_invites LIMIT 0');
        await c.query(schema);
      });
      initialized = true;
    })().finally(() => { initialization = null; });
    await initialization;
  }
  async function identity(req) {
    let timer;
    try {
      const value = await Promise.race([Promise.resolve().then(() => getIdentity(req)),
        new Promise((_, reject) => { timer = setTimeout(() => reject(unavailable()), 5000); })]);
      if (value == null) fail(401, 'SESSION_REQUIRED', 'Sign in with your invited account.');
      if (typeof value.userId !== 'string' || !KEY.test(value.userId)) throw unavailable();
      // tenantId is deliberately not workspace authority.
      return value.userId;
    } finally { clearTimeout(timer); }
  }
  async function profile(c, userId) {
    const result = await c.query('SELECT id, name, email FROM acq_auth_users WHERE id = $1 FOR SHARE', [userId]);
    if (!result.rowCount) fail(401, 'SESSION_REQUIRED', 'An existing signed-in account is required.');
    return result.rows[0];
  }
  async function guard(c, workspaceId, userId, write = false, ownerOnly = false) {
    const result = await c.query(`SELECT w.*, w.deadline::text AS deadline FROM ws_workspaces w
      WHERE w.id = $1 FOR ${write ? 'UPDATE' : 'SHARE'}`, [workspaceId]);
    if (!result.rowCount) missing();
    // Check membership in a fresh statement AFTER acquiring the workspace lock.
    // A joined locking SELECT can retain a pre-revocation membership snapshot
    // while waiting for a concurrent removal to commit under READ COMMITTED.
    if (!(await c.query('SELECT 1 FROM ws_members WHERE workspace_id=$1 AND user_id=$2', [workspaceId, userId])).rowCount) missing();
    if (ownerOnly && result.rows[0].owner_id !== userId) fail(403, 'OWNER_REQUIRED', 'Only the workspace owner can do this.');
    return result.rows[0];
  }
  async function membershipLimit(c, userId) {
    const count = await c.query('SELECT count(*)::int AS n FROM ws_members WHERE user_id=$1', [userId]);
    if (count.rows[0].n >= LIMITS.workspacesPerUser) fail(409, 'WORKSPACE_LIMIT', 'Account workspace limit reached.');
  }
  async function assignee(c, workspaceId, userId) {
    if (userId !== null && !(await c.query('SELECT 1 FROM ws_members WHERE workspace_id=$1 AND user_id=$2', [workspaceId, userId])).rowCount) {
      fail(400, 'INVALID_ASSIGNEE', 'Assignee must belong to this workspace.');
    }
  }
  async function audit(c, workspaceId, userId, commandId, kind, entityId, details) {
    const { rows: [w] } = await c.query('UPDATE ws_workspaces SET seq=seq+1 WHERE id=$1 RETURNING seq', [workspaceId]);
    await c.query(`INSERT INTO ws_events (workspace_id,seq,actor_id,command_id,kind,entity_id,details)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`, [workspaceId, w.seq, userId, commandId, kind, entityId, details]);
  }
  async function snapshot(c, w, userId) {
    const members = await c.query(`SELECT u.id AS "userId", u.name, u.email,
      CASE WHEN u.id=$2 THEN 'owner' ELSE 'member' END AS role FROM ws_members m
      JOIN acq_auth_users u ON u.id=m.user_id WHERE m.workspace_id=$1 ORDER BY m.created_at,u.id`, [w.id, w.owner_id]);
    const tasks = await c.query(`SELECT ${taskColumns} FROM ws_tasks WHERE workspace_id=$1 ORDER BY created_at,id`, [w.id]);
    const materials = await c.query(`SELECT ${materialColumns} FROM ws_materials WHERE workspace_id=$1 ORDER BY created_at,id`, [w.id]);
    const events = await c.query(`SELECT seq::text AS id, seq::text, actor_id AS "actorId", command_id AS "commandId",
      kind, kind AS type, entity_id AS "entityId", source, details, created_at AS "createdAt" FROM ws_events
      WHERE workspace_id=$1 ORDER BY ws_events.seq DESC LIMIT $2`, [w.id, LIMITS.recentEvents]);
    return { workspace: workspace(w, userId), members: members.rows, tasks: tasks.rows, materials: materials.rows,
      proposals: [], events: events.rows.reverse(), ai: AI, seq: String(w.seq) };
  }
  function inviteToken(inviteId) {
    if (!inviteSecret) fail(503, 'INVITES_UNAVAILABLE', 'A stable Better Auth secret is required for invitations.');
    return createHmac('sha256', inviteSecret).update(`compass-team-invite:v1:${inviteId}`).digest('base64url');
  }
  async function presentResponse(c, kind, response) {
    if (kind !== 'invite') return response;
    const token = inviteToken(response.inviteId);
    const saved = await c.query('SELECT token_hash FROM ws_invites WHERE id=$1', [response.inviteId]);
    if (saved.rows[0]?.token_hash !== hash(token)) fail(503, 'INVITES_UNAVAILABLE', 'Invite signing key changed. Create a new invitation with a new commandId.');
    return { token, expiresAt: response.expiresAt, signupRequired: response.signupRequired };
  }

  async function mutate(route, method, path, body, userId) {
    const input = inputFor(route.kind, body);
    const requestHash = hash(canonical({ method, path, body }));
    return transaction(async (c) => {
      const account = await profile(c, userId);
      // One actor lock precedes every workspace lock: cross-process command
      // replay and account membership limits use a consistent lock order.
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 1465073665))', [userId]);
      const old = (await c.query('SELECT * FROM ws_commands WHERE user_id=$1 AND command_id=$2', [userId, input.commandId])).rows[0];
      let w;
      if (route.workspaceId) w = await guard(c, route.workspaceId, userId, true, ['invite', 'remove'].includes(route.kind));
      if (old) {
        if (old.request_hash !== requestHash) fail(409, 'COMMAND_MISMATCH', 'commandId was already used for a different request.');
        if (!w) await guard(c, old.workspace_id, userId, true);
        return { status: old.http_status, body: await presentResponse(c, route.kind, old.response) };
      }
      let response, code = 200, kind, entityId, details;
      if (route.kind === 'create') {
        await membershipLimit(c, userId);
        const id = randomUUID();
        w = (await c.query(`INSERT INTO ws_workspaces (id,name,goal,deadline,owner_id) VALUES ($1,$2,$3,$4,$5)
          RETURNING *, deadline::text AS deadline`, [id, input.name, input.goal, input.deadline, userId])).rows[0];
        await c.query('INSERT INTO ws_members (workspace_id,user_id) VALUES ($1,$2)', [id, userId]);
        response = { workspace: workspace(w, userId) }; code = 201; kind = 'workspace.created'; entityId = id;
        details = { after: response.workspace };
      } else if (route.kind === 'material') {
        const usage = (await c.query('SELECT count(*)::int AS n, coalesce(sum(octet_length(content)),0)::bigint AS bytes FROM ws_materials WHERE workspace_id=$1', [w.id])).rows[0];
        if (usage.n >= LIMITS.materials || Number(usage.bytes) + Buffer.byteLength(input.content) > LIMITS.workspaceMaterialBytes) fail(409, 'MATERIAL_LIMIT', 'Workspace material limit reached.');
        const material = (await c.query(`INSERT INTO ws_materials (id,workspace_id,title,content,author_id) VALUES ($1,$2,$3,$4,$5) RETURNING ${materialColumns}`,
          [randomUUID(), w.id, input.title, input.content, userId])).rows[0];
        response = { material }; code = 201; kind = 'material.created'; entityId = material.id;
        details = { title: material.title, authorId: userId, contentSha256: hash(material.content), contentBytes: Buffer.byteLength(material.content) };
      } else if (route.kind === 'task') {
        const count = (await c.query('SELECT count(*)::int AS n FROM ws_tasks WHERE workspace_id=$1', [w.id])).rows[0].n;
        if (count >= LIMITS.tasks) fail(409, 'TASK_LIMIT', 'Workspace task limit reached.');
        await assignee(c, w.id, input.assigneeId);
        const task = (await c.query(`INSERT INTO ws_tasks (id,workspace_id,title,assignee_id,status,due_date) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${taskColumns}`,
          [randomUUID(), w.id, input.title, input.assigneeId, input.status, input.dueDate])).rows[0];
        response = { task }; code = 201; kind = 'task.created'; entityId = task.id; details = { after: task };
      } else if (route.kind === 'patch') {
        const before = (await c.query(`SELECT ${taskColumns} FROM ws_tasks WHERE workspace_id=$1 AND id=$2`, [w.id, route.taskId])).rows[0];
        if (!before) fail(404, 'TASK_NOT_FOUND', 'Task is not available.');
        if (before.version !== input.version) fail(409, 'VERSION_CONFLICT', 'Task changed. Refetch the snapshot before editing with a new commandId.');
        const next = { ...before, ...input };
        await assignee(c, w.id, next.assigneeId);
        const result = await c.query(`UPDATE ws_tasks SET title=$3,assignee_id=$4,status=$5,due_date=$6,version=version+1
          WHERE workspace_id=$1 AND id=$2 AND version=$7 RETURNING ${taskColumns}`, [w.id, before.id, next.title, next.assigneeId, next.status, next.dueDate, input.version]);
        if (!result.rowCount) fail(409, 'VERSION_CONFLICT', 'Task changed. Refetch before editing.');
        response = { task: result.rows[0] }; kind = 'task.updated'; entityId = before.id; details = { before, after: response.task };
      } else if (route.kind === 'deleteTask') {
        const before = (await c.query(`SELECT ${taskColumns} FROM ws_tasks WHERE workspace_id=$1 AND id=$2`, [w.id, route.taskId])).rows[0];
        if (!before) fail(404, 'TASK_NOT_FOUND', 'Task is not available.');
        if (before.version !== input.version) fail(409, 'VERSION_CONFLICT', 'Task changed. Refetch before deleting with a new commandId.');
        const removed = await c.query('DELETE FROM ws_tasks WHERE workspace_id=$1 AND id=$2 AND version=$3', [w.id, before.id, input.version]);
        if (!removed.rowCount) fail(409, 'VERSION_CONFLICT', 'Task changed. Refetch before deleting.');
        response = { ok: true }; kind = 'task.deleted'; entityId = before.id; details = { before, deleted: true };
      } else if (route.kind === 'invite') {
        const count = (await c.query('SELECT count(*)::int AS n FROM ws_invites WHERE workspace_id=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp()', [w.id])).rows[0].n;
        if (count >= 100) fail(409, 'INVITE_LIMIT', 'Too many active workspace invitations.');
        const exists = await c.query('SELECT id FROM acq_auth_users WHERE lower(email)=$1', [input.email]);
        if (exists.rowCount && (await c.query('SELECT 1 FROM ws_members WHERE workspace_id=$1 AND user_id=$2', [w.id, exists.rows[0].id])).rowCount) fail(409, 'ALREADY_MEMBER', 'This account is already a member.');
        const id = randomUUID(), digest = hash(inviteToken(id)), signupRequired = !exists.rowCount;
        const invite = (await c.query(`INSERT INTO ws_invites (id,workspace_id,token_hash,email,created_by,signup_required,expires_at)
          VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP + interval '72 hours') RETURNING expires_at`, [id, w.id, digest, input.email, userId, signupRequired])).rows[0];
        if (signupRequired) await c.query('INSERT INTO acq_invites (id,token_hash,email,expires_at) VALUES ($1,$2,$3,$4)', [randomUUID(), digest, input.email, invite.expires_at]);
        response = { inviteId: id, expiresAt: invite.expires_at.toISOString(), signupRequired }; code = 201;
        kind = 'invite.created'; entityId = id; details = { expiresAt: response.expiresAt, signupRequired };
      } else if (route.kind === 'accept') {
        const digest = hash(input.token);
        // Read the workspace locator first; always take workspace before invite
        // row locks so membership revocation and consumption cannot interleave.
        const locator = (await c.query('SELECT workspace_id FROM ws_invites WHERE token_hash=$1', [digest])).rows[0];
        if (!locator) inviteInvalid();
        w = (await c.query('SELECT *, deadline::text AS deadline FROM ws_workspaces WHERE id=$1 FOR UPDATE', [locator.workspace_id])).rows[0];
        if (!w) inviteInvalid();
        const invite = (await c.query(`SELECT * FROM ws_invites WHERE token_hash=$1 AND email=$2
          AND consumed_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE`, [digest, account.email.trim().toLowerCase()])).rows[0];
        if (!invite) inviteInvalid();
        if ((await c.query('SELECT 1 FROM ws_members WHERE workspace_id=$1 AND user_id=$2', [w.id, userId])).rowCount) fail(409, 'ALREADY_MEMBER', 'This account is already a member.');
        await membershipLimit(c, userId);
        if ((await c.query('SELECT count(*)::int AS n FROM ws_members WHERE workspace_id=$1', [w.id])).rows[0].n >= LIMITS.members) fail(409, 'MEMBER_LIMIT', 'Workspace member limit reached.');
        await c.query('INSERT INTO ws_members (workspace_id,user_id) VALUES ($1,$2)', [w.id, userId]);
        const consumed = await c.query(`UPDATE ws_invites SET consumed_at=clock_timestamp(),consumed_by=$2
          WHERE id=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp()`, [invite.id, userId]);
        if (!consumed.rowCount) inviteInvalid();
        response = { workspace: workspace(w, userId) }; kind = 'member.joined'; entityId = userId; details = { inviteId: invite.id, role: 'member' };
      } else if (route.kind === 'remove') {
        if (route.userId === w.owner_id) fail(403, 'OWNER_PROTECTED', 'The workspace owner cannot be removed.');
        const member = await c.query('SELECT 1 FROM ws_members WHERE workspace_id=$1 AND user_id=$2', [w.id, route.userId]);
        if (!member.rowCount) fail(404, 'MEMBER_NOT_FOUND', 'Member is not available.');
        const cleared = await c.query(`UPDATE ws_tasks SET assignee_id=NULL,version=version+1
          WHERE workspace_id=$1 AND assignee_id=$2 RETURNING id, version`, [w.id, route.userId]);
        await c.query('DELETE FROM ws_members WHERE workspace_id=$1 AND user_id=$2', [w.id, route.userId]);
        response = { ok: true }; kind = 'member.removed'; entityId = route.userId; details = { unassignedTasks: cleared.rows };
      }
      await audit(c, w.id, userId, input.commandId, kind, entityId, details);
      await c.query(`INSERT INTO ws_commands (user_id,command_id,workspace_id,request_hash,response,http_status)
        VALUES ($1,$2,$3,$4,$5,$6)`, [userId, input.commandId, w.id, requestHash, response, code]);
      return { status: code, body: await presentResponse(c, route.kind, response) };
    });
  }

  async function readSnapshot(userId, workspaceId, after = null) {
    return transaction(async (c) => {
      await profile(c, userId);
      const w = await guard(c, workspaceId, userId);
      // Even unchanged polls recheck membership under the shared workspace lock.
      // Hold that same lock while loading a changed snapshot to avoid a TOCTOU gap.
      if (after !== null) {
        if (BigInt(after) > BigInt(w.seq)) fail(409, 'CURSOR_AHEAD', 'Event cursor is ahead of this workspace. Refetch its snapshot.');
        if (BigInt(after) === BigInt(w.seq)) return null;
      }
      return snapshot(c, w, userId);
    });
  }
  async function stream(req, res, userId, route, cursor) {
    if (streams.size >= LIMITS.streams || [...streams.values()].filter((s) => s.userId === userId).length >= LIMITS.streamsPerUser) fail(429, 'STREAM_LIMIT', 'Too many workspace streams.');
    let stopped = false, timer, life, last = cursor;
    const stop = (code) => {
      if (stopped) return;
      stopped = true; clearTimeout(timer); clearTimeout(life); streams.delete(res); res.off('close', disconnect);
      if (!res.destroyed && !res.writableEnded) {
        if (code && !res.writableNeedDrain) res.write(`event: workspace-error\ndata: ${JSON.stringify({ code })}\n\n`);
        if (res.writableNeedDrain) res.destroy(); else res.end();
      }
    };
    const disconnect = () => stop();
    streams.set(res, { userId, stop }); res.once('close', disconnect);
    try {
      const first = await readSnapshot(userId, route.workspaceId, last);
      if (stopped || closed || res.destroyed) { stop(); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      res.flushHeaders();
      // A slow reader gets no subsequent snapshots until its buffer drains.
      const write = (value) => new Promise((resolve) => {
        if (stopped || res.destroyed || res.write(value)) { resolve(); return; }
        const timeout = setTimeout(() => { res.destroy(); stop(); }, 15_000);
        const done = () => { clearTimeout(timeout); res.off('drain', done); res.off('close', done); resolve(); };
        res.once('drain', done); res.once('close', done);
      });
      const send = async (value) => {
        if (value !== null) {
          last = value.seq;
          await write(`id: ${value.seq}\nevent: state\ndata: ${JSON.stringify(value)}\n\n`);
        } else await write(': heartbeat\n\n');
      };
      const poll = async () => {
        try {
          if (await identity(req) !== userId) fail(401, 'SESSION_REQUIRED', 'Session changed.');
          const value = await readSnapshot(userId, route.workspaceId, last);
          if (!stopped) await send(value);
        } catch (error) { stop(error instanceof WorkspaceError ? error.code : 'WORKSPACES_UNAVAILABLE'); }
        if (!stopped) timer = setTimeout(poll, LIMITS.pollMs);
      };
      life = setTimeout(() => stop(), 300_000);
      await send(first);
      if (!stopped) timer = setTimeout(poll, LIMITS.pollMs);
    } catch (error) {
      // Before headers, let the HTTP handler return the proper status.
      streams.delete(res); res.off('close', disconnect); clearTimeout(timer); clearTimeout(life);
      throw error;
    }
  }

  async function handle(req, res) {
    let url;
    try { url = new URL(req.url || '/', 'http://workspaces.invalid'); } catch { return false; }
    if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) return false;
    try {
      if ((req.url || '').split('?')[0] !== url.pathname || req.url.includes('#')) invalid();
      const route = routeFor(url.pathname, req.method);
      if (!route) fail(404, 'NOT_FOUND', 'Workspace endpoint is not available.');
      if (!route.methods.includes(req.method)) { res.setHeader('Allow', route.methods.join(', ')); fail(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.'); }
      let cursor = null;
      if (route.kind === 'events') {
        if ([...url.searchParams.keys()].some((k) => k !== 'after') || url.searchParams.getAll('after').length > 1) invalid();
        const values = [url.searchParams.get('after'), req.headers['last-event-id']].filter((v) => v !== null && v !== undefined);
        if (values.some((v) => typeof v !== 'string' || !/^(0|[1-9]\d{0,18})$/.test(v) || BigInt(v) > 9223372036854775807n)) invalid();
        if (values.length) cursor = values.reduce((a, b) => BigInt(a) > BigInt(b) ? a : b);
      } else if (url.search) invalid();
      if (route.kind === 'status') { json(res, 200, status()); return true; }
      if (closed || !pool) throw unavailable();
      const origin = req.headers.origin, site = req.headers['sec-fetch-site'];
      if ((origin !== undefined && origin !== config.origin) || (req.method !== 'GET' && origin !== config.origin)
        || (site && !['same-origin', 'none'].includes(site))) fail(403, 'INVALID_ORIGIN', 'A same-origin request is required.');
      if (['x-compass-tenant-id', 'x-compass-user-id', 'x-tenant-id', 'x-user-id'].some((k) => req.headers[k] !== undefined)) invalid();
      const userId = await identity(req);
      await ready();
      if (route.kind === 'list') {
        const result = await transaction(async (c) => {
          await profile(c, userId);
          const rows = await c.query(`SELECT w.*,w.deadline::text AS deadline FROM ws_workspaces w
            JOIN ws_members m ON m.workspace_id=w.id WHERE m.user_id=$1 ORDER BY w.created_at,w.id`, [userId]);
          return { workspaces: rows.rows.map((w) => workspace(w, userId)) };
        });
        json(res, 200, result);
      } else if (route.kind === 'snapshot') json(res, 200, await readSnapshot(userId, route.workspaceId));
      else if (route.kind === 'events') await stream(req, res, userId, route, cursor);
      else {
        const body = await readBody(req);
        // A slow upload must not retain authority from an expired session.
        if (await identity(req) !== userId) fail(401, 'SESSION_REQUIRED', 'Session changed.');
        const result = await mutate(route, req.method, url.pathname, body, userId);
        if (!res.destroyed) json(res, result.status, result.body);
      }
    } catch (error) {
      const safe = error instanceof WorkspaceError ? error : unavailable();
      if (!(error instanceof WorkspaceError)) database = 'unavailable';
      if (!res.destroyed && !res.headersSent) json(res, safe.status, { error: safe.message, code: safe.code });
      else if (!res.destroyed) res.end();
    }
    return true;
  }
  function close() {
    if (!closing) {
      closed = true;
      for (const s of streams.values()) s.stop();
      closing = (async () => { await initialization?.catch(() => {}); await pool?.end(); })();
    }
    return closing;
  }
  return Object.freeze({ handle, close, status });
}
