// COMPASS homepage: menu, word reveals, cinematic motion, film slot, waitlist note.
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
const bar = document.querySelector('.bar')
const burger = document.querySelector('.burger')
const closeMenu = () => { bar?.classList.remove('open'); burger?.setAttribute('aria-expanded', 'false') }
burger?.addEventListener('click', () => { const open = bar?.classList.toggle('open'); burger.setAttribute('aria-expanded', String(Boolean(open))) })
bar?.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu))
addEventListener('keydown', e => { if (e.key === 'Escape' && bar?.classList.contains('open')) { closeMenu(); burger?.focus() } })

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
if (!reduce && 'IntersectionObserver' in window) {
  document.querySelectorAll('.reveal').forEach(el => { wi = 0; split(el) })
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) } }), { rootMargin: '0px 0px -12% 0px' })
  document.documentElement.classList.add('motion-ready')
  document.querySelectorAll('section:not(.hero) .wrap, .reveal').forEach(el => io.observe(el))
}

const hero = document.querySelector('.hero')
let queued = false
function frame() {
  queued = false
  const y = window.scrollY, vh = innerHeight
  if (hero && !reduce) hero.style.setProperty('--hf', (Math.min(1, Math.max(0, y / vh)) * 1.4).toFixed(3))
}
const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(frame) } }
addEventListener('scroll', onScroll, { passive: true }); addEventListener('resize', onScroll, { passive: true })
frame()

const player = document.querySelector('#watch-player')
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
function mountFilm(raw) {
  const src = embedUrl(raw)
  if (!player || !src) return
  player.dataset.state = 'ready'
  player.replaceChildren()
  const play = document.createElement('button')
  play.type = 'button'
  play.className = 'play'
  play.textContent = 'Play the demo'
  play.addEventListener('click', () => {
    const file = /\.(mp4|webm|ogv)(?:$|\?)/i.test(src)
    const frame = document.createElement(file ? 'video' : 'iframe')
    frame.title = 'COMPASS demo video'
    if (file) { frame.controls = true; frame.playsInline = true; frame.src = src }
    else { frame.src = src; frame.allow = 'fullscreen; picture-in-picture'; frame.referrerPolicy = 'no-referrer'; frame.setAttribute('allowfullscreen', '') }
    player.replaceChildren(frame)
  })
  player.append(play)
}
if (player) {
  const stop = AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined
  fetch('/api/config', { headers: { accept: 'application/json' }, signal: stop })
    .then(res => res.ok ? res.json() : null)
    .then(data => { if (data?.demoVideoUrl) mountFilm(data.demoVideoUrl) })
    .catch(() => {})
}

const form = document.querySelector('#waitlist')
form?.addEventListener('submit', event => {
  event.preventDefault()
  const status = document.querySelector('#waitlist-status')
  if (!form.reportValidity()) return
  if (status) status.textContent = 'Not sent. TODO: connect a waitlist destination before this form can store an email.'
})
