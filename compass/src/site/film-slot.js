/**
 * Film slot (owner: FRONTEND). The VIDEO agent delivers the final film by dropping a manifest
 * and setting data-manifest="/media/film/film.json" on #film-slot in index.html:
 *   public/media/film/film.json = { "approved": true, "src": "/media/film/compass.mp4",
 *     "poster": "/media/film/poster.jpg", "captions": "/media/film/compass.en.vtt",
 *     "width": 1080, "height": 1920, "title": "COMPASS" }
 * Missing manifest, approved !== true, or a load error => the slot stays hidden and the
 * section reads as a normal CTA scene. The video is only fetched when the scene is near.
 */
const slot = document.getElementById('film-slot')
const scene = slot?.closest('.scene')

async function manifest() {
  try {
    const url = slot.dataset.manifest
    if (!url) return null // No film announced yet: make no request, keep the console clean.
    const r = await fetch(url, { cache: 'no-store' })
    if (!r.ok) return null
    const m = await r.json()
    return m && m.approved === true && typeof m.src === 'string' ? m : null
  } catch { return null }
}

if (slot && scene) {
  manifest().then(m => {
    if (!m) return
    const video = slot.querySelector('video')
    const ratio = m.width && m.height ? `${m.width} / ${m.height}` : '9 / 16'
    slot.style.setProperty('--film-ratio', ratio)
    if (m.poster) video.poster = m.poster
    video.setAttribute('aria-label', m.title || 'COMPASS film')
    if (m.captions) {
      const track = document.createElement('track')
      Object.assign(track, { kind: 'captions', src: m.captions, srclang: 'en', label: 'English', default: true })
      video.appendChild(track)
    }
    slot.hidden = false
    scene.classList.add('has-film')
    const load = () => { if (!video.src) { video.src = m.src; video.load() } }
    video.addEventListener('loadeddata', () => slot.classList.add('is-ready'), { once: true })
    video.addEventListener('error', () => { slot.hidden = true; scene.classList.remove('has-film') }, { once: true })
    new IntersectionObserver((entries, io) => {
      if (entries.some(e => e.isIntersecting)) { load(); io.disconnect() }
    }, { rootMargin: '100% 0px' }).observe(scene)
    // Never keep playing off-screen.
    new IntersectionObserver(entries => { if (!entries[0].isIntersecting) video.pause() }, { threshold: 0.2 }).observe(slot)
  })
}
