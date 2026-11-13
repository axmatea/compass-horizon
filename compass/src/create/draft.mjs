// A short-lived, tab-local handoff. Never put prompts in URLs or auth callbacks.
export const DRAFT_KEY = 'compass.create-draft.v1'
export const DRAFT_TTL = 30 * 60 * 1000
export const MAX_PROMPT = 500
export const PROJECT_TYPES = ['website','saas','internal-tool','client-portal','other']
export const VISUAL_DIRECTIONS = ['minimal','editorial','bold','professional','custom']
export const EXPERIENCE_LEVELS = ['beginner','designer','developer','founder']
export const INTENDED_USES = ['personal','startup','agency','business']
export const WORKSPACE_LAYOUTS = ['balanced','preview','conversation']
export const PREFERENCE_OPTIONS = {projectType:PROJECT_TYPES,visualDirection:VISUAL_DIRECTIONS,
  experience:EXPERIENCE_LEVELS,intendedUse:INTENDED_USES,workspaceLayout:WORKSPACE_LAYOUTS}
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
const validOwner = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value)
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value)
const getStorage = storage => {
  if (storage !== undefined) return storage
  try { return globalThis.sessionStorage } catch { return null }
}

export function validPrompt(value) {
  return typeof value === 'string' && value.trim().length >= 3 && value.length <= MAX_PROMPT
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
}

export function normalizePreferences(value) {
  const out = {}
  if (!plain(value)) return out
  for (const [field,choices] of Object.entries(PREFERENCE_OPTIONS)) if (choices.includes(value[field])) out[field] = value[field]
  return out
}

function normalizeDraft(value, now) {
  if (!plain(value) || value.schema !== 1 || !validId(value.id) || !validPrompt(value.prompt)) return null
  if (!Number.isSafeInteger(value.createdAt) || !Number.isSafeInteger(value.expiresAt)
    || value.createdAt > now || value.expiresAt <= now
    || value.expiresAt - value.createdAt !== DRAFT_TTL) return null
  if(value.ownerId !== undefined && !validOwner(value.ownerId))return null
  return {schema:1,...(value.ownerId === undefined ? {} : {ownerId:value.ownerId}),id:value.id,prompt:value.prompt,createdAt:value.createdAt,expiresAt:value.expiresAt,
    preferences:normalizePreferences(value.preferences),ready:value.ready === true}
}

export function readDraft({storage,now = Date.now} = {}) {
  const target = getStorage(storage)
  let raw
  try { raw = target?.getItem(DRAFT_KEY) } catch { return null }
  if (!raw) return null
  let draft = null
  try {
    draft = raw.length <= 4096 ? normalizeDraft(JSON.parse(raw),now()) : null
  } catch { /* Invalid handoffs must not become a redirect or build seed. */ }
  if (!draft) try { target.removeItem(DRAFT_KEY) } catch {}
  return draft
}

export function writeDraft(value, {storage,now = Date.now,id = () => globalThis.crypto?.randomUUID?.() || `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`} = {}) {
  if (!plain(value) || !validPrompt(value.prompt)) return {ok:false,error:'invalid-prompt'}
  const target = getStorage(storage)
  if (!target?.getItem || !target?.setItem) return {ok:false,error:'storage-unavailable'}
  const at = now()
  const current = readDraft({storage:target,now:() => at})
  // Editing the prompt creates a different handoff id. A late build must never
  // clear a newer request. Preference edits retain the original lifetime.
  const previous = current?.prompt === value.prompt ? current : null
  const preferences = normalizePreferences(value.preferences ?? previous?.preferences)
  const ownerId=value.ownerId === null ? undefined : value.ownerId ?? previous?.ownerId
  const unchanged = previous && ownerId === previous.ownerId && JSON.stringify(preferences) === JSON.stringify(previous.preferences)
    && !(previous.ready && value.ready !== true)
  const draft = normalizeDraft({schema:1,id:unchanged ? previous.id : id(),prompt:value.prompt,
    createdAt:previous?.createdAt ?? at,expiresAt:previous?.expiresAt ?? at + DRAFT_TTL,
    preferences,ready:value.ready === true,...(ownerId === undefined ? {} : {ownerId})},at)
  if (!draft) return {ok:false,error:'invalid-draft'}
  try { target.setItem(DRAFT_KEY,JSON.stringify(draft)); return {ok:true,draft} }
  catch { return {ok:false,error:'storage-unavailable'} }
}

// This is a continuity check only. A private API still verifies the HttpOnly
// server session. Ownerless legacy/guest handoffs never autorun in an account.
export function draftCanAutoBuild(draft,{accountMode=false,userId=null}={}) {
  return draft?.ready === true && (accountMode
    ? validOwner(userId) && draft.ownerId === userId
    : draft.ownerId === undefined)
}

export function disarmDraft({id}={},options={}) {
  if(!validId(id))return {ok:false,error:'invalid-draft'}
  const current=readDraft(options)
  if(!current || current.id!==id)return {ok:false,error:'draft-changed'}
  return writeDraft({...current,ready:false},options)
}

export function clearDraft({storage,id} = {}) {
  // A successful generation must present the exact handoff id it claimed.
  if (!validId(id)) return false
  const target = getStorage(storage)
  try {
    const raw = target?.getItem(DRAFT_KEY)
    if (!raw || raw.length > 4096 || JSON.parse(raw)?.id !== id) return false
    target.removeItem(DRAFT_KEY)
    return true
  } catch { return false }
}

// An overlay only: do not replace the business or domain inferred from the
// original prompt. Custom/skip make no design change.
export function onboardingIntent(preferences) {
  const {visualDirection} = normalizePreferences(preferences)
  return {
    minimal:{theme:'light',font:'sans',density:'airy',accent:'slate'},
    editorial:{theme:'light',font:'serif',hero:'split',density:'airy',accent:'slate'},
    bold:{font:'display',hero:'poster',density:'balanced',accent:'violet'},
    professional:{theme:'light',font:'sans',hero:'split',density:'balanced',accent:'slate'},
  }[visualDirection] || {}
}
