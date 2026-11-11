import { clarifyLocal, planLocal, MAX_INTENT } from './catalog.mjs'
import { createDictation } from './voice.mjs'

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
const bar = document.querySelector('.bar')
const burger = document.querySelector('.burger')
const closeMenu = () => { bar?.classList.remove('open'); burger?.setAttribute('aria-expanded', 'false') }
burger?.addEventListener('click', () => { const open = bar?.classList.toggle('open'); burger.setAttribute('aria-expanded', String(Boolean(open))) })
bar?.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu))
addEventListener('keydown', event => { if (event.key === 'Escape' && bar?.classList.contains('open')) { closeMenu(); burger?.focus() } })

const status = document.querySelector('#demo-status')
const intentForm = document.querySelector('#intent-form')
const intentInput = document.querySelector('#intent')
const intentError = document.querySelector('#intent-error')
const count = document.querySelector('#intent-count')
const questionForm = document.querySelector('#questions-form')
const previewRoot = document.querySelector('#preview-root')
const micBtn = document.querySelector('#mic')
const voiceNote = document.querySelector('#voice-note')
const voiceFallback = document.querySelector('#voice-fallback')
const composer = document.querySelector('#composer')
let pendingExample = ''
let entry = 'type'
let busy = false
let dictation = null
let revealTimer = 0
let revealToken = 0

function say(text) { if (status) status.textContent = text }
function clearReveal() {
  revealToken += 1
  if (revealTimer) clearTimeout(revealTimer)
  revealTimer = 0
}
function show(stage) {
  if (stage !== 'preview') clearReveal()
  if (stage !== 'intent') dictation?.stop()
  for (const name of ['intent', 'questions', 'building', 'preview']) {
    const node = document.querySelector('#stage-' + name)
    if (!node) continue
    const on = name === stage
    node.hidden = !on
    node.classList.toggle('is-on', on)
    node.inert = !on
  }
  document.querySelectorAll('.progress li').forEach(item => {
    if (item.dataset.step === stage) item.setAttribute('aria-current', 'step')
    else item.removeAttribute('aria-current')
  })
  const heading = document.querySelector(`#stage-${stage} h1, #stage-${stage} h2`)
  heading?.focus({ preventScroll: reduce })
  document.getElementById('demo')?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
}
function setBuilding(title) {
  const node = document.querySelector('#building-title')
  if (node) node.textContent = title
}
function pause(ms) {
  if (reduce) return Promise.resolve()
  return new Promise(resolve => setTimeout(resolve, ms))
}
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue
    if (key === 'class') node.className = value
    else if (key === 'text') node.textContent = value
    else node.setAttribute(key, value)
  }
  for (const child of children) node.append(child)
  return node
}
function mark(node, wave) {
  if (!reduce) {
    node.classList.add('assemble')
    node.style.setProperty('--wave', String(wave))
  }
  return node
}
function note(message) { if (voiceNote) voiceNote.textContent = message || '' }
function writeIntent(value) {
  if (!intentInput) return
  intentInput.value = value
  if (count) count.textContent = String(intentInput.value.length)
}
function setMic(on) {
  micBtn?.classList.toggle('is-listening', on)
  composer?.classList.toggle('is-listening', on)
  micBtn?.setAttribute('aria-pressed', String(on))
  const label = micBtn?.querySelector('.mic-label')
  if (label) label.textContent = on ? 'Listening' : 'Speak your idea'
}

intentInput?.addEventListener('input', () => {
  if (count && intentInput) count.textContent = String(intentInput.value.length)
  if (dictation?.active) dictation.stop()
})

dictation = createDictation(window, {
  onState: state => setMic(state === 'listening'),
  onTranscript: writeIntent,
  onSubmit(text) {
    entry = 'voice'
    pendingExample = ''
    writeIntent(text)
    note('')
    say('Heard you. Building from that.')
    intentForm?.requestSubmit()
  },
  onError(message) {
    note(message)
    say(message)
    intentInput?.focus()
  },
  onEnd(reason) {
    if (reason !== 'empty') return
    const message = 'No speech detected. Type the idea, or try the microphone again.'
    note(message)
    say(message)
  },
}, { max: MAX_INTENT })

if (!dictation) {
  if (micBtn) micBtn.hidden = true
  voiceFallback?.removeAttribute('hidden')
} else {
  micBtn?.addEventListener('click', () => {
    if (dictation.active) {
      dictation.stop()
      say('Voice stopped. The text stays in the field.')
      return
    }
    note('')
    if (intentError) intentError.textContent = ''
    if (!dictation.start()) {
      if (!voiceNote?.textContent) {
        const message = 'Voice input is unavailable right now. Type the idea instead.'
        note(message)
        say(message)
      }
      intentInput?.focus()
      return
    }
    say('Listening. A pause submits what you said.')
  })
}

async function post(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => null)
  if (!data) throw new Error('bad')
  return data
}

function formError(message) {
  if (intentError) intentError.textContent = message
  say(message)
  show('intent')
  intentInput?.focus()
}

function questionsView(data, kind) {
  if (intentError) intentError.textContent = ''
  const intentLine = document.querySelector('#questions-intent')
  const hint = document.querySelector('#questions-hint')
  if (intentLine) intentLine.textContent = data.intent
  if (hint) hint.textContent = kind === 'voice' ? 'Suggested answers are already selected. Change any, or skip and build.' : ''
  questionForm.replaceChildren()
  for (const question of data.questions) {
    const options = question.options.map((option, index) => {
      const id = question.id + '-' + index
      const input = el('input', { type: 'radio', name: question.id, id, value: option })
      if (index === 0) input.checked = true
      return el('label', { class: 'chip', for: id }, [input, el('span', { text: option })])
    })
    questionForm.append(el('fieldset', {}, [el('legend', { text: question.prompt }), ...options]))
  }
  const back = el('button', { class: 'ghost', type: 'button', id: 'back', text: 'Back' })
  const build = kind === 'voice'
    ? el('button', { class: 'cta', type: 'submit', 'aria-describedby': 'questions-hint', text: 'Skip and build' })
    : el('button', { class: 'cta', type: 'submit', text: 'Build the preview' })
  questionForm.append(el('div', { class: 'actions left' }, kind === 'voice' ? [build, back] : [back, build]))
  questionForm.querySelector('#back')?.addEventListener('click', () => { show('intent'); intentInput?.focus() })
  questionForm.dataset.intent = data.intent
  questionForm.dataset.exampleId = data.exampleId || ''
  questionForm.dataset.prompts = JSON.stringify(Object.fromEntries(data.questions.map(question => [question.id, question.prompt])))
  show('questions')
  say(kind === 'voice'
    ? 'Suggested answers are selected. Skip and build, or change them.'
    : 'Answer ' + data.questions.length + (data.questions.length === 1 ? ' question.' : ' questions.'))
}

function tone(meta) {
  const text = String(meta || '').toLowerCase()
  if (text.includes('full')) return 'full'
  if (text.includes('open') || text.includes('spot')) return 'open'
  if (text.includes('not sent') || text.includes('preview')) return 'quiet'
  if (text.includes('scheduled') || text.includes('checked') || text.includes('staged')) return 'hold'
  return ''
}
function toneLabel(kind) {
  return { full: 'Full', open: 'Open', quiet: 'Preview', hold: 'Set' }[kind] || ''
}
function previewView(data, noteText) {
  clearReveal()
  const token = revealToken
  const summary = document.querySelector('#preview-summary')
  const notice = document.querySelector('#preview-notice')
  const title = document.querySelector('#preview-title')
  if (title) title.textContent = data.productName || 'Your preview'
  if (summary) summary.textContent = data.summary || ''
  const source = data.source === 'model' ? 'Plan drafted with the configured model.' : data.source === 'example' ? 'Prepared example.' : 'Prepared preview from your description.'
  if (notice) notice.textContent = [noteText, source, data.notice || 'Preview only. Nothing is sent or published.'].filter(Boolean).join(' ')
  const tabs = data.preview?.tabs || []
  let active = tabs[0]?.id || ''
  const shells = []
  const liveLabels = []
  let firstPaint = true
  const paint = () => {
    const reveal = firstPaint
    const tab = tabs.find(item => item.id === active) || tabs[0]
    if (!tab) return
    for (const shell of shells) {
      shell.title.textContent = tab.title
      shell.kicker.textContent = tab.kicker || data.productName || ''
      shell.cards.replaceChildren(...(tab.lines || []).map((item, index) => {
        const kind = item.status || tone(item.meta)
        const when = /(\d{1,2}:\d{2})/.exec(item.title)?.[1] || ''
        const label = when ? item.title.replace(when, '').replace(/[·-]/g, ' ').replace(/\s+/g, ' ').trim() : item.title
        const card = el('article', { class: 'card' }, [
          when ? el('time', { text: when }) : el('i', { class: 'mark', 'aria-hidden': 'true' }),
          el('div', {}, [el('b', { text: label || item.title }), el('small', { text: item.meta || '' })]),
          kind ? el('em', { class: 'state is-' + kind, text: toneLabel(kind) }) : el('em', { class: 'state is-quiet', text: 'Preview' }),
        ])
        if (reveal) mark(card, 4 + Math.min(index, 3))
        return card
      }))
      shell.nav.querySelectorAll('[data-tab]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.tab === active)))
    }
  }
  function shell(compact) {
    const kicker = mark(el('p', { class: 'shell-kicker' }), 2)
    const heading = mark(el('h3'), 2)
    const cards = el('div', { class: 'cards' })
    const nav = mark(el('div', { class: 'shell-tabs' }), 7)
    const live = el('span', { class: 'shell-live', text: reduce ? 'Preview' : 'Assembling' })
    liveLabels.push(live)
    for (const tab of tabs) {
      const button = el('button', { type: 'button', 'data-tab': tab.id, text: tab.label })
      button.addEventListener('click', () => { active = tab.id; paint() })
      nav.append(button)
    }
    const node = el('div', { class: 'shell' + (compact ? ' is-phone' : ''), style: '--accent:' + (data.preview?.accent || '#1c3a34') }, [
      mark(el('div', { class: 'shell-bar' }, [el('strong', { text: data.productName || 'Preview' }), live]), 1),
      el('div', { class: 'shell-body' }, [kicker, heading, mark(el('p', { class: 'shell-note', text: data.preview?.subhead || '' }), 3), cards]),
      nav,
    ])
    shells.push({ kicker, title: heading, cards, nav })
    return node
  }
  const planCard = (heading, items, start) => el('section', {}, [
    el('h3', { text: heading }),
    el('ul', {}, items.map((item, index) => mark(item, start + index))),
  ])
  const screenItems = (data.screens || []).map(item => el('li', {}, [el('b', { text: item.name }), el('span', { text: item.purpose })]))
  const dataItems = (data.dataModel || []).map(item => el('li', {}, [el('b', { text: item.name }), el('span', { text: (item.fields || []).join(' · ') })]))
  const linkItems = (data.integrations || []).map(item => el('li', {}, [el('b', { text: item.name }), el('span', { text: item.purpose })]))
  const devices = el('div', { class: 'devices' + (reduce ? '' : ' is-assembling') }, [
    el('article', { class: 'phone', 'aria-label': 'Phone preview' }, [shell(true)]),
    el('article', { class: 'web', 'aria-label': 'Web preview' }, [
      el('div', { class: 'chrome' }, [el('i'), el('i'), el('i'), el('span', { text: 'Preview' })]),
      shell(false),
    ]),
  ])
  previewRoot.replaceChildren(
    el('div', { class: 'plan' }, [
      planCard('Screens', screenItems, 0),
      planCard('Data model', dataItems, 2),
      planCard('Integrations', linkItems, 3),
    ]),
    devices,
  )
  paint()
  firstPaint = false
  show('preview')
  if (reduce) {
    say((data.productName || 'Preview') + ' is ready.')
    return
  }
  say('Assembling the screens.')
  previewRoot.setAttribute('aria-busy', 'true')
  requestAnimationFrame(() => {
    previewRoot.querySelectorAll('.assemble').forEach(node => node.classList.add('is-in'))
  })
  revealTimer = setTimeout(() => {
    if (token !== revealToken) return
    revealTimer = 0
    devices.classList.remove('is-assembling')
    previewRoot.removeAttribute('aria-busy')
    for (const label of liveLabels) label.textContent = 'Preview'
    say((data.productName || 'Preview') + ' is ready.')
  }, 7 * 70 + 560)
}

async function clarify(intent, exampleId, kind) {
  if (busy) return
  busy = true
  const started = performance.now()
  setBuilding('Reading what you described')
  show('building')
  say('Reading what you described.')
  const payload = exampleId ? { exampleId, intent } : { intent }
  try {
    let data
    try { data = await post('/api/demo/clarify', payload) }
    catch { data = { ...clarifyLocal(intent, exampleId), source: 'fallback' } }
    await pause(Math.max(0, 420 - (performance.now() - started)))
    if (data.error === 'rate_limited' && data.fallback) { previewView(data.fallback, 'Too many previews from this network.'); return }
    if (data.error === 'too_long') { formError('Keep it under ' + MAX_INTENT + ' characters.'); return }
    if (data.error === 'empty' || data.ok === false) { formError('Describe what the software should do.'); return }
    if (!data.questions?.length) throw new Error('empty questions')
    questionsView(data, kind)
  } catch {
    const local = clarifyLocal(intent, exampleId)
    if (!local.ok) formError(local.error === 'too_long' ? 'Keep it under ' + MAX_INTENT + ' characters.' : 'Describe what the software should do.')
    else questionsView({ ...local, source: 'fallback' }, kind)
  } finally { busy = false }
}

intentForm?.addEventListener('submit', event => {
  event.preventDefault()
  if (dictation?.active) dictation.stop()
  const exampleId = pendingExample
  pendingExample = ''
  const kind = exampleId ? 'example' : entry
  entry = 'type'
  const intent = intentInput?.value || ''
  if (!exampleId && intent.trim().length > MAX_INTENT) { formError('Keep it under ' + MAX_INTENT + ' characters.'); return }
  clarify(intent, exampleId, kind)
})
document.querySelectorAll('[data-example]').forEach(button => button.addEventListener('click', () => {
  dictation?.stop()
  entry = 'type'
  pendingExample = button.dataset.example || ''
  note('')
  if (intentInput) { intentInput.value = button.textContent.trim(); if (count) count.textContent = String(intentInput.value.length) }
  intentForm?.requestSubmit()
}))

questionForm?.addEventListener('submit', async event => {
  event.preventDefault()
  if (busy) return
  busy = true
  const started = performance.now()
  setBuilding('Laying out the screens')
  show('building')
  say('Laying out the screens.')
  const prompts = JSON.parse(questionForm.dataset.prompts || '{}')
  const answers = [...new FormData(questionForm).entries()].filter(([key]) => key.startsWith('q')).map(([id, value]) => ({ id, value: String(value), prompt: prompts[id] || '' }))
  const payload = { intent: questionForm.dataset.intent, exampleId: questionForm.dataset.exampleId || undefined, answers }
  try {
    let data
    try { data = await post('/api/demo/plan', payload) }
    catch { data = { ...planLocal(payload.intent, payload.exampleId, answers), source: 'fallback' } }
    await pause(Math.max(0, 380 - (performance.now() - started)))
    if (data.error === 'rate_limited' && data.fallback) { previewView(data.fallback, 'Too many previews from this network.'); return }
    if (!data.ok && data.ok !== undefined) throw new Error('plan')
    if (!data.preview?.tabs?.length) throw new Error('plan')
    previewView(data)
  } catch {
    const local = planLocal(payload.intent, payload.exampleId, answers)
    if (local.ok) previewView({ ...local, source: 'fallback' })
    else { say('The preview could not be built. Showing a prepared example.'); previewView({ ...planLocal('', 'barber', []), source: 'example' }, 'Prepared example.') }
  } finally { busy = false }
})

document.querySelector('#start-over')?.addEventListener('click', () => {
  note('')
  show('intent')
  intentInput?.focus()
})
