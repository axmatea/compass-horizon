// COMPASS homepage: menu, the builder stage, quiet reveals, recorded film, early access.
import { modeById, REVISIONS } from './modes.mjs'
import { briefMock, ideasMock } from './frames.mjs'
import { createStudio, beginTurn, applyEvent, applyResult, closeTurn, briefRows, buildSteps, sourceLabel, previewName, previewDoc, parseSse, cleanText, turnError, PHASE_LABELS } from './studio.mjs'
import { createDictation } from '../demo/voice.mjs'
import { createPreviewTools } from './preview-tools.mjs'

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
    section.querySelectorAll('h2, .watch-note, .player, .how-steps > li, .access-form').forEach((el, index) => {
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
const buildButton = $('#build-btn')
const openLink = $('#open')
const screens = [
  { screen: $('#web-screen'), frame: $('#web-frame'), base: 1200 },
  { screen: $('#phone-screen'), frame: $('#phone-frame'), base: 390 },
]
const HINT = hint?.textContent || ''
const PENDING = stepsEl?.innerHTML || ''
const ideaLabels = ['Bakery', 'AI company', 'Portfolio']
function compactIdeas() { ideas?.querySelectorAll('button').forEach((button, index) => { button.textContent = ideaLabels[index] || button.textContent }) }

let state = createStudio()
let epoch = 0
let mode = composer?.elements.mode?.value || 'site'
let soundOn = false
let listening = null
let remotePreviewCurrent = false
const previewTools = createPreviewTools({
  root: stage?.querySelector('[data-preview-tools]'),
  surface: stage?.querySelector('.canvas'),
  getPlan: () => state.plan,
  getRender: () => state.render,
  isBusy: () => state.open > 0,
})

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
    const placeholder = item.screen.querySelector('.preview-placeholder')
    if (placeholder) placeholder.hidden = live
    item.frame.hidden = !live
    if (!live) { item.frame.removeAttribute('srcdoc'); delete item.frame.dataset.key; continue }
    if (item.frame.dataset.key === String(state.render.key)) continue
    item.frame.dataset.key = String(state.render.key)
    item.frame.srcdoc = previewDoc(state.render.html)
    item.screen.classList.remove('is-fresh')
    void item.screen.offsetWidth
    item.screen.classList.add('is-fresh')
  }
  canvasTag.textContent = live ? 'Your page · v' + state.render.version : 'Your page'
  webUrl.textContent = (live || state.plan ? previewName(state.plan) : slug(modeById(mode).sample.name)) + ' · Preview'
  const canOpen = live && Boolean(state.sessionId) && state.open === 0 && remotePreviewCurrent
  openLink.hidden = !canOpen
  if (canOpen) openLink.href = '/api/site/session/' + encodeURIComponent(state.sessionId) + '/page'
  else openLink.removeAttribute('href')
}

function paint() {
  stage.hidden = !(state.turns > 0 || state.open > 0 || noticeEl?.textContent)
  const phase = listening ? listening.phase || 'starting' : state.phase
  stage.dataset.phase = phase
  statusEl.textContent = phase === 'starting' ? 'Waiting for microphone' : PHASE_LABELS[phase] || PHASE_LABELS.idle
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
  if (buildButton) { buildButton.disabled = state.open > 0; buildButton.setAttribute('aria-busy', String(state.open > 0)) }
  previewTools.update()
}

function paintMode() {
  const current = modeById(mode)
  intent.placeholder = current.placeholder
  ideas.innerHTML = ideasMock(mode)
  compactIdeas()
  if (state.render) return
  paint()
}

async function readStream(response, mine) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let complete = false
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    const parsed = parseSse(buffer + decoder.decode(value, { stream: true }))
    buffer = parsed.rest
    if (mine !== epoch) continue
    for (const frame of parsed.frames) {
      if (frame.event === 'result' && typeof frame.data?.html === 'string' && frame.data.html.trim()) {
        applyResult(state, frame.data)
        complete = true
      }
      else {
        applyEvent(state, frame.data)
        if (frame.data?.type === 'say') speak(frame.data.text)
      }
    }
    paint()
  }
  return complete
}

async function submit(raw) {
  if (state.open > 0) { setNotice('Build in progress.'); return }
  if (dictation?.active) dictation.stop()
  const text = cleanText(raw)
  if (!text) { setNotice(turnError(400, 'text_required')); hint.textContent = turnError(400, 'text_required'); intent.focus(); return }
  const mine = epoch
  const previous = { ...state }
  let complete = false
  remotePreviewCurrent = false
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
      if (mine !== epoch) return
      if (typeof data?.fallback?.html === 'string' && data.fallback.html.trim()) {
        applyResult(state, data.fallback, { replay: true })
        complete = true
      }
      setNotice(complete ? 'Prepared example. Live generation is busy.' : 'Please wait a moment, then try again.')
      return
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      if (mine !== epoch) return
      setNotice(turnError(response.status, data.error))
      return
    }
    const type = response.headers.get('content-type') || ''
    if (type.includes('text/event-stream') && response.body) complete = await readStream(response, mine)
    else {
      const data = await response.json()
      if (mine === epoch && typeof data?.html === 'string' && data.html.trim()) {
        applyResult(state, data, { replay: true })
        complete = true
        speak(data.reply)
      }
    }
    if (!complete && mine === epoch) setNotice('Build interrupted. Try your instruction again.')
  } catch {
    if (mine === epoch) setNotice(turnError(0))
  } finally {
    if (mine === epoch) {
      remotePreviewCurrent = complete
      if (!complete) {
        state = previous
        if (!intent.value && !reviseInput.value) {
          const field = previous.render ? reviseInput : intent
          field.value = text
          field.focus()
        }
      }
      closeTurn(state)
      paint()
    }
  }
}

// Dictation leaves an editable transcript. Only an explicit Build or Send submits it.
function stopListening() {
  if (!listening) return
  listening.button.setAttribute('aria-pressed', 'false')
  listening.button.setAttribute('aria-label', listening.label)
  composer.classList.remove('is-listening')
  listening = null
  paint()
}
const dictation = createDictation(window, {
  onTranscript: text => {
    if (!listening) return
    const { prefix, suffix, field } = listening
    const left = prefix && !/\s$/.test(prefix) && text ? prefix + ' ' : prefix
    const right = suffix && !/^\s/.test(suffix) && text ? ' ' + suffix : suffix
    field.value = (left + text + right).slice(0, 500)
  },
  onError: message => { stopListening(); hint.textContent = message; setNotice(message) },
  onEnd: reason => {
    const field = listening?.field
    stopListening()
    if (reason !== 'error') {
      hint.textContent = reason === 'empty' ? 'No speech recognised. Try again.' : 'Edit, then build.'
      if (field) field.focus()
    }
  },
  onState: phase => {
    if (!listening) return
    if (phase === 'idle') { composer.classList.remove('is-listening'); return }
    listening.phase = phase
    listening.button.setAttribute('aria-pressed', 'true')
    listening.button.setAttribute('aria-label', 'Stop dictation')
    composer.classList.toggle('is-listening', phase === 'listening')
    hint.textContent = phase === 'listening' ? 'Listening. Stop to edit.' : 'Waiting for microphone…'
    paint()
  },
}, { max: 500, pauseMs: 1200, autoSubmit: false })

function toggleVoice(button, field) {
  if (!dictation) {
    const message = 'Voice unavailable. Please type.'
    hint.textContent = message
    setNotice(message)
    field.focus()
    return
  }
  if (dictation.active) { dictation.stop(); return }
  const start = typeof field.selectionStart === 'number' ? field.selectionStart : field.value.length
  const end = typeof field.selectionEnd === 'number' ? field.selectionEnd : start
  listening = { button, field, prefix: field.value.slice(0, start), suffix: field.value.slice(end), label: button.getAttribute('aria-label') }
  if (!dictation.start()) {
    stopListening()
    hint.textContent = 'Microphone unavailable. Please type.'
    field.focus()
    return
  }
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
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing) { event.preventDefault(); submit(intent.value) }
  })
  reviseInput.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing) { event.preventDefault(); submit(reviseInput.value) }
  })
  addEventListener('keydown', event => {
    if (event.key !== 'Escape') return
    if (dictation?.active) dictation.stop()
    stopListening()
    if (window.speechSynthesis) window.speechSynthesis.cancel()
  })
  for (const field of [intent, reviseInput]) field.addEventListener('input', () => {
    if (!dictation?.active || listening?.field !== field) return
    const edited = field.value
    dictation.stop()
    stopListening()
    field.value = edited
    hint.textContent = 'Ready to build.'
  })
  revise.addEventListener('submit', event => { event.preventDefault(); submit(reviseInput.value) })
  for (const group of [ideas, changes]) group.addEventListener('click', event => {
    const idea = event.target.closest('[data-idea]')
    if (idea) submit(idea.dataset.idea)
  })
  $('#mic').addEventListener('click', event => toggleVoice(event.currentTarget, intent))
  $('#revise-mic').addEventListener('click', event => toggleVoice(event.currentTarget, reviseInput))
  sound.addEventListener('click', () => setSound(!soundOn))
  resetBtn.addEventListener('click', () => {
    epoch += 1
    remotePreviewCurrent = false
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
  if (mode !== 'site') paintMode()
  compactIdeas()
}

// Video: the server renders the approved founder film, or DEMO_VIDEO_URL when that https URL is set.
// Metadata stays unloaded until the player is near the viewport.
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
  frame.title = 'COMPASS product film'
  if (file) {
    frame.controls = true
    frame.playsInline = true
    frame.preload = 'metadata'
    frame.poster = '/assets/promo/compass-promo.webp'
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
  const poster = el('picture')
  const webp = document.createElement('source')
  webp.type = 'image/webp'
  webp.srcset = '/assets/promo/compass-promo.webp'
  const img = el('img', 'poster')
  img.src = '/assets/promo/compass-promo.jpg'
  img.alt = ''
  img.width = 1920
  img.height = 1080
  poster.append(webp, img)
  const play = el('a', 'play', 'Play the film')
  play.href = raw
  play.dataset.embed = src
  player.append(poster, play)
}
const film = player?.querySelector('video[preload="none"]')
if (film && 'IntersectionObserver' in window) {
  const arm = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return
    arm.disconnect()
    film.preload = 'metadata'
  }, { rootMargin: '240px 0px' })
  arm.observe(film)
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
