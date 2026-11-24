import {randomUUID} from 'node:crypto';

const noteKeys = ['goal', 'architecture', 'preferences', 'dependencies', 'problems'];
const taskStatuses = ['active', 'done', 'cancelled'];
const capacity = 20;
const fail = (status, code) => { throw Object.assign(new Error(code), {status, code}); };
const emptyNotes = () => Object.fromEntries(noteKeys.map(key => [key, '']));

function boundedText(value, limit, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > limit ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ||
      (!allowEmpty && !value.trim())) fail(400, 'invalid_project_context');
  return value.trim();
}

function retainWithinLimit(entries, canArchive) {
  if (entries.length <= capacity) return entries;
  const oldest = entries.findIndex(canArchive);
  if (oldest < 0) fail(409, 'project_context_limit');
  return entries.filter((_, index) => index !== oldest);
}

// Model inputs contain active, user-entered planning context only. Superseded
// decisions, inactive tasks, saved records and raw revision prompts stay private.
export function activeProjectContext(context) {
  if (!context) return null;
  const notes = Object.fromEntries(noteKeys.filter(key => context.notes[key]).map(key => [key, context.notes[key]]));
  const decisions = context.decisions.filter(entry => !entry.supersededBy).map(entry => entry.text);
  const tasks = context.tasks.filter(entry => entry.status === 'active').map(entry => entry.text);
  return Object.keys(notes).length || decisions.length || tasks.length ? {notes, decisions, tasks} : null;
}

export function createProjectContextStore(database, {getApplication, atomic}) {
  database.exec(`CREATE TABLE IF NOT EXISTS compass_application_context (
    app_id TEXT NOT NULL, owner TEXT NOT NULL, version INTEGER NOT NULL, context TEXT NOT NULL,
    PRIMARY KEY(app_id, owner)
  )`);
  const select = database.prepare('SELECT version,context FROM compass_application_context WHERE app_id=? AND owner=?');
  const upsert = database.prepare(`INSERT INTO compass_application_context(app_id,owner,version,context) VALUES(?,?,?,?)
    ON CONFLICT(app_id,owner) DO UPDATE SET version=excluded.version,context=excluded.context`);
  const remove = database.prepare('DELETE FROM compass_application_context WHERE app_id=? AND owner=?');
  const recent = database.prepare(`SELECT version,prompt,created_at AS createdAt
    FROM compass_application_revision WHERE app_id=? ORDER BY version DESC LIMIT 5`);

  function get(owner, appId) {
    getApplication(owner, appId);
    const row = select.get(appId, owner);
    return row ? {version: row.version, ...JSON.parse(row.context)}
      : {version: 0, notes: emptyNotes(), decisions: [], tasks: []};
  }
  function view(owner, appId) {
    return {...get(owner, appId), recentChanges: recent.all(appId)};
  }
  function assertVersion(owner, appId, version) {
    getApplication(owner, appId);
    if ((select.get(appId, owner)?.version ?? 0) !== version) fail(409, 'project_context_conflict');
  }
  function update(owner, appId, version, edit) {
    if (!Number.isSafeInteger(version) || version < 0) fail(400, 'invalid_context_version');
    return atomic(() => {
      const current = get(owner, appId);
      if (current.version !== version) fail(409, 'project_context_conflict');
      const previous = JSON.stringify({notes:current.notes, decisions:current.decisions, tasks:current.tasks});
      const {notes, decisions, tasks} = edit(current);
      const next = JSON.stringify({notes, decisions, tasks});
      if (next !== previous) upsert.run(appId, owner, version + 1, next);
      return view(owner, appId);
    });
  }
  function saveNotes(owner, appId, version, notes) {
    if (!notes || typeof notes !== 'object' || Array.isArray(notes) ||
        Object.keys(notes).length !== noteKeys.length || !noteKeys.every(key => Object.hasOwn(notes,key))) {
      fail(400, 'invalid_project_context');
    }
    const normalized = Object.fromEntries(noteKeys.map(key => [key, boundedText(notes[key], 300, true)]));
    return update(owner, appId, version, current => ({...current, notes: normalized}));
  }
  function record(owner, appId, input) {
    return update(owner, appId, input.version, current => {
      const {action, id, text, status} = input;
      if (action === 'decision' || action === 'supersede') {
        const item = {id:randomUUID(), text:boundedText(text,220), createdAt:new Date().toISOString(), supersededBy:null};
        if (action === 'supersede') {
          const old = current.decisions.find(entry => entry.id === id);
          if (!old || old.supersededBy) fail(409, 'decision_unavailable');
          old.supersededBy = item.id;
        }
        current.decisions = retainWithinLimit([...current.decisions, item], entry => entry.supersededBy);
      } else if (action === 'task') {
        const item = {id:randomUUID(), text:boundedText(text,220), status:'active'};
        current.tasks = retainWithinLimit([...current.tasks,item], entry => entry.status !== 'active');
      } else if (action === 'task-status') {
        if (!taskStatuses.includes(status)) fail(400, 'invalid_project_context');
        const task = current.tasks.find(entry => entry.id === id);
        if (!task) fail(404, 'task_not_found');
        task.status = status;
      } else {
        fail(400, 'invalid_project_context');
      }
      return current;
    });
  }
  return {get, view, assertVersion, saveNotes, record, remove:(owner, appId) => remove.run(appId, owner)};
}
