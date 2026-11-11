// COMPASS homepage: menu, word reveals, cinematic motion, optional film, early access.
import { team, visibleTeam } from './team.mjs'
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

const people = visibleTeam(team)
const teamWrap = document.querySelector('#team .wrap')
if (teamWrap && people.length) {
  const list = document.createElement('ul')
  list.className = 'team-bios'
  for (const person of people) {
    const item = document.createElement('li')
    if (person.logo) {
      const img = document.createElement('img')
      img.src = person.logo
      img.alt = ''
      img.width = 48
      img.height = 48
      item.append(img)
    }
    const name = document.createElement('h3')
    name.textContent = person.name
    item.append(name)
    if (person.role) {
      const role = document.createElement('p')
      role.className = 'role'
      role.textContent = person.role
      item.append(role)
    }
    if (person.bio) {
      const bio = document.createElement('p')
      bio.textContent = person.bio
      item.append(bio)
    }
    list.append(item)
  }
  teamWrap.append(list)
}

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
  const poster = document.createElement('img')
  poster.className = 'poster'
  poster.src = '/assets/hero/compass-hero.jpg'
  poster.alt = ''
  const play = document.createElement('a')
  play.className = 'play'
  play.href = raw
  play.dataset.embed = src
  play.textContent = 'Play the demo'
  player.append(poster, play)
}
if (player && !player.querySelector('video, iframe, [data-embed]')) {
  const stop = AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined
  fetch('/api/config', { headers: { accept: 'application/json' }, signal: stop })
    .then(res => res.ok ? res.json() : null)
    .then(data => { if (data?.demoVideoUrl) mountFilm(data.demoVideoUrl) })
    .catch(() => {})
}

const form = document.querySelector('#early-access')
const status = document.querySelector('#early-access-status')
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
  const submit = form.querySelector('button[type="submit"]')
  if (submit) submit.disabled = true
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
    if (submit) submit.disabled = false
  }
})
