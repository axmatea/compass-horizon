import { createDictation } from '../demo/voice.mjs'

const LINES = [
  'Build me a premium website for an AI company. Make it minimal, dark and cinematic.',
  'Actually, make it warmer. Make the hero more ambitious, and add a pricing section.',
  'Now make it lighter, and add a testimonials section.',
]
const NAMES = { hero: 'Hero', features: 'Features', products: 'Products', gallery: 'Gallery', testimonials: 'Testimonials', pricing: 'Pricing', faq: 'FAQ', contact: 'Contact', signup: 'Signup' }
const FIELDS = [
  ['business', 'Name'], ['kind', 'What'], ['audience', 'For'], ['tone', 'Tone'], ['theme', 'Theme'],
  ['accent', 'Accent'], ['font', 'Type'], ['hero', 'Hero'], ['headline', 'Headline'], ['cta', 'Button'], ['sections', 'Sections'],
]
const ORB = { idle: 'Ready', listening: 'Listening', thinking: 'Thinking', acting: 'Acting', speaking: 'Speaking', interrupted: 'Interrupted', replanning: 'Replanning' }

const demo = document.querySelector('#demo')
const orb = document.querySelector('#orb')
const orbLabel = document.querySelector('#orb-label')
const hint = document.querySelector('#hint')
const interim = document.querySelector('#interim')
const mic = document.querySelector('#mic')
const stop = document.querySelector('#stop')
const sound = document.querySelector('#sound')
const reset = document.querySelector('#reset')
const sample = document.querySelector('#sample')
const sampleText = document.querySelector('#sample-text')
const scriptLabel = document.querySelector('#script-label')
const form = document.querySelector('#composer')
const input = document.querySelector('#sd-input')
const count = document.querySelector('#count')
const briefCard = document.querySelector('#brief-card')
const briefVersion = document.querySelector('#brief-version')
const brief = document.querySelector('#brief')
const buildCard = document.querySelector('#build-card')
const build = document.querySelector('#build')
const log = document.querySelector('#log')
const notice = document.querySelector('#notice')
const url = document.querySelector('#url')
const open = document.querySelector('#open')
const empty = document.querySelector('#empty')
const frame = document.querySelector('#frame')
const voiceFallback = document.querySelector('#voice-fallback')

const state = {
  sessionId: '',
  orb: 'idle',
  plan: null,
  actions: [],
  render: null,
  turns: 0,
  busy: false,
  voiceOn: true,
}

function setOrb(next) {
  state.orb = next
  demo.dataset.state = next
  orb.dataset.state = next
  orbLabel.textContent = ORB[next] || 'Ready'
}
function cap(value) {
  return String(value ?? '').replace(/\b\p{L}+/gu, (word) => word.toLowerCase() === 'ai' ? 'AI' : word.charAt(0).toUpperCase() + word.slice(1))
}
function show(key, value) {
  if (Array.isArray(value)) return value.map(item => NAMES[item] || item).join(' · ')
  return key === 'business' || key === 'headline' || key === 'cta' ? String(value) : cap(value)
}
function say(text) {
  hint.textContent = text || hint.textContent
  if (!text || !state.voiceOn || !window.speechSynthesis) return
  try {
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    const done = () => { if (state.orb === 'speaking') setOrb(state.busy ? 'acting' : 'idle') }
    const timer = setTimeout(done, Math.min(4000, 700 + text.split(/\s+/).length * 280))
    utterance.onend = () => { clearTimeout(timer); done() }
    setOrb('speaking')
    window.speechSynthesis.speak(utterance)
  } catch { /* speech is optional */ }
}

function paintBrief() {
  const plan = state.plan
  if (!plan) { briefCard.hidden = true; return }
  briefCard.hidden = false
  briefVersion.textContent = plan.version ? `Updated · v${plan.version}` : ''
  const rows = FIELDS.filter(([key]) => plan.intent[key] != null && !(Array.isArray(plan.intent[key]) && !plan.intent[key].length))
  brief.replaceChildren(...rows.map(([key, label]) => {
    const op = (plan.patch || []).find(item => item.field === key)
    const li = document.createElement('li')
    const name = document.createElement('span')
    name.textContent = label
    const value = document.createElement('b')
    if (key === 'sections' && Array.isArray(plan.intent.sections)) {
      const chips = document.createElement('span')
      chips.className = 'chips'
      for (const section of plan.intent.sections) {
        const chip = document.createElement('em')
        chip.textContent = NAMES[section] || section
        if (op?.added?.includes(section)) chip.className = 'is-added'
        chips.append(chip)
      }
      for (const section of op?.removed || []) {
        const chip = document.createElement('em')
        chip.className = 'is-removed'
        chip.textContent = NAMES[section] || section
        chips.append(chip)
      }
      li.append(name, chips)
      return li
    }
    if (op?.status === 'active' && op.change === 'updated' && op.from != null) {
      const old = document.createElement('s')
      old.textContent = show(key, op.from)
      value.textContent = show(key, plan.intent[key])
      const wrap = document.createElement('span')
      wrap.append(old, value)
      li.append(name, wrap)
      return li
    }
    value.textContent = show(key, plan.intent[key])
    li.append(name, value)
    return li
  }))
}

function paintBuild() {
  const items = [{ text: 'Understanding', className: state.orb === 'thinking' ? 'is-run' : 'is-done' }]
  for (const action of state.actions.filter(item => item.tool === 'write_copy').slice(-2)) {
    const wrote = (action.result?.wrote || []).map(section => NAMES[section] || section).join(', ')
    const label = action.status === 'running' ? 'Writing copy…' : action.status === 'invalidated' ? 'Rewriting after the brief changed' : action.result?.fallback ? 'Prepared copy for this session' : `Words in: ${wrote || 'the page'}`
    items.push({ text: label, className: action.status === 'running' ? 'is-run' : action.status === 'done' ? 'is-done' : 'is-paused' })
  }
  if (state.render) items.push({ text: state.render.pending?.length ? `Rendered v${state.render.version} · ${state.render.pending.map(section => NAMES[section] || section).join(', ')} pending` : `Rendered v${state.render.version}`, className: state.render.pending?.length ? 'is-run' : 'is-done' })
  if (items.length < 2 && !state.render) { buildCard.hidden = true; return }
  buildCard.hidden = false
  build.replaceChildren(...items.map(item => {
    const li = document.createElement('li')
    li.className = item.className
    li.textContent = item.text
    return li
  }))
}

function paintStage() {
  const business = state.plan?.intent?.business || state.plan?.intent?.kind || 'untitled'
  const slug = String(business).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled'
  url.textContent = `${slug} · Preview${state.render ? ` · v${state.render.version}` : ''}`
  if (!state.render?.html) {
    empty.hidden = false
    frame.hidden = true
    open.hidden = true
    return
  }
  empty.hidden = true
  frame.hidden = false
  if (frame.dataset.key !== String(state.render.key)) {
    frame.dataset.key = String(state.render.key)
    frame.srcdoc = state.render.html
  }
  if (state.sessionId) {
    open.hidden = false
    open.href = `/api/site/session/${encodeURIComponent(state.sessionId)}/page`
  }
}

function paintSample() {
  const line = LINES[Math.min(state.turns, LINES.length - 1)]
  sampleText.textContent = line
  scriptLabel.textContent = state.busy && state.plan ? 'Interrupt with' : state.turns ? 'Change the page' : 'Try saying'
  sample.classList.toggle('is-urgent', Boolean(state.busy && state.plan))
}
function paint() {
  paintBrief(); paintBuild(); paintStage(); paintSample()
  stop.hidden = !state.busy
}

function applyEvent(event) {
  if (event.sessionId) state.sessionId = event.sessionId
  if (event.type === 'reasoning_status' && event.stage === 'interpreting') setOrb('thinking')
  if (event.type === 'state_patch') {
    state.plan = { intent: event.intent, patch: event.patch, version: event.version }
    setOrb(state.actions.some(item => item.status === 'running') ? 'acting' : 'thinking')
    const changed = (event.patch || []).some(op => op.status === 'active' && op.change === 'updated')
    if (changed) setOrb('replanning')
  }
  if (event.type === 'tool_call') {
    state.actions = [...state.actions.filter(item => item.id !== event.actionId), { id: event.actionId, tool: event.tool, status: 'running', args: event.args }].slice(-3)
    state.busy = true
    setOrb('acting')
  }
  if (event.type === 'tool_result') {
    state.actions = state.actions.map(item => item.id === event.actionId ? { ...item, status: 'done', result: event.result } : item)
  }
  if (event.type === 'action_invalidated') {
    state.actions = state.actions.map(item => item.id === event.actionId ? { ...item, status: 'invalidated' } : item)
  }
  if (event.type === 'render') {
    state.render = { html: event.html, version: event.version, pending: event.pending || [], key: (state.render?.key || 0) + 1 }
  }
  if (event.type === 'say' && event.text) {
    const li = document.createElement('li')
    const who = document.createElement('span')
    who.textContent = 'COMPASS'
    const text = document.createElement('p')
    text.textContent = event.text
    li.append(who, text)
    log.append(li)
    say(event.text)
  }
  if (event.type === 'done') {
    state.busy = state.actions.some(item => item.status === 'running')
    if (!state.busy && state.orb !== 'speaking') setOrb('idle')
  }
  paint()
}

function applyResult(result) {
  if (result.sessionId) state.sessionId = result.sessionId
  if (Array.isArray(result.events) && result.events.length) {
    for (const event of result.events) applyEvent(event)
    return
  }
  if (result.intent) state.plan = { intent: result.intent, patch: result.patch || [], version: result.version || 1 }
  if (result.html) state.render = { html: result.html, version: result.version || 1, pending: result.pending || [], key: (state.render?.key || 0) + 1 }
  state.busy = false
  setOrb('idle')
  paint()
}

async function readSse(response) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() || ''
    for (const part of parts) {
      if (!part.trim() || part.startsWith(':')) continue
      const data = part.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n')
      if (!data) continue
      try { applyEvent(JSON.parse(data)) } catch { /* ignore a partial frame */ }
    }
  }
}

async function submit(text) {
  const clean = String(text || '').trim()
  if (!clean) return
  notice.textContent = ''
  input.value = ''
  count.textContent = '0'
  state.turns += 1
  state.busy = true
  setOrb('thinking')
  const row = document.createElement('li')
  const who = document.createElement('span')
  who.textContent = 'You'
  const said = document.createElement('p')
  said.textContent = clean
  row.append(who, said)
  log.append(row)
  paintSample()
  try {
    const response = await fetch('/api/site/turn', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ sessionId: state.sessionId || undefined, text: clean }),
    })
    if (response.status === 429) {
      const data = await response.json()
      if (data.fallback) applyResult(data.fallback)
      notice.textContent = 'Showing the prepared build for this turn.'
      return
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      notice.textContent = data.error === 'text_too_long' ? 'Keep it to 500 characters and send it again.' : 'That turn did not start. The page you already have is still here.'
      state.busy = false
      setOrb(state.plan ? 'idle' : 'idle')
      return
    }
    const type = response.headers.get('content-type') || ''
    if (type.includes('text/event-stream') && response.body) await readSse(response)
    else applyResult(await response.json())
  } catch {
    notice.textContent = 'The connection dropped. Type it again. Nothing already on the page was published.'
    state.busy = false
    setOrb('idle')
  }
}

const dictation = createDictation(window, {
  onTranscript: (text) => { interim.hidden = false; interim.textContent = `“${text}”`; hint.hidden = true },
  onSubmit: (text) => { interim.hidden = true; hint.hidden = false; mic.setAttribute('aria-pressed', 'false'); mic.textContent = 'Speak'; submit(text) },
  onError: (message) => { notice.textContent = message; mic.setAttribute('aria-pressed', 'false'); mic.textContent = 'Speak' },
  onEnd: () => { mic.setAttribute('aria-pressed', 'false'); mic.textContent = 'Speak'; interim.hidden = true; hint.hidden = false },
  onState: () => {},
}, { max: 500, pauseMs: 1200 })

if (!dictation) {
  mic.disabled = true
  voiceFallback.hidden = false
}
mic.addEventListener('click', () => {
  if (!dictation) return
  if (dictation.active) { dictation.stop(); return }
  const started = dictation.start()
  if (!started) { voiceFallback.hidden = false; return }
  mic.setAttribute('aria-pressed', 'true')
  mic.textContent = 'Listening'
  setOrb('listening')
})
stop.addEventListener('click', () => { if (state.busy) setOrb('interrupted') })
sound.addEventListener('click', () => {
  state.voiceOn = !state.voiceOn
  sound.setAttribute('aria-pressed', String(state.voiceOn))
  sound.textContent = state.voiceOn ? 'Sound on' : 'Sound off'
  if (!state.voiceOn && window.speechSynthesis) window.speechSynthesis.cancel()
})
reset.addEventListener('click', () => {
  state.sessionId = ''
  state.plan = null
  state.actions = []
  state.render = null
  state.turns = 0
  state.busy = false
  log.replaceChildren()
  notice.textContent = ''
  setOrb('idle')
  paint()
})
sample.addEventListener('click', () => submit(sampleText.textContent))
form.addEventListener('submit', (event) => { event.preventDefault(); submit(input.value) })
input.addEventListener('input', () => { count.textContent = String(input.value.length) })
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.busy) setOrb('interrupted')
})
paint()
