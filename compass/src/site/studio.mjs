// Homepage builder client rules. The page talks to the same /api/site/turn
// endpoint as /demo. Everything here is pure so it can run under node --test.

export const MAX_TEXT = 500

export const SECTION_NAMES = { hero: 'Hero', features: 'Features', products: 'Products', gallery: 'Gallery', testimonials: 'Testimonials', pricing: 'Pricing', faq: 'FAQ', contact: 'Contact', signup: 'Signup' }

export const BRIEF_FIELDS = [
  ['business', 'Name'], ['kind', 'What'], ['audience', 'For'], ['tone', 'Tone'], ['theme', 'Theme'],
  ['accent', 'Accent'], ['hero', 'Hero'], ['headline', 'Headline'], ['cta', 'Button'], ['sections', 'Sections'],
]

export const PHASE_LABELS = { idle: 'Ready', listening: 'Listening', thinking: 'Understanding', building: 'Building', replanning: 'Updating the brief', done: 'Up to date' }

export function createStudio() {
  return { sessionId: '', phase: 'idle', plan: null, actions: [], render: null, turns: 0, open: 0, source: '', placeholder: false, reply: '', limited: false }
}

const sectionName = section => SECTION_NAMES[section] || String(section)

function title(value) {
  return String(value ?? '').replace(/\b\p{L}+/gu, word => word.toLowerCase() === 'ai' ? 'AI' : word.charAt(0).toUpperCase() + word.slice(1))
}

function show(key, value) {
  return key === 'business' || key === 'headline' || key === 'cta' ? String(value) : title(value)
}

// `open` counts turns in flight. A turn that ends while a newer one is still
// being read must not report the page as finished.
export function settle(state) {
  if (state.actions.some(action => action.status === 'running')) return 'building'
  if (state.open > 1 && state.phase !== 'idle' && state.phase !== 'done') return state.phase
  return state.render ? 'done' : 'idle'
}

// A new turn with nothing in flight starts a fresh build log. A turn sent while
// another is running keeps the running step so the interruption stays visible.
export function beginTurn(state) {
  if (state.open === 0) state.actions = []
  state.turns += 1
  state.open += 1
  state.phase = 'thinking'
  return state
}

export function closeTurn(state) {
  state.open = Math.max(0, state.open - 1)
  if (state.open === 0) {
    state.actions = state.actions.map(action => action.status === 'running' ? { ...action, status: 'invalidated' } : action)
    state.phase = state.render ? 'done' : 'idle'
  }
  return state
}

// Applies one server event. Unknown events are ignored so a newer server cannot break the page.
export function applyEvent(state, event) {
  if (!event || typeof event !== 'object') return state
  if (typeof event.sessionId === 'string' && event.sessionId) state.sessionId = event.sessionId
  switch (event.type) {
    case 'reasoning_status':
      if (event.stage === 'interpreting') state.phase = 'thinking'
      break
    case 'state_patch': {
      state.plan = { intent: event.intent || {}, patch: Array.isArray(event.patch) ? event.patch : [], version: event.version || 1 }
      const revised = state.plan.patch.some(op => op.status === 'active' && op.change === 'updated')
      state.phase = revised ? 'replanning' : 'building'
      break
    }
    case 'tool_call':
      state.actions = [...state.actions.filter(action => action.id !== event.actionId), { id: event.actionId, tool: event.tool, status: 'running' }].slice(-3)
      state.phase = 'building'
      break
    case 'tool_result':
      state.actions = state.actions.map(action => action.id === event.actionId ? { ...action, status: 'done', result: event.result || {} } : action)
      break
    case 'action_invalidated':
      state.actions = state.actions.map(action => action.id === event.actionId ? { ...action, status: 'invalidated' } : action)
      break
    case 'render':
      if (typeof event.html === 'string' && event.html) {
        state.render = { html: event.html, version: event.version || 1, pending: Array.isArray(event.pending) ? event.pending : [], key: (state.render?.key || 0) + 1 }
        state.placeholder = Boolean(event.placeholder)
      }
      break
    case 'say':
      if (event.text) state.reply = String(event.text)
      break
    case 'done':
      state.phase = settle(state)
      break
    default:
  }
  return state
}

// Applies the final turn object: the `result` SSE frame, a JSON reply, or a 429 fallback.
export function applyResult(state, result, { replay = false } = {}) {
  if (!result || typeof result !== 'object') return state
  if (replay && Array.isArray(result.events)) for (const event of result.events) applyEvent(state, event)
  if (typeof result.sessionId === 'string' && result.sessionId) state.sessionId = result.sessionId
  if (result.intent && (!state.plan || (result.version || 0) >= (state.plan.version || 0))) {
    state.plan = { intent: result.intent, patch: Array.isArray(result.patch) ? result.patch : [], version: result.version || 1 }
  }
  if (typeof result.html === 'string' && result.html && (!state.render || (result.version || 0) >= state.render.version) && state.render?.html !== result.html) {
    state.render = { html: result.html, version: result.version || 1, pending: Array.isArray(result.pending) ? result.pending : [], key: (state.render?.key || 0) + 1 }
  }
  if (result.reply) state.reply = String(result.reply)
  if (result.html || result.intent) {
    state.source = result.source === 'model' ? 'model' : 'prepared'
    state.placeholder = Boolean(result.placeholder)
  }
  if (result.limited) state.limited = true
  state.phase = settle(state)
  return state
}

// Only a finished turn written by the model may be called live.
export function sourceLabel(state) {
  if (!state.render || !state.source) return ''
  return state.source === 'model' && !state.placeholder ? 'Live model' : 'Prepared copy'
}

export function briefRows(plan) {
  if (!plan?.intent) return []
  const rows = []
  for (const [key, label] of BRIEF_FIELDS) {
    const value = plan.intent[key]
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) continue
    const op = (plan.patch || []).find(item => item.field === key)
    if (key === 'sections' && Array.isArray(value)) {
      const added = new Set(op?.added || [])
      const chips = value.map(section => ({ text: sectionName(section), state: added.has(section) && op?.change === 'updated' ? 'added' : '' }))
      for (const section of op?.removed || []) chips.push({ text: sectionName(section), state: 'removed' })
      rows.push({ key, label, chips })
      continue
    }
    const from = op?.status === 'active' && op.change === 'updated' && op.from != null ? show(key, op.from) : ''
    rows.push({ key, label, value: show(key, value), from })
  }
  return rows
}

export function buildSteps(state) {
  const steps = []
  if (state.phase === 'idle' && !state.plan) return steps
  steps.push({ text: 'Understood the request', status: state.phase === 'thinking' ? 'run' : 'done' })
  if (state.phase === 'thinking') steps[0].text = 'Understanding the request'
  for (const action of state.actions.filter(item => item.tool === 'write_copy').slice(-2)) {
    const wrote = (action.result?.wrote || []).map(sectionName).join(', ')
    if (action.status === 'running') steps.push({ text: 'Writing the page', status: 'run' })
    else if (action.status === 'invalidated') steps.push({ text: 'Set aside: the brief changed', status: 'off' })
    else if (action.result?.fallback) steps.push({ text: 'Placed prepared copy', status: 'done' })
    else steps.push({ text: `Wrote ${wrote || 'the page'}`, status: 'done' })
  }
  if (state.render) {
    const pending = state.render.pending.map(sectionName).join(', ')
    steps.push(pending
      ? { text: `Rendered v${state.render.version}, ${pending} still to write`, status: 'run' }
      : { text: `Rendered for web and phone · v${state.render.version}`, status: 'done' })
  }
  return steps
}

export function previewName(plan) {
  const raw = plan?.intent?.business || plan?.intent?.kind || ''
  const slug = String(raw).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return slug || 'untitled'
}

// The device frames are small, so the built page scrolls without a scrollbar.
// Only the homepage preview gets this; the page served for "Open page" is untouched.
export function previewDoc(html) {
  const style = '<style>html{scrollbar-width:none}</style>'
  const doc = String(html ?? '')
  return doc.includes('</head>') ? doc.replace('</head>', style + '</head>') : doc + style
}

// Splits an SSE buffer into complete frames and the unfinished tail.
export function parseSse(buffer) {
  const parts = String(buffer).split('\n\n')
  const rest = parts.pop() || ''
  const frames = []
  for (const part of parts) {
    if (!part.trim() || part.startsWith(':')) continue
    let name = 'message'
    const data = []
    for (const line of part.split('\n')) {
      if (line.startsWith('event:')) name = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).trim())
    }
    if (!data.length) continue
    try { frames.push({ event: name, data: JSON.parse(data.join('\n')) }) } catch { /* a broken frame is dropped */ }
  }
  return { frames, rest }
}

export function cleanText(value) {
  return String(value ?? '').replace(/[\u0000-\u001F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)
}

export function turnError(status, code) {
  if (code === 'text_too_long') return 'Keep it under 500 characters and send it again.'
  if (code === 'text_required') return 'Say or type what you want to build.'
  if (status === 0) return 'The connection dropped and nothing was lost. Send it again.'
  return 'That turn did not start and nothing was lost. Send it again.'
}
