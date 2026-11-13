// Explicit, bounded device storage. No network, accounts, or automatic persistence.
export const STORAGE_KEY = 'compass.projects.v1'
export const MAX_PROJECTS = 6
export const MAX_REVISIONS = 8
export const MAX_HTML = 160000
export const MAX_STORAGE_CHARS = 1250000
const MAX_PROJECT_CHARS = 400000
const FIELDS = ['business','kind','audience','tone','theme','accent','font','hero','density','mobile','sections','headline','subhead','cta','lang']
const ENUMS = { theme:['light','dark'], accent:['gold','emerald','coral','sky','violet','rose','amber','slate'], font:['serif','sans','display'], hero:['centered','split','poster'], density:['balanced','airy','compact'], mobile:['standard','comfortable'] }
const SECTIONS = ['features','products','gallery','testimonials','pricing','faq','contact','signup']
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
const clean = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max) : ''
const integer = value => Number.isInteger(value) && value >= 0 && value <= 100000 ? value : 0
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null
const copy = value => JSON.parse(JSON.stringify(value))
const makeId = prefix => prefix + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2))

export function normalizeSavedIntent(value) {
  if (!plain(value)) return null
  const out = {}
  for (const field of FIELDS) {
    const item = value[field]
    if (item == null) continue
    if (field === 'sections') {
      if (!Array.isArray(item) || item.length > 8 || item.some(section => !SECTIONS.includes(section))) return null
      out.sections = [...new Set(item)]
    } else if (ENUMS[field]) {
      if (!ENUMS[field].includes(item)) return null
      out[field] = item
    } else if (field === 'lang') {
      if (typeof item !== 'string' || !/^[a-z]{2}$/.test(item)) return null
      out.lang = item
    } else {
      if (typeof item !== 'string' || item.length > 140) return null
      const text = clean(item,140)
      if (text) out[field] = text
    }
  }
  return out.kind || out.business ? out : null
}

// Stored documents originate in the scriptless server renderer. Reject active or
// remotely loaded content rather than importing arbitrary HTML from local storage.
export function safeSavedHtml(value) {
  if (typeof value !== 'string' || value.length > MAX_HTML || !/^<!doctype html>/i.test(value.trim())) return null
  if (/<\s*(?:script|iframe|object|embed|base|link)\b/i.test(value)
    || /(?:\s|\/)on[a-z]+\s*=/i.test(value)
    || /(?:javascript:|vbscript:|@import|url\s*\(|http-equiv\s*=)/i.test(value)
    || /(?:\s|\/)(?:src|srcset|poster|background|action|formaction|ping)\s*=/i.test(value)) return null
  for (const style of value.matchAll(/<style\b[^>]*>([\s\S]*?)(?:<\/style\s*>|$)/gi)) {
    if (/[\\]|https?:|image-set\s*\(|expression\s*\(|-moz-binding|(?:^|[;{])\s*behavior\s*:/i.test(style[1])) return null
  }
  for (const style of value.matchAll(/(?:\s|\/)style\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    if (/[\\&]|https?:|image-set\s*\(|expression\s*\(|-moz-binding|(?:^|[;{])\s*behavior\s*:/i.test(style[1] ?? style[2] ?? style[3] ?? '')) return null
  }
  // Rendered previews use fragment anchors only. An exported document loses
  // the iframe sandbox, so reject encoded protocol tricks and external links.
  for (const link of value.matchAll(/(?:\s|\/)(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    if (!/^#[A-Za-z][A-Za-z0-9_-]*$/.test(link[1] ?? link[2] ?? link[3] ?? '')) return null
  }
  return value
}

export function normalizeRevision(value) {
  if (!plain(value) || !validId(value.id)) return null
  const intent = normalizeSavedIntent(value.plan?.intent)
  const html = safeSavedHtml(value.render?.html)?.replace(/ data-new(?=[\s=>])/g,'')
  const version = integer(value.render?.version)
  const at = date(value.at)
  if (!intent || !html || !version || version !== value.plan?.version || !at) return null
  return {
    id:value.id, at, prompt:clean(value.prompt,500), number:integer(value.number) || 1,
    plan:{intent,version}, render:{html,version,pending:[]},
    source:value.source === 'model' ? 'model' : 'prepared', placeholder:Boolean(value.placeholder),
  }
}

export function completedRevision(state, prompt = '', { now = () => new Date().toISOString(), id = () => makeId('r_') } = {}) {
  if (state.busy || !state.render?.html || state.render.pending?.length || state.plan?.version !== state.render.version) return null
  return normalizeRevision({
    id:id(), at:now(), prompt, number:1, plan:state.plan, render:state.render,
    source:state.source, placeholder:state.placeholder,
  })
}

export function appendRevision(history, revision) {
  const current = Array.isArray(history) ? history : []
  if (!revision) return current
  const last = current.at(-1)
  if (last && last.render.html === revision.render.html && JSON.stringify(last.plan.intent) === JSON.stringify(revision.plan.intent)) return current
  const next = [...current,{...revision,number:(last?.number || 0) + 1}].slice(-MAX_REVISIONS)
  while (next.length > 1 && JSON.stringify(next).length > MAX_PROJECT_CHARS - 1024) next.shift()
  return next
}

export function normalizeProject(value) {
  if (!plain(value) || !validId(value.id) || !Array.isArray(value.revisions) || !value.revisions.length || value.revisions.length > MAX_REVISIONS) return null
  const name = clean(value.name,64)
  const createdAt = date(value.createdAt)
  const updatedAt = date(value.updatedAt)
  const revisions = value.revisions.map(normalizeRevision)
  if (!name || !createdAt || !updatedAt || revisions.some(item => !item) || new Set(revisions.map(item => item.id)).size !== revisions.length) return null
  const out = {id:value.id,name,createdAt,updatedAt,revisions}
  return JSON.stringify(out).length <= MAX_PROJECT_CHARS ? out : null
}

export function restoredProject(project) {
  const valid = normalizeProject(project)
  if (!valid) return null
  const latest = valid.revisions.at(-1)
  // A local document is visible immediately. Its next turn starts a fresh
  // server session from validated intent, never from saved HTML or actions.
  return {
    projectId:valid.id, name:valid.name, history:copy(valid.revisions),
    sessionId:'', plan:{intent:copy(latest.plan.intent),version:0,patch:[]},
    render:{html:latest.render.html,version:0,pending:[],key:1},
    source:'saved', placeholder:latest.placeholder, resumeIntent:copy(latest.plan.intent),
  }
}

export function createProjectStore({ storage, now = () => new Date().toISOString(), id = () => makeId('p_') } = {}) {
  let target
  try { target = storage === undefined ? globalThis.localStorage : storage } catch {}
  function read() {
    if (!target?.getItem || !target?.setItem) return {ok:false,error:'unavailable',projects:[]}
    let raw
    try { raw = target.getItem(STORAGE_KEY) } catch { return {ok:false,error:'unavailable',projects:[]} }
    if (!raw) return {ok:true,projects:[]}
    if (raw.length > MAX_STORAGE_CHARS) return {ok:false,error:'corrupt',projects:[]}
    let parsed
    try { parsed = JSON.parse(raw) } catch { return {ok:false,error:'corrupt',projects:[]} }
    if (!plain(parsed) || parsed.schema !== 1 || !Array.isArray(parsed.projects) || parsed.projects.length > MAX_PROJECTS) return {ok:false,error:'corrupt',projects:[]}
    const projects = parsed.projects.map(normalizeProject)
    if (projects.some(item => !item) || new Set(projects.map(item => item.id)).size !== projects.length) return {ok:false,error:'corrupt',projects:[]}
    return {ok:true,projects}
  }
  function write(projects) {
    const raw = JSON.stringify({schema:1,projects})
    if (raw.length > MAX_STORAGE_CHARS) return {ok:false,error:'full'}
    try { target.setItem(STORAGE_KEY,raw); return {ok:true,projects} }
    catch { return {ok:false,error:'quota'} }
  }
  function save({projectId = null,name,revisions}) {
    const result = read()
    if (!result.ok) return result
    const existing = projectId ? result.projects.find(item => item.id === projectId) : null
    if (projectId && !existing) return {ok:false,error:'missing'}
    if (!existing && result.projects.length >= MAX_PROJECTS) return {ok:false,error:'full'}
    const stamp = now()
    const project = normalizeProject({id:existing?.id || id(),name,createdAt:existing?.createdAt || stamp,updatedAt:stamp,revisions})
    if (!project) return {ok:false,error:'invalid'}
    const projects = [project,...result.projects.filter(item => item.id !== project.id)]
    const written = write(projects)
    return written.ok ? {...written,project} : written
  }
  function remove(projectId) {
    const result = read()
    if (!result.ok) return result
    if (!result.projects.some(item => item.id === projectId)) return {ok:false,error:'missing'}
    return write(result.projects.filter(item => item.id !== projectId))
  }
  return {read,save,remove}
}
