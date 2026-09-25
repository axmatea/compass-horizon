// Mutable-intent state. Pure functions only: every update returns a new state.
//
// State shape (served to the frontend as-is):
// {
//   sessionId, version, status: 'idle'|'thinking'|'acting'|'ready'|'error',
//   intent: { task, date, time, location, cuisine, party_size },   // null = unknown
//   actions: [{ id, tool, args, dependsOn[], status, basedOnVersion, result?, error?, invalidatedBy? }],
//   history: [{ version, turnId, text, patch }],
//   updatedAt
// }
//
// Patch shape (per COMPASS_MASTER contract): [{ field, from, to, status, change? }]
//   status 'active' -> field changed in this turn (from = superseded value)
//          'kept'   -> field unchanged and still valid
//   change 'added' | 'updated' | 'removed' (only for status 'active')

export const FIELDS = Object.freeze(['task', 'date', 'time', 'location', 'cuisine', 'party_size']);
export const ACTION_LIVE = Object.freeze(['pending', 'running', 'done']);
const MAX_LEN = 120;

export function createState(sessionId) {
  return {
    sessionId,
    version: 0,
    status: 'idle',
    intent: Object.fromEntries(FIELDS.map((f) => [f, null])),
    actions: [],
    history: [],
    updatedAt: new Date().toISOString(),
  };
}

// ---------- normalization ----------

const EVENING = /dinner|supper|evening|drinks|night|date/i;

/**
 * Normalize to 24h "HH:MM". Bare hours 1-11 ("7", "7:30") for evening tasks resolve to PM.
 * A zero-padded 24h value ("08:00") is already unambiguous and is never shifted:
 * the interpreter emits it when the user said "8 in the morning".
 */
export function normalizeTime(raw, { task } = {}) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase().replace(/\./g, '');
  if (s === 'noon') return '12:00';
  if (s === 'midnight') return '00:00';
  const m = /^(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?(?:\s*o'?clock)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const mer = m[3]?.[0];
  if (h > 23 || min > 59) return null;
  if (mer === 'p' && h < 12) h += 12;
  else if (mer === 'a' && h === 12) h = 0;
  else if (!mer && h >= 1 && h <= 11 && !/^0\d/.test(m[1]) && EVENING.test(task || '')) h += 12;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function clean(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/\s+/g, ' ').trim().slice(0, MAX_LEN);
  return s || null;
}

export function normalizeLocation(raw) {
  let s = clean(raw);
  if (!s) return null;
  s = s.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(somewhere\s+)?(near|around|in|close to|by)\s+/i, '')
    .replace(/,\s*(CA|California|USA|US)\.?$/i, '')
    .trim();
  return s || null;
}

const titleCase = (s) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());

export function normalizeField(field, raw, intent = {}) {
  switch (field) {
    case 'time': return normalizeTime(raw, { task: intent.task });
    case 'location': return normalizeLocation(raw);
    case 'cuisine': { const s = clean(raw); return s ? titleCase(s.toLowerCase()) : null; }
    case 'task': { const s = clean(raw); return s ? s.toLowerCase() : null; }
    case 'date': { const s = clean(raw); return s ? s.toLowerCase() : null; }
    case 'party_size': { const n = Number.parseInt(raw, 10); return Number.isInteger(n) && n > 0 && n < 100 ? n : null; }
    default: return undefined;
  }
}

// ---------- patching ----------

/**
 * Apply a model-proposed update. Only fields explicitly present in `set`/`unset`
 * can change; everything else is kept. Unknown fields and unparseable values are
 * rejected (reported in `rejected`), never silently written.
 */
export function applyUpdate(state, { set = {}, unset = [] } = {}, meta = {}) {
  const next = structuredClone(state);
  const changed = [];
  const rejected = [];
  const before = state.intent;

  // task first so time normalization can use the new task
  const ordered = Object.keys(set).sort((a, b) => (a === 'task' ? -1 : b === 'task' ? 1 : 0));
  for (const field of ordered) {
    if (!FIELDS.includes(field)) { rejected.push({ field, reason: 'unknown_field' }); continue; }
    const raw = set[field];
    if (raw == null || raw === '') { if (before[field] != null) { next.intent[field] = null; changed.push(field); } continue; }
    const value = normalizeField(field, raw, next.intent);
    if (value == null) { rejected.push({ field, value: String(raw).slice(0, 40), reason: 'invalid_value' }); continue; }
    if (value !== before[field]) { next.intent[field] = value; changed.push(field); }
  }
  for (const field of unset) {
    if (!FIELDS.includes(field)) { rejected.push({ field, reason: 'unknown_field' }); continue; }
    if (before[field] != null && !changed.includes(field)) { next.intent[field] = null; changed.push(field); }
  }

  const patch = FIELDS.flatMap((field) => {
    const from = before[field];
    const to = next.intent[field];
    if (changed.includes(field)) {
      const change = from == null ? 'added' : to == null ? 'removed' : 'updated';
      return [{ field, from, to, status: 'active', change }];
    }
    return to != null ? [{ field, from: to, to, status: 'kept' }] : [];
  });

  if (changed.length) {
    next.version = state.version + 1;
    next.updatedAt = new Date().toISOString();
  }
  next.history.push({ version: next.version, turnId: meta.turnId ?? null, text: meta.text ?? null, patch: patch.filter((p) => p.status === 'active') });
  return { state: next, patch, changed, rejected };
}

// ---------- actions ----------

export function addAction(state, { id, tool, args, dependsOn }) {
  const next = structuredClone(state);
  next.actions.push({ id, tool, args, dependsOn: [...dependsOn], status: 'pending', basedOnVersion: state.version });
  return next;
}

export function updateAction(state, id, fields) {
  const next = structuredClone(state);
  const a = next.actions.find((x) => x.id === id);
  if (a) Object.assign(a, fields);
  return next;
}

/** Invalidate every live action that depends on a changed field. */
export function invalidateActions(state, changedFields, { version } = {}) {
  const next = structuredClone(state);
  const invalidated = [];
  for (const a of next.actions) {
    if (!ACTION_LIVE.includes(a.status)) continue;
    const hit = a.dependsOn.filter((f) => changedFields.includes(f));
    if (!hit.length) continue;
    invalidated.push({ id: a.id, tool: a.tool, previousStatus: a.status, changedFields: hit });
    a.status = 'invalidated';
    a.invalidatedBy = { version: version ?? next.version, fields: hit };
  }
  return { state: next, invalidated };
}

/** A live action is reusable if nothing it depends on changed since it was planned. */
export function findReusableAction(state, tool, args) {
  const key = JSON.stringify(args);
  return state.actions.find((a) => a.tool === tool && ACTION_LIVE.includes(a.status) && JSON.stringify(a.args) === key) || null;
}
