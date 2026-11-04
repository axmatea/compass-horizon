// COMPASS homepage: menu, word reveals, and cinematic motion.
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
const bar = document.querySelector('.bar')
const burger = document.querySelector('.burger')
const closeMenu = () => { bar?.classList.remove('open'); burger?.setAttribute('aria-expanded', 'false') }
burger?.addEventListener('click', () => { const open = bar?.classList.toggle('open'); burger.setAttribute('aria-expanded', String(Boolean(open))) })
bar?.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu))
addEventListener('keydown', e => { if (e.key === 'Escape' && bar?.classList.contains('open')) { closeMenu(); burger?.focus() } })

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
if (!reduce && 'IntersectionObserver' in window) {
  document.querySelectorAll('.reveal').forEach(el => { wi = 0; split(el) })
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) } }), { rootMargin: '0px 0px -12% 0px' })
  document.documentElement.classList.add('motion-ready')
  document.querySelectorAll('section:not(.hero) .wrap, .reveal').forEach(el => io.observe(el))
}

// Hero: the art drifts and swells as the journey begins, the copy lifts away.
const hero = document.querySelector('.hero')
if (reduce) hero?.querySelector('video')?.pause()
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
