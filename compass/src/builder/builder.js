import { createDictation } from '../demo/voice.mjs'
import { createPreviewTools } from '../site/preview-tools.mjs'
import { parseSse, cleanText, previewDoc } from '../site/studio.mjs'
import { createProjectStore, completedRevision, appendRevision, restoredProject } from './project-store.mjs'

const LINES = [
  'Build me a premium website for an AI company. Make it minimal, light and editorial.',
  'Actually, make it warmer. Make the hero more ambitious, and add a pricing section.',
  'Now make it lighter, and add a testimonials section.',
]
const NAMES = { hero: 'Hero', features: 'Features', products: 'Products', gallery: 'Gallery', testimonials: 'Testimonials', pricing: 'Pricing', faq: 'FAQ', contact: 'Contact', signup: 'Signup' }
const FIELDS = [
  ['business', 'Name'], ['kind', 'What'], ['audience', 'For'], ['tone', 'Tone'], ['theme', 'Theme'],
  ['accent', 'Accent'], ['font', 'Type'], ['hero', 'Hero'], ['headline', 'Headline'], ['cta', 'Button'], ['sections', 'Sections'],
]
const ORB = { idle: 'Ready', starting: 'Waiting for microphone', listening: 'Listening', thinking: 'Thinking', acting: 'Acting', speaking: 'Speaking', replanning: 'Replanning' }

const demo = document.querySelector('#demo')
const orb = document.querySelector('#orb')
const orbLabel = document.querySelector('#orb-label')
const hint = document.querySelector('#hint')
const interim = document.querySelector('#interim')
const mic = document.querySelector('#mic')
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
const phoneFrame = document.querySelector('#phone-frame')
const previewDevices = document.querySelector('#preview-devices')
const previewSource = document.querySelector('#preview-source')
const voiceFallback = document.querySelector('#voice-fallback')

const state = {
  sessionId: '',
  orb: 'idle',
  plan: null,
  actions: [],
  render: null,
  turns: 0,
  busy: false,
  voiceOn: false,
  source: '',
  placeholder: false,
}
let epoch = 0
let pendingRequests = 0
let projectId = null
let history = []
let selectedRevision = null
let resumeIntent = null
let lastPrompt = ''
let lastSavedSignature = ''
let saveMessage = ''
let historyKey = ''
const requestControllers = new Set()
const projectStore = createProjectStore()
const projectName = document.querySelector('#project-name')
const saveButton = document.querySelector('#save-project')
const saveStatus = document.querySelector('#save-status')
const projectsPanel = document.querySelector('#projects-panel')
const projectsList = document.querySelector('#projects-list')
const projectsStatus = document.querySelector('#projects-status')
const projectsToggle = document.querySelector('#projects-toggle')
const historyList = document.querySelector('#history-list')
const historyCount = document.querySelector('#history-count')
const snapshotNote = document.querySelector('#snapshot-note')
const snapshotLabel = document.querySelector('#snapshot-label')
const sendButton = document.querySelector('#send')
const STARTERS = {
  studio: 'A minimal, white website for an architecture studio. Use editorial typography, a project gallery and a contact section.',
  bakery: 'A warm, bright website for an independent bakery. Include the menu, opening hours and a contact section.',
  portfolio: 'A clean, light portfolio for a creative designer. Include selected work, a short introduction and contact details.',
}
const previewTools = createPreviewTools({
  root: document.querySelector('[data-preview-tools]'),
  surface: document.querySelector('#stage'),
  getPlan: () => previewPlan(),
  getRender: () => previewRender(),
  isBusy: () => selectedRevision ? false : state.busy,
})

function previewPlan() {
  return selectedRevision?.plan || (state.source === 'saved' && !state.busy ? history.at(-1)?.plan : null) || state.plan
}
function previewRender() {
  return selectedRevision?.render || (state.source === 'saved' && !state.busy ? history.at(-1)?.render : null) || state.render
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
  const plan = previewPlan()
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
  if (selectedRevision) { buildCard.hidden = true; return }
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
  const plan = previewPlan()
  const render = previewRender()
  const business = plan?.intent?.business || plan?.intent?.kind || 'Your page'
  url.textContent = cap(business) + (render?.version ? ' · v' + render.version : ' · Preview')
  snapshotNote.hidden = !selectedRevision
  snapshotLabel.textContent = selectedRevision ? 'Viewing revision ' + selectedRevision.number + '. Read-only preview.' : ''
  if (!render?.html) {
    empty.hidden = false
    previewDevices.hidden = true
    for (const item of [frame, phoneFrame]) {
      item.hidden = true
      item.removeAttribute('srcdoc')
      delete item.dataset.key
    }
    previewSource.hidden = true
    open.hidden = true
    open.removeAttribute('href')
    return
  }
  empty.hidden = true
  previewDevices.hidden = false
  const renderKey = selectedRevision ? selectedRevision.id : state.source === 'saved' && !state.busy ? 'saved-' + history.at(-1)?.id : 'current-' + render.key
  for (const item of [frame, phoneFrame]) {
    item.hidden = false
    if (item.dataset.key !== renderKey) {
      item.dataset.key = renderKey
      item.srcdoc = previewDoc(render.html)
    }
  }
  previewSource.hidden = !state.source && !selectedRevision
  previewSource.textContent = selectedRevision || state.source === 'saved' ? 'Saved preview' : state.source === 'model' && !state.placeholder ? 'Live model' : 'Prepared copy'
  if (state.sessionId && !selectedRevision) {
    open.hidden = false
    open.href = '/api/site/session/' + encodeURIComponent(state.sessionId) + '/page'
  } else {
    open.hidden = true
    open.removeAttribute('href')
  }
}

function paintSample() {
  const line = LINES[Math.min(state.turns, LINES.length - 1)]
  sampleText.textContent = line
  scriptLabel.textContent = state.turns ? 'A next step' : 'A starting point'
  sample.classList.toggle('is-urgent', Boolean(state.busy && state.plan))
}
function paint() {
  paintBrief(); paintBuild(); paintStage(); paintSample()
  previewTools.update()
  paintProject()
}

function applyEvent(event) {
  if (event.sessionId) state.sessionId = event.sessionId
  if (event.type === 'reasoning_status' && event.stage === 'interpreting') setOrb('thinking')
  if (event.type === 'state_patch' && (event.version || 0) >= (state.plan?.version || 0)) {
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
  if (event.type === 'render' && (event.version || 0) >= (state.render?.version || 0)) {
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
    state.busy = pendingRequests > 0 || state.actions.some(item => item.status === 'running')
    if (!state.busy && state.orb !== 'speaking') setOrb('idle')
  }
  paint()
}

function applyResult(result, { replay = true } = {}) {
  if (result.sessionId) state.sessionId = result.sessionId
  if ((result.version || 0) >= (state.render?.version || 0)) {
    state.source = result.source === 'model' ? 'model' : 'prepared'
    state.placeholder = Boolean(result.placeholder)
  }
  if (replay && Array.isArray(result.events) && result.events.length) {
    for (const event of result.events) applyEvent(event)
    paint()
    return
  }
  if (result.intent && (result.version || 0) >= (state.plan?.version || 0)) state.plan = { intent: result.intent, patch: result.patch || [], version: result.version || 1 }
  if (result.html && (result.version || 0) >= (state.render?.version || 0) && result.html !== state.render?.html) state.render = { html: result.html, version: result.version || 1, pending: result.pending || [], key: (state.render?.key || 0) + 1 }
  state.busy = pendingRequests > 0 || state.actions.some(item => item.status === 'running')
  if (!state.busy && state.orb !== 'speaking') setOrb('idle')
  paint()
}

async function readSse(response, mine) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finished = false
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    const parsed = parseSse(buffer + decoder.decode(value, { stream: true }))
    buffer = parsed.rest
    if (mine !== epoch) continue
    for (const event of parsed.frames) {
      if (event.event === 'result') {
        applyResult(event.data, { replay: false })
        finished = true
        resumeIntent = null
      } else applyEvent(event.data)
    }
  }
  return finished
}

async function submit(text) {
  const clean = cleanText(text)
  if (!clean || selectedRevision) return
  if (dictation?.active) dictation.stop()
  const mine = epoch
  const controller = new AbortController()
  requestControllers.add(controller)
  pendingRequests += 1
  lastPrompt = clean
  saveMessage = ''
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
  paint()
  try {
    const response = await fetch('/api/site/turn', {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ sessionId: state.sessionId || undefined, text: clean, ...(resumeIntent ? {resumeIntent} : {}) }),
    })
    if (mine !== epoch) return
    if (response.status === 429) {
      const data = await response.json()
      if (mine !== epoch) return
      if (data.fallback) { applyResult(data.fallback); resumeIntent = null }
      notice.textContent = 'The request limit was reached. Showing a prepared preview for this turn.'
      return
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      if (mine !== epoch) return
      notice.textContent = data.error === 'text_too_long' ? 'Keep it to 500 characters and try again.' : 'That update did not finish. Your current preview is still here. Try again.'
      if (!input.value) { input.value = clean; count.textContent = String(clean.length) }
      return
    }
    const type = response.headers.get('content-type') || ''
    if (type.includes('text/event-stream') && response.body) {
      if (!await readSse(response, mine) && mine === epoch) notice.textContent = 'The connection ended before the update finished. You can try again.'
    } else {
      const result = await response.json()
      if (mine === epoch) { applyResult(result); resumeIntent = null }
    }
  } catch {
    if (mine !== epoch) return
    notice.textContent = 'The connection dropped. Your current preview is still here. Try again.'
    if (!input.value) { input.value = clean; count.textContent = String(clean.length) }
  } finally {
    requestControllers.delete(controller)
    if (mine === epoch) {
      pendingRequests = Math.max(0, pendingRequests - 1)
      if (!pendingRequests) {
        state.actions = state.actions.map(action => action.status === 'running' ? {...action,status:'invalidated'} : action)
        state.busy = false
        if (state.orb !== 'speaking') setOrb('idle')
        const revision = completedRevision(state,lastPrompt)
        history = appendRevision(history,revision)
        if (projectName.value === 'Untitled project' && state.plan?.intent) projectName.value = cap(state.plan.intent.business || state.plan.intent.kind || 'Untitled project').slice(0,64)
      }
      paint()
    }
  }
}

function idleVoice() {
  mic.setAttribute('aria-pressed','false')
  mic.setAttribute('aria-label','Dictate your idea')
  mic.querySelector('span').textContent = 'Speak'
  interim.hidden = true
  if (state.orb === 'listening' || state.orb === 'starting') setOrb(state.busy ? 'acting' : 'idle')
}
let voiceSelection = { prefix: '', suffix: '' }
const dictation = createDictation(window, {
  onTranscript: text => {
    const left = voiceSelection.prefix && !/\s$/.test(voiceSelection.prefix) && text ? voiceSelection.prefix + ' ' : voiceSelection.prefix
    const right = voiceSelection.suffix && !/^\s/.test(voiceSelection.suffix) && text ? ' ' + voiceSelection.suffix : voiceSelection.suffix
    input.value = (left + text + right).slice(0,500)
    count.textContent = String(input.value.length)
    hint.textContent = 'Your words appear above. Pause or stop, then edit before building.'
  },
  onEnd: (reason,text) => {
    idleVoice()
    if (reason !== 'error') hint.textContent = text ? 'Edit your words, then choose Build page.' : 'Describe a page, then refine it.'
    input.focus()
  },
  onError: message => { notice.textContent = message; hint.textContent = message; idleVoice() },
  onState: next => {
    if (next === 'idle') { idleVoice(); return }
    mic.setAttribute('aria-pressed','true')
    mic.setAttribute('aria-label',next === 'starting' ? 'Cancel microphone request' : 'Stop dictation')
    mic.querySelector('span').textContent = next === 'starting' ? 'Cancel' : 'Stop'
    hint.textContent = next === 'starting' ? 'Waiting for browser microphone access. Choose Cancel to stop.' : 'Listening. Speak naturally, then pause or stop to edit.'
    setOrb(next)
  },
}, {max:500,autoSubmit:false})
if (!dictation) { mic.disabled = true; voiceFallback.hidden = false }
mic.addEventListener('click', () => {
  if (!dictation || selectedRevision) return
  if (dictation.active) { dictation.stop(); return }
  const start = input.selectionStart ?? input.value.length
  const end = input.selectionEnd ?? start
  voiceSelection = { prefix: input.value.slice(0,start), suffix: input.value.slice(end) }
  notice.textContent = ''
  if (!dictation.start() && !notice.textContent) notice.textContent = 'Voice could not start. You can type your idea instead.'
})

sound.addEventListener('click', () => {
  state.voiceOn = !state.voiceOn
  sound.setAttribute('aria-pressed', String(state.voiceOn))
  sound.textContent = state.voiceOn ? 'Sound on' : 'Sound off'
  if (!state.voiceOn && window.speechSynthesis) window.speechSynthesis.cancel()
})
function discardCurrent() {
  return !isDirty() || confirm('Start another project without saving these changes on this device?')
}
function clearCurrent() {
  epoch += 1
  for (const controller of requestControllers) controller.abort()
  requestControllers.clear()
  pendingRequests = 0
  if (dictation?.active) dictation.stop()
  if (window.speechSynthesis) window.speechSynthesis.cancel()
  state.sessionId = ''
  state.plan = null
  state.actions = []
  state.render = null
  state.turns = 0
  state.busy = false
  state.source = ''
  state.placeholder = false
  projectId = null
  history = []
  selectedRevision = null
  resumeIntent = null
  lastSavedSignature = ''
  saveMessage = ''
  projectName.value = 'Untitled project'
  input.value = ''
  count.textContent = '0'
  log.replaceChildren()
  notice.textContent = ''
  setOrb('idle')
  paint()
}
reset.addEventListener('click', () => { if (discardCurrent()) { clearCurrent(); input.focus() } })

sample.addEventListener('click', () => submit(sampleText.textContent))
form.addEventListener('submit', (event) => { event.preventDefault(); submit(input.value) })
input.addEventListener('input', () => { if (dictation?.active) dictation.stop(); count.textContent = String(input.value.length) })
document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing && event.target === input) {
    event.preventDefault()
    submit(input.value)
  }
  if (event.key === 'Escape') {
    if (dictation?.active) dictation.stop()
    if (window.speechSynthesis) window.speechSynthesis.cancel()
  }
})

function signature() {
  return projectName.value.trim() + ':' + history.map(item => item.id).join(',')
}
function isDirty() {
  return Boolean(history.length && signature() !== lastSavedSignature)
}
function storageMessage(error) {
  return {
    unavailable:'Device storage is unavailable in this browser. You can still download the HTML.',
    quota:'This browser could not save the project. Download the HTML, or remove a saved project you no longer need.',
    full:'Device storage is full. Remove a saved project you no longer need, or download the HTML.',
    corrupt:'Saved projects could not be read safely. Your current preview is untouched; you can download the HTML.',
    missing:'The original saved project was removed. Choose Save on this device to keep a new copy.',
    invalid:'The completed preview could not be saved. You can download its HTML instead.',
  }[error] || 'The project could not be saved on this device.'
}
function paintProject() {
  const readOnly = Boolean(selectedRevision)
  input.disabled = readOnly
  sendButton.disabled = readOnly
  sample.disabled = readOnly
  mic.disabled = readOnly || !dictation
  saveButton.disabled = readOnly || state.busy || !history.length || !isDirty()
  saveButton.textContent = projectId ? 'Save changes' : 'Save on this device'
  saveStatus.textContent = saveMessage || (state.busy ? 'Build in progress' : history.length ? isDirty() ? 'Unsaved changes' : 'Saved on this device' : 'Not saved')
  historyCount.textContent = history.length + (history.length === 1 ? ' revision' : ' revisions')
  const nextKey = history.map(item => item.id).join(',') + ':' + (selectedRevision?.id || '')
  if (historyKey === nextKey) return
  historyKey = nextKey
  historyList.replaceChildren(...[...history].reverse().map(item => {
    const li = document.createElement('li')
    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('aria-pressed',String(selectedRevision?.id === item.id))
    const label = document.createElement('b')
    label.textContent = 'Revision ' + item.number
    const summary = document.createElement('span')
    summary.textContent = item.prompt.length > 75 ? item.prompt.slice(0,72) + '…' : item.prompt
    button.append(label,summary)
    button.addEventListener('click', () => {
      if (state.busy) { notice.textContent = 'Wait for this update to finish before reviewing history.'; return }
      if (dictation?.active) dictation.stop()
      selectedRevision = item
      paint()
    })
    li.append(button)
    return li
  }))
}
function paintProjects() {
  const result = projectStore.read()
  projectsStatus.textContent = result.ok ? result.projects.length ? 'Up to six projects and eight revision previews per project.' : 'No saved projects yet. Build a page, then choose Save on this device.' : storageMessage(result.error)
  projectsList.replaceChildren(...result.projects.map(project => {
    const li = document.createElement('li')
    const openProject = document.createElement('button')
    openProject.type = 'button'
    openProject.className = 'project-open'
    const name = document.createElement('strong')
    name.textContent = project.name
    const when = document.createElement('span')
    when.textContent = 'Saved ' + new Date(project.updatedAt).toLocaleDateString(undefined,{month:'short',day:'numeric'}) + ' · ' + project.revisions.length + (project.revisions.length === 1 ? ' revision' : ' revisions')
    openProject.append(name,when)
    openProject.addEventListener('click', () => { if (discardCurrent()) loadProject(project) })
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'project-remove'
    remove.textContent = 'Remove'
    remove.setAttribute('aria-label','Remove ' + project.name + ' from this device')
    remove.addEventListener('click', () => {
      if (!confirm('Remove ' + project.name + ' from this device? Download its HTML first if you want to keep a copy.')) return
      const deleted = projectStore.remove(project.id)
      if (!deleted.ok) { projectsStatus.textContent = storageMessage(deleted.error); return }
      if (projectId === project.id) { projectId = null; lastSavedSignature = ''; saveMessage = ''; paintProject() }
      paintProjects()
    })
    li.append(openProject,remove)
    return li
  }))
}
function loadProject(project) {
  const restored = restoredProject(project)
  if (!restored) { projectsStatus.textContent = 'This saved project could not be opened safely.'; return }
  clearCurrent()
  projectId = restored.projectId
  projectName.value = restored.name
  history = restored.history
  state.plan = restored.plan
  state.render = restored.render
  state.source = 'saved'
  state.placeholder = restored.placeholder
  state.turns = history.length
  resumeIntent = restored.resumeIntent
  lastSavedSignature = signature()
  projectsPanel.hidden = true
  projectsToggle.setAttribute('aria-expanded','false')
  notice.textContent = 'Opened from this device. Your next instruction starts a fresh build session from the saved brief.'
  paint()
}
projectsToggle.addEventListener('click', () => {
  projectsPanel.hidden = !projectsPanel.hidden
  projectsToggle.setAttribute('aria-expanded',String(!projectsPanel.hidden))
  if (!projectsPanel.hidden) paintProjects()
})
document.querySelector('#projects-close').addEventListener('click', () => {
  projectsPanel.hidden = true
  projectsToggle.setAttribute('aria-expanded','false')
  projectsToggle.focus()
})
saveButton.addEventListener('click', () => {
  if (saveButton.disabled) return
  const result = projectStore.save({projectId,name:projectName.value.trim() || 'Untitled project',revisions:history})
  if (!result.ok) {
    if (result.error === 'missing') { projectId = null; lastSavedSignature = '' }
    saveMessage = storageMessage(result.error); paintProject(); return
  }
  projectId = result.project.id
  projectName.value = result.project.name
  lastSavedSignature = signature()
  saveMessage = 'Saved on this device'
  paintProject()
  if (!projectsPanel.hidden) paintProjects()
})
projectName.addEventListener('input', () => { saveMessage = ''; paintProject() })
document.querySelector('#history-current').addEventListener('click', () => { selectedRevision = null; paint(); input.focus() })
for (const button of document.querySelectorAll('[data-starter]')) button.addEventListener('click', () => {
  input.value = STARTERS[button.dataset.starter] || ''
  count.textContent = String(input.value.length)
  input.focus()
})
const starterId = new URL(location.href).searchParams.get('starter')
if (STARTERS[starterId]) { input.value = STARTERS[starterId]; count.textContent = String(input.value.length) }
const requestedProject = new URL(location.href).searchParams.get('project')
if (requestedProject) {
  const saved = projectStore.read()
  const project = saved.projects.find(item => item.id === requestedProject)
  if (project) loadProject(project)
  else notice.textContent = saved.ok ? 'That project is not saved in this browser. You can start a new one.' : storageMessage(saved.error)
}

paint()
