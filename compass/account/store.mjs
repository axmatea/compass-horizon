import { randomUUID, createHash } from 'node:crypto';
import { normalizeProject } from '../src/builder/project-store.mjs';
import { normalizePreferences, PROJECT_TYPES, VISUAL_DIRECTIONS } from '../src/create/draft.mjs';

export class AccountDataError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const reject = (status, code) => { throw new AccountDataError(status, code); };
const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id);

// The initial staging store uses the SAME isolated SQLite database as identity.
// Every lookup includes the verified owner. No client owner field is accepted.
export function createAccountStore(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS compass_profile (owner TEXT PRIMARY KEY, preferences TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS compass_project (id TEXT PRIMARY KEY, owner TEXT NOT NULL, document TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS compass_project_owner ON compass_project(owner, updated_at);
    CREATE TABLE IF NOT EXISTS compass_operation (id TEXT PRIMARY KEY, owner TEXT NOT NULL, request_key TEXT NOT NULL, request_hash TEXT NOT NULL,
      status TEXT NOT NULL, result TEXT, created_at TEXT NOT NULL, UNIQUE(owner, request_key));
    CREATE TABLE IF NOT EXISTS compass_usage (id TEXT PRIMARY KEY, operation_id TEXT NOT NULL, owner TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS compass_usage_owner ON compass_usage(owner, created_at);
  `);
  const stamp = () => new Date().toISOString();
  function prune() {
    // Operational preview retention, not a financial ledger retention policy.
    // Exact build receipts remain retryable for 24 hours; model receipts for 7 days.
    const cutoff = new Date(Date.now()-86400000).toISOString();
    database.prepare('DELETE FROM compass_operation WHERE created_at < ?').run(cutoff);
    database.prepare('DELETE FROM compass_usage WHERE created_at < ?').run(new Date(Date.now()-7*86400000).toISOString());
  }
  prune();
  function profile(owner) {
    const row = database.prepare('SELECT preferences FROM compass_profile WHERE owner = ?').get(owner);
    return { preferences: row ? JSON.parse(row.preferences) : {} };
  }
  function saveProfile(owner, value) {
    const prefs = value?.preferences;
    if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)
      || Object.keys(prefs).some(key => !['projectType', 'visualDirection'].includes(key))
      || (prefs.projectType !== undefined && !PROJECT_TYPES.includes(prefs.projectType))
      || (prefs.visualDirection !== undefined && !VISUAL_DIRECTIONS.includes(prefs.visualDirection))) reject(400, 'invalid_preferences');
    const preferences = normalizePreferences(prefs);
    database.prepare('INSERT INTO compass_profile(owner, preferences, updated_at) VALUES (?, ?, ?) ON CONFLICT(owner) DO UPDATE SET preferences=excluded.preferences, updated_at=excluded.updated_at')
      .run(owner, JSON.stringify(preferences), stamp());
    return { preferences };
  }
  function listProjects(owner) {
    return database.prepare('SELECT document FROM compass_project WHERE owner = ? ORDER BY updated_at DESC LIMIT 20').all(owner)
      .map(row => { const p = JSON.parse(row.document); return { id:p.id, name:p.name, updatedAt:p.updatedAt, revisions:p.revisions.length }; });
  }
  function getProject(owner, id) {
    if (!validId(id)) reject(404, 'not_found');
    const row = database.prepare('SELECT document FROM compass_project WHERE id = ? AND owner = ?').get(id, owner);
    if (!row) reject(404, 'not_found');
    return JSON.parse(row.document);
  }
  function saveProject(owner, input) {
    // New/imported projects always get a server-generated id. Updating another
    // owner's id returns the same 404 as a missing project.
    const existing = input?.projectId ? getProject(owner, input.projectId) : null;
    const id = existing?.id || 'p_' + randomUUID();
    if (!existing && database.prepare('SELECT count(*) AS n FROM compass_project WHERE owner = ?').get(owner).n >= 20) reject(409, 'project_limit');
    const at = stamp();
    const project = normalizeProject({ id, name:input?.name, revisions:input?.revisions, createdAt:existing?.createdAt || at, updatedAt:at });
    if (!project) reject(400, 'invalid_project');
    database.prepare('INSERT INTO compass_project(id, owner, document, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET document=excluded.document, updated_at=excluded.updated_at WHERE compass_project.owner=excluded.owner')
      .run(id, owner, JSON.stringify(project), at);
    return project;
  }
  function deleteProject(owner, id) {
    getProject(owner, id);
    database.prepare('DELETE FROM compass_project WHERE id = ? AND owner = ?').run(id, owner);
  }
  function beginOperation(owner, key, input) {
    prune();
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(key)) reject(400, 'idempotency_key_required');
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const previous = database.prepare('SELECT * FROM compass_operation WHERE owner = ? AND request_key = ?').get(owner, key);
    if (previous) {
      if (previous.request_hash !== hash) reject(409, 'idempotency_conflict');
      if (previous.status === 'succeeded') return { replay:true, result:JSON.parse(previous.result) };
      reject(previous.status === 'running' ? 409 : 503, previous.status === 'running' ? 'build_in_progress' : 'previous_build_failed');
    }
    const total = database.prepare('SELECT count(*) AS n FROM compass_operation WHERE owner = ? AND created_at > ?').get(owner, new Date(Date.now() - 3600000).toISOString()).n;
    if (total >= 30) reject(429, 'account_rate_limit');
    const id = 'op_' + randomUUID();
    database.prepare('INSERT INTO compass_operation(id, owner, request_key, request_hash, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, owner, key, hash, 'running', stamp());
    return { id, replay:false };
  }
  function finishOperation(owner, id, result) {
    const json = JSON.stringify(result);
    if (json.length > 400000) reject(500, 'result_too_large');
    database.prepare("UPDATE compass_operation SET status='succeeded', result=? WHERE id=? AND owner=? AND status='running'").run(json, id, owner);
  }
  function failOperation(owner, id) {
    database.prepare("UPDATE compass_operation SET status='failed' WHERE id=? AND owner=? AND status='running'").run(id, owner);
  }
  function recordUsage(owner, operationId, event) {
    const operation = database.prepare('SELECT id FROM compass_operation WHERE id=? AND owner=?').get(operationId, owner);
    if (!operation || !validId(event?.id)) reject(400, 'invalid_usage');
    database.prepare('INSERT INTO compass_usage(id, operation_id, owner, details, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
      .run(event.id, operationId, owner, JSON.stringify(event), stamp());
  }
  function usage(owner) {
    const operations = database.prepare('SELECT status, count(*) AS count FROM compass_operation WHERE owner=? GROUP BY status').all(owner);
    const attempts = database.prepare('SELECT details, created_at FROM compass_usage WHERE owner=? ORDER BY created_at DESC LIMIT 100').all(owner)
      .map(row => ({...JSON.parse(row.details), at:row.created_at}));
    return { billingEnabled:false, creditsEnabled:false, currencyCost:null, operations, attempts };
  }
  return { profile, saveProfile, listProjects, getProject, saveProject, deleteProject, beginOperation, finishOperation, failOperation, recordUsage, usage };
}
