// COMPASS homepage: menu, the builder stage, quiet reveals, optional video, early access.
import { team, visibleTeam } from './team.mjs'
import { modeById, REVISIONS } from './modes.mjs'
import { webMock, phoneMock, briefMock, ideasMock } from './frames.mjs'
import { createStudio, beginTurn, applyEvent, applyResult, closeTurn, briefRows, buildSteps, sourceLabel, previewName, parseSse, cleanText, turnError, PHASE_LABELS } from './studio.mjs'
import { createDictation } from '../demo/voice.mjs'

const $ = selector => document.querySelector(selector)
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches

// Header
const bar = $('.bar')
const burger = $('.burger')
const closeMenu = () => { bar?.classList.remove('open'); burger?.setAttribute('aria-expanded', 'false') }
burger?.addEventListener('click', () => { const open = bar?.classList.toggle('open'); burger.setAttribute('aria-expanded', String(Boolean(open))) })
bar?.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu))
addEventListener('keydown', e => { if (e.key === 'Escape' && bar?.classList.contains('open')) { closeMenu(); burger?.focus() } })
const onScroll = () => bar?.classList.toggle('is-stuck', scrollY > 8)
addEventListener('scroll', onScroll, { passive: true })
onScroll()

// Reveals
if (!reduce && 'IntersectionObserver' in window) {
  const io = new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return
    entry.target.classList.add('in')
    io.unobserve(entry.target)
  }), { rootMargin: '0px 0px -8% 0px' })
  document.documentElement.classList.add('motion')
  document.querySelectorAll('main > section:not(.hero)').forEach(section => {
    section.querySelectorAll('.eyebrow, h2, .kind, .how-steps > li, .pillars > li, .differ-lede, .studio-body, .access-lede, #early-access, .qa, .aside').forEach((el, index) => {
      el.classList.add('rise')
      el.style.transitionDelay = Math.min(index, 5) * 60 + 'ms'
      io.observe(el)
    })
  })
}

// Builder stage
const stage = $('#studio')
const composer = $('#composer')
const intent = $('#intent')
const hint = $('#box-hint')
const ideas = $('#ideas')
const revise = $('#revise')
const reviseInput = $('#revise-input')
const changes = $('#changes')
const statusEl = $('#st-status')
const sourceEl = $('#st-source')
const briefEl = $('#brief')
const briefTag = $('#brief-tag')
const stepsEl = $('#steps')
const replyEl = $('#reply')
const noticeEl = $('#notice')
const canvasTag = $('#canvas-tag')
const webUrl = $('#web-url')
const sound = $('#sound')
const resetBtn = $('#reset')
const openLink = $('#open')
const screens = [
  { screen: $('#web-screen'), frame: $('#web-frame'), base: 1200, mock: webMock },
  { screen: $('#phone-screen'), frame: $('#phone-frame'), base: 390, mock: phoneMock },
]
const HINT = hint?.textContent || ''
const PENDING = stepsEl?.innerHTML || ''

let state = createStudio()
let epoch = 0
let mode = composer?.elements.mode?.value || 'web'
let soundOn = false
let soundChosen = false
let listening = null

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}
function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
function setNotice(message) {
  if (noticeEl) noticeEl.textContent = message || ''
}

function speak(text) {
  if (!text || !soundOn || !window.speechSynthesis) return
  try {
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text))
  } catch { /* speech is optional */ }
}

function paintBrief() {
  if (!state.plan) {
    briefTag.textContent = 'Example'
    briefEl.innerHTML = briefMock(mode)
    return
  }
  briefTag.textContent = 'v' + state.plan.version
  briefEl.replaceChildren(...briefRows(state.plan).map(row => {
    const li = el('li', row.from || row.chips?.some(chip => chip.state) ? 'is-new' : '')
    li.append(el('span', '', row.label))
    if (row.chips) {
      const chips = el('span', 'chips')
      for (const chip of row.chips) chips.append(el('em', chip.state ? 'is-' + chip.state : '', chip.text))
      li.append(chips)
    } else {
      const value = el('b')
      if (row.from) value.append(el('s', '', row.from))
      value.append(row.value)
      li.append(value)
    }
    return li
  }))
}

function paintSteps() {
  const steps = buildSteps(state)
  if (!steps.length) { stepsEl.innerHTML = PENDING; return }
  stepsEl.replaceChildren(...steps.map(step => el('li', 'is-' + step.status, step.text)))
}

function paintFrames() {
  const live = Boolean(state.render?.html)
  stage.dataset.live = String(live)
  for (const item of screens) {
    item.frame.hidden = !live
    if (!live) { item.frame.removeAttribute('srcdoc'); delete item.frame.dataset.key; continue }
    if (item.frame.dataset.key === String(state.render.key)) continue
    item.frame.dataset.key = String(state.render.key)
    item.frame.srcdoc = state.render.html
    item.screen.classList.remove('is-fresh')
    void item.screen.offsetWidth
    item.screen.classList.add('is-fresh')
  }
  canvasTag.textContent = live ? 'Your page · v' + state.render.version : 'Example layout'
  webUrl.textContent = (live || state.plan ? previewName(state.plan) : slug(modeById(mode).sample.name)) + ' · Preview'
  const canOpen = live && Boolean(state.sessionId)
  openLink.hidden = !canOpen
  if (canOpen) openLink.href = '/api/site/session/' + encodeURIComponent(state.sessionId) + '/page'
  else openLink.removeAttribute('href')
}

function paint() {
  const phase = listening ? 'listening' : state.phase
  stage.dataset.phase = phase
  statusEl.textContent = PHASE_LABELS[phase] || PHASE_LABELS.idle
  const source = sourceLabel(state)
  sourceEl.hidden = !source
  sourceEl.textContent = source
  sourceEl.dataset.source = source === 'Live model' ? 'model' : 'prepared'
  paintBrief()
  paintSteps()
  paintFrames()
  replyEl.hidden = !state.reply
  replyEl.textContent = state.reply
  const started = state.turns > 0
  revise.hidden = !started
  changes.hidden = !started
  resetBtn.hidden = !started
}

function paintMode() {
  const current = modeById(mode)
  intent.placeholder = current.placeholder
  ideas.innerHTML = ideasMock(mode)
  if (state.render) return
  for (const item of screens) {
    const mock = item.screen.querySelector('.ui')
    if (mock) mock.outerHTML = item.mock(mode)
  }
  paint()
}

async function readStream(response, mine) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    const parsed = parseSse(buffer + decoder.decode(value, { stream: true }))
    buffer = parsed.rest
    if (mine !== epoch) continue
    for (const frame of parsed.frames) {
      if (frame.event === 'result') applyResult(state, frame.data)
      else {
        applyEvent(state, frame.data)
        if (frame.data?.type === 'say') speak(frame.data.text)
      }
    }
    paint()
  }
}

async function submit(raw) {
  const text = cleanText(raw)
  if (!text) { setNotice(turnError(400, 'text_required')); hint.textContent = turnError(400, 'text_required'); intent.focus(); return }
  const mine = epoch
  intent.value = ''
  reviseInput.value = ''
  hint.textContent = HINT
  setNotice('')
  beginTurn(state)
  paint()
  const box = stage.getBoundingClientRect()
  if (box.top > innerHeight * 0.45 || box.top < 0) stage.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  try {
    const response = await fetch('/api/site/turn', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ sessionId: state.sessionId || undefined, text }),
      signal: AbortSignal.timeout ? AbortSignal.timeout(90000) : undefined,
    })
    if (mine !== epoch) return
    if (response.status === 429) {
      const data = await response.json().catch(() => null)
      if (data?.fallback) applyResult(state, data.fallback, { replay: true })
      setNotice('The live builder is busy right now, so this turn used the prepared build.')
      return
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      setNotice(turnError(response.status, data.error))
      return
    }
    const type = response.headers.get('content-type') || ''
    if (type.includes('text/event-stream') && response.body) await readStream(response, mine)
    else {
      const data = await response.json()
      if (mine === epoch) { applyResult(state, data, { replay: true }); speak(data.reply) }
    }
  } catch {
    if (mine === epoch) setNotice(turnError(0))
  } finally {
    if (mine === epoch) { closeTurn(state); paint() }
  }
}

// Voice: the browser turns speech into text, and only the text is sent.
function stopListening() {
  if (!listening) return
  listening.button.setAttribute('aria-pressed', 'false')
  composer.classList.remove('is-listening')
  if (listening.field === intent && hint.textContent === 'Listening. Pause when you are done.') hint.textContent = HINT
  listening = null
  paint()
}
const dictation = createDictation(window, {
  onTranscript: text => { if (listening) listening.field.value = text },
  onSubmit: text => { stopListening(); submit(text) },
  onError: message => { stopListening(); hint.textContent = message; setNotice(message) },
  onEnd: () => stopListening(),
  onState: () => {},
}, { max: 500, pauseMs: 1200 })

function toggleVoice(button, field) {
  if (!dictation) {
    const message = 'Voice input is not available in this browser. Type it instead.'
    hint.textContent = message
    setNotice(message)
    field.focus()
    return
  }
  if (dictation.active) { dictation.stop(); stopListening(); return }
  if (!dictation.start()) {
    hint.textContent = 'Voice input did not start. Type it instead.'
    field.focus()
    return
  }
  listening = { button, field }
  button.setAttribute('aria-pressed', 'true')
  if (field === intent) { composer.classList.add('is-listening'); hint.textContent = 'Listening. Pause when you are done.' }
  if (!soundChosen) setSound(true)
  paint()
}
function setSound(on) {
  soundOn = on
  sound.setAttribute('aria-pressed', String(on))
  sound.textContent = on ? 'Sound on' : 'Sound off'
  if (!on && window.speechSynthesis) window.speechSynthesis.cancel()
}

if (stage && composer) {
  changes.replaceChildren(...REVISIONS.map(([label, text]) => {
    const chip = el('button', 'idea', label)
    chip.type = 'button'
    chip.dataset.idea = text
    return chip
  }))
  composer.addEventListener('submit', event => { event.preventDefault(); submit(intent.value) })
  composer.addEventListener('change', event => {
    if (event.target.name !== 'mode') return
    mode = event.target.value
    paintMode()
  })
  intent.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); submit(intent.value) }
  })
  revise.addEventListener('submit', event => { event.preventDefault(); submit(reviseInput.value) })
  for (const group of [ideas, changes]) group.addEventListener('click', event => {
    const idea = event.target.closest('[data-idea]')
    if (idea) submit(idea.dataset.idea)
  })
  $('#mic').addEventListener('click', event => toggleVoice(event.currentTarget, intent))
  $('#revise-mic').addEventListener('click', event => toggleVoice(event.currentTarget, reviseInput))
  sound.addEventListener('click', () => { soundChosen = true; setSound(!soundOn) })
  resetBtn.addEventListener('click', () => {
    epoch += 1
    if (dictation?.active) dictation.stop()
    stopListening()
    if (window.speechSynthesis) window.speechSynthesis.cancel()
    state = createStudio()
    setNotice('')
    paintMode()
    paint()
    intent.focus()
  })
  if ('ResizeObserver' in window) {
    const fit = new ResizeObserver(entries => {
      for (const entry of entries) {
        const item = screens.find(candidate => candidate.screen === entry.target)
        if (item) item.screen.style.setProperty('--s', String(entry.contentRect.width / item.base))
      }
    })
    for (const item of screens) fit.observe(item.screen)
  }
  if (mode !== 'web') paintMode()
}

// Team: bios render only once the founder adds confirmed entries to team.mjs.
const people = visibleTeam(team)
const bios = $('#team-bios')
if (bios && people.length) {
  for (const person of people) {
    const item = el('li')
    if (person.logo) {
      const img = el('img')
      img.src = person.logo
      img.alt = ''
      img.width = 48
      img.height = 48
      item.append(img)
    }
    item.append(el('h3', '', person.name))
    if (person.role) item.append(el('p', 'role', person.role))
    if (person.bio) item.append(el('p', '', person.bio))
    bios.append(item)
  }
  bios.hidden = false
}

// Video: the server renders the player when DEMO_VIDEO_URL is set.
const player = $('#watch-player')
function embedUrl(raw) {
  let url
  try { url = new URL(raw) } catch { return null }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  const host = url.hostname.replace(/^www\./, '')
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0]
    return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : null
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'm.youtube.com') {
    const id = url.searchParams.get('v') || (url.pathname.startsWith('/embed/') ? url.pathname.split('/')[2] : url.pathname.startsWith('/shorts/') ? url.pathname.split('/')[2] : '')
    return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` : null
  }
  if (host === 'vimeo.com') {
    const id = url.pathname.split('/').filter(Boolean).pop()
    return id && /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}` : null
  }
  return url.toString()
}
function mountEmbed(host, src) {
  const file = /\.(mp4|webm|ogv)(?:$|\?)/i.test(src)
  const frame = document.createElement(file ? 'video' : 'iframe')
  frame.title = 'COMPASS demo video'
  if (file) {
    frame.controls = true
    frame.playsInline = true
    frame.preload = 'metadata'
    frame.poster = '/assets/hero/compass-hero.jpg'
    frame.src = src
  } else {
    frame.src = src
    frame.allow = 'fullscreen; picture-in-picture'
    frame.referrerPolicy = 'no-referrer'
    frame.setAttribute('allowfullscreen', '')
  }
  host.dataset.state = 'ready'
  host.replaceChildren(frame)
}
player?.addEventListener('click', event => {
  const play = event.target.closest('[data-embed]')
  if (!play || !player) return
  event.preventDefault()
  const src = play.getAttribute('data-embed')
  if (src) mountEmbed(player, src)
})
function mountFilm(raw) {
  const src = embedUrl(raw)
  if (!player || !src) return
  if (/\.(mp4|webm|ogv)(?:$|\?)/i.test(src)) { mountEmbed(player, src); return }
  player.dataset.state = 'ready'
  player.replaceChildren()
  const poster = el('img', 'poster')
  poster.src = '/assets/hero/compass-hero.jpg'
  poster.alt = ''
  const play = el('a', 'play', 'Play the demo')
  play.href = raw
  play.dataset.embed = src
  player.append(poster, play)
}
if (player && !player.querySelector('video, iframe, [data-embed]')) {
  const stop = AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined
  fetch('/api/config', { headers: { accept: 'application/json' }, signal: stop })
    .then(res => res.ok ? res.json() : null)
    .then(data => { if (data?.demoVideoUrl) mountFilm(data.demoVideoUrl) })
    .catch(() => {})
}

// Early access
const form = $('#early-access')
const status = $('#early-access-status')
function setStatus(message, isError) {
  if (!status) return
  status.textContent = message
  status.classList.toggle('is-error', Boolean(isError))
}
function mailtoFallback(email) {
  return 'mailto:info@aimedia.global?subject=' + encodeURIComponent('COMPASS early access') + '&body=' + encodeURIComponent('Email: ' + email)
}
const emailInput = form?.querySelector('input[name="email"]')
emailInput?.addEventListener('invalid', event => {
  event.preventDefault()
  emailInput.setAttribute('aria-invalid', 'true')
  setStatus('Enter a valid email address.', true)
})
emailInput?.addEventListener('input', () => {
  if (emailInput.validity.valid) emailInput.removeAttribute('aria-invalid')
})
form?.addEventListener('submit', async event => {
  event.preventDefault()
  if (!form.reportValidity()) {
    emailInput?.setAttribute('aria-invalid', 'true')
    setStatus('Enter a valid email address.', true)
    return
  }
  const email = emailInput?.value?.trim() || ''
  const honey = form.querySelector('input[name="hp"]')?.value || ''
  const submitButton = form.querySelector('button[type="submit"]')
  if (submitButton) submitButton.disabled = true
  setStatus('Sending your request.', false)
  try {
    const res = await fetch('/api/early-access', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ email, hp: honey }),
    })
    const data = await res.json().catch(() => null)
    if (res.status === 429) {
      setStatus('Too many requests from this network. Wait a moment and try again.', true)
      return
    }
    if (data?.stored) {
      emailInput?.removeAttribute('aria-invalid')
      setStatus('Request received.', false)
      form.reset()
      return
    }
    if (data?.delivery === 'mailto' && typeof data.mailto === 'string' && data.mailto.startsWith('mailto:info@aimedia.global?')) {
      emailInput?.removeAttribute('aria-invalid')
      setStatus('Your email app will open so you can send this request to info@aimedia.global.', Boolean(data.error))
      location.href = data.mailto
      return
    }
    if (data?.ok && data.stored === false) {
      setStatus('Thanks.', false)
      return
    }
    emailInput?.setAttribute('aria-invalid', 'true')
    setStatus('Enter a valid email address.', true)
    emailInput?.focus()
  } catch {
    setStatus('Your email app will open so you can send this request to info@aimedia.global.', true)
    location.href = mailtoFallback(email)
  } finally {
    if (submitButton) submitButton.disabled = false
  }
})
