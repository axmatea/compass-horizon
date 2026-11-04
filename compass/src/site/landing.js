// COMPASS landing: menu, word reveals, and cinematic motion. No API or provider calls.
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
document.querySelectorAll('section:not(.hero) .wrap, .reveal').forEach(el => io.observe(el))

// Hero: the art drifts and swells as the journey begins, the copy lifts away.
const hero = document.querySelector('.hero')
let queued = false
function frame() {
  queued = false
  const y = window.scrollY, vh = innerHeight
  if (hero && !reduce) {
    const t = Math.min(1, Math.max(0, y / vh))
    hero.style.setProperty('--hy', (t * 80).toFixed(1)); hero.style.setProperty('--hs', (t * .08).toFixed(3)); hero.style.setProperty('--hf', (t * 1.4).toFixed(3))
  }
}
const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(frame) } }
addEventListener('scroll', onScroll, { passive: true }); addEventListener('resize', onScroll, { passive: true })
frame()

// The film pauses when it leaves the viewport, so audio never plays over the rest of the page.
const filmEl = document.getElementById('film-video')
if (filmEl && 'IntersectionObserver' in window) new IntersectionObserver(([e]) => { if (!e.isIntersecting && !filmEl.paused) filmEl.pause() }, { threshold: 0.2 }).observe(filmEl)
