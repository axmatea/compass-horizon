// COMPASS landing (owner: FRONTEND). Menu, word reveals, hero parallax, and the pinned stage. No library; one read-only /api/health probe for the live line.
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
const bar = document.querySelector('.bar')
const burger = document.querySelector('.burger')
burger?.addEventListener('click', () => { const open = bar.classList.toggle('open'); burger.setAttribute('aria-expanded', String(open)) })
bar?.querySelectorAll('.menu a').forEach(a => a.addEventListener('click', () => { bar.classList.remove('open'); burger?.setAttribute('aria-expanded', 'false') }))

// Word reveals: split text nodes into words, keep <br> and <em> intact.
let wi = 0
const split = node => {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 3) {
      const frag = document.createDocumentFragment()
      child.textContent.split(/(\s+)/).forEach(part => {
        if (!part) return
        if (/^\s+$/.test(part)) return frag.append(part)
        const w = document.createElement('span'); w.className = 'w'; w.style.setProperty('--i', wi++); w.textContent = part; frag.append(w)
      })
      child.replaceWith(frag)
    } else if (child.nodeType === 1 && child.tagName !== 'BR') split(child)
  }
}
document.querySelectorAll('.reveal').forEach(el => { wi = 0; split(el) })

const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) } }), { rootMargin: '0px 0px -12% 0px' })
document.querySelectorAll('section:not(.hero):not(.stage) .wrap, .reveal').forEach(el => { if (!el.closest('.hero')) io.observe(el) }) // the hero reveals are directed by the overture

// Hero: the art drifts and swells as the journey begins, the copy lifts away.
const hero = document.querySelector('.hero')
const stage = document.querySelector('.stage')
const browser = stage?.querySelector('.browser')
const page = stage?.querySelector('.page')
const steps = [...(stage?.querySelectorAll('.step') || [])]
const line = stage?.querySelector('.voice-line')
let step = -1, typing = 0
const type = (text, k = 0) => {
  clearTimeout(typing)
  line.textContent = text.slice(0, k)
  if (k < text.length) typing = setTimeout(() => type(text, k + 1), 30)
}
function setStep(i) {
  if (i === step) return
  const prev = step; step = i
  stage.dataset.step = i
  steps.forEach((s, j) => { s.classList.toggle('on', j === i); s.classList.toggle('past', j < i) })
  browser.classList.toggle('blank', i === 0)
  browser.classList.toggle('building', i === 1)
  page.classList.toggle('warm', i === 3)
  if (i === 0 || i === 2) { if (reduce) line.textContent = line.dataset['l' + i]; else if (prev !== -1 || i === 2) type(line.dataset['l' + i]); else line.textContent = line.dataset.l0 }
}
let queued = false
function frame() {
  queued = false
  const y = window.scrollY, vh = innerHeight
  if (hero && !reduce) {
    const t = Math.min(1, Math.max(0, y / vh))
    hero.style.setProperty('--hy', (t * 80).toFixed(1)); hero.style.setProperty('--hs', (t * .08).toFixed(3)); hero.style.setProperty('--hf', (t * 1.4).toFixed(3))
  }
  if (stage) {
    if (reduce) { setStep(3); return }
    const top = stage.offsetTop, len = stage.offsetHeight - vh
    const p = Math.min(1, Math.max(0, (y - top) / len))
    setStep(y < top - vh * .5 ? 0 : Math.min(3, Math.floor(p * 4)))
  }
}
const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(frame) } }
addEventListener('scroll', onScroll, { passive: true }); addEventListener('resize', onScroll, { passive: true })
frame()

// The film pauses when it leaves the viewport, so audio never plays over the rest of the page.
const filmEl = document.getElementById('film-video')
if (filmEl && 'IntersectionObserver' in window) new IntersectionObserver(([e]) => { if (!e.isIntersecting && !filmEl.paused) filmEl.pause() }, { threshold: 0.2 }).observe(filmEl)

// Under the hood: the live line states what production runs right now (presence only, never a secret).
const live = document.getElementById('live-stack')
if (live) fetch('/api/health', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null).then(h => {
  if (!h || !h.ok) return
  const names = { gradium: 'Gradium', boson: 'Boson Higgs', browser: 'browser speech', generalcompute: 'General Compute', nebius: 'Nebius GLM-5.3' }
  const voice = h.voice && h.voice.provider, llm = h.llm && h.llm.provider
  if (!voice || !llm) return
  const model = h.llm.model ? ` (${h.llm.model})` : '', failover = h.llm.fallback ? ` · failover ${names[h.llm.fallback] || h.llm.fallback}` : ''
  live.querySelector('span').textContent = `Live now · voice ${names[voice] || voice} · reasoning ${names[llm] || llm}${model}${failover}`
  live.hidden = false
})

// ---- the overture: the page builds itself from one sentence, then evolves from a second. The same page, no restart. Any gesture skips.
const ov = document.getElementById('overture')
const ovLine = document.getElementById('ov-line'), ovStatus = document.getElementById('ov-status'), ovReply = document.getElementById('ov-reply'), ovReplay = document.getElementById('ov-replay')
const coolH1 = document.querySelector('.h1s .v-cool'), warmH1 = document.querySelector('.h1s .v-warm')
const SAY1 = 'Maya owns press, Leo the build, Ana the client. We launch October 10.'
const SAY2 = 'Update: the client moved launch to October 3.'
const REPLY = 'Maya, Leo and Ana have their next move. Everyone else keeps working.'
const STEPS = ['Understanding', 'Who knows what', 'What happened', 'Why', 'Who is affected', 'Next action']
const SPEED = 28
let ovTimers = [], ovTyping = 0, ovRunning = false
const later = (ms, fn) => ovTimers.push(setTimeout(fn, ms))
function typeLine(text) {
  clearTimeout(ovTyping); ovLine.classList.add('typing'); let k = 0
  const tick = () => { ovLine.textContent = text.slice(0, ++k); if (k < text.length) ovTyping = setTimeout(tick, SPEED); else ovLine.classList.remove('typing') }
  tick()
}
function ovFinish() {
  if (!ovRunning) return
  ovRunning = false
  ovTimers.forEach(clearTimeout); ovTimers = []; clearTimeout(ovTyping)
  document.body.classList.remove('ov-blank', 'ov-build', 'cool', 'overture-on'); document.body.classList.add('warm', 'ov-done')
  coolH1.classList.remove('in'); warmH1.classList.add('in')
  ov.classList.add('ov-off'); later(800, () => { ov.hidden = true })
  ovReplay.hidden = false
}
function ovStart() {
  ovTimers.forEach(clearTimeout); ovTimers = []; clearTimeout(ovTyping)
  ovRunning = true
  ov.hidden = false; ov.className = 'overture'; ovLine.textContent = ''; ovStatus.textContent = ''; ovReply.textContent = ''; ovReplay.hidden = true
  document.body.classList.add('overture-on', 'ov-blank', 'cool'); document.body.classList.remove('warm', 'ov-done', 'ov-build')
  coolH1.classList.remove('in'); warmH1.classList.remove('in')
  scrollTo(0, 0)
  let t = 600
  later(t, () => ov.classList.add('ov-listen'))
  later(t += 500, () => typeLine(SAY1))
  t += SAY1.length * SPEED + 500
  later(t, () => { ov.classList.remove('ov-listen'); ov.classList.add('ov-dock'); document.body.classList.remove('ov-blank'); document.body.classList.add('ov-build'); coolH1.classList.add('in') })
  STEPS.forEach((s, i) => later(t + 200 + i * 450, () => { ovStatus.innerHTML = `<b>${s}</b>` + (i < STEPS.length - 1 ? ' · ' + STEPS.slice(i + 1).join(' · ') : '') }))
  later(t += 2900, () => { ov.classList.add('ov-listen'); typeLine(SAY2) }) // the interruption lands while the preview is still being finished
  t += SAY2.length * SPEED + 500
  later(t, () => { ov.classList.remove('ov-listen'); ovStatus.innerHTML = '<b>Updating only what changed</b>'; document.body.classList.remove('cool'); document.body.classList.add('warm'); coolH1.classList.remove('in'); warmH1.classList.add('in') })
  later(t += 1500, () => { ovReply.textContent = REPLY; ovStatus.innerHTML = '<b>Plan v2</b> · three people updated · everything else kept' })
  later(t += 2300, ovFinish)
}
const wantsOverture = Boolean(ov && coolH1 && warmH1) && !reduce && !location.hash && !/\bstatic\b/.test(location.search)
if (ov && !wantsOverture) { document.body.classList.add('warm', 'ov-done'); warmH1?.classList.add('in'); ov.hidden = true; if (ovReplay && coolH1 && !reduce) ovReplay.hidden = false }
if (wantsOverture) {
  ovStart()
  const skip = e => { if (e.type === 'pointerdown' && e.target.closest('#ov-replay')) return; ovFinish() }
  addEventListener('wheel', skip, { passive: true }); addEventListener('touchstart', skip, { passive: true }); addEventListener('keydown', skip); addEventListener('pointerdown', skip)
}
ovReplay?.addEventListener('click', () => { ovReplay.hidden = true; ovStart() })
