/* COMPASS home. One inline SVG virtual office, eight scroll beats, no libraries.
   Scroll sets data-beat (exact beat) and cumulative at-N classes on #stage.
   CSS does all motion with opacity, transform and stroke-dashoffset. */

const rm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const FY0 = 150, FY1 = 500, LIFT = 18, NODE_Y = 598

// Plan (x 0..1000, y 0..600) to a gentle 3/4 view.
const P = (x, y) => { const t = y / 600, s = 0.8 + 0.22 * t; return [600 + (x - 500) * s, FY0 + (FY1 - FY0) * t] }
const f = n => Math.round(n * 10) / 10
const pts = a => a.map(([x, y]) => f(x) + ',' + f(y)).join(' ')
const tw = (s, fs) => s.length * fs * 0.62
const up = ([x, y], h) => [x, y - h]
const ln = (a, b, c) => `<line class="${c}" x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}"/>`

const PEOPLE = [
  { id: 'sam', name: 'Sam', row: 0, col: 0, skin: '#e3c09e', wear: '#bfae93', chips: ['Q4 budget', 'Invoices'] },
  { id: 'iris', name: 'Iris', row: 0, col: 1, skin: '#c7976f', wear: '#d4c3a6', chips: ['Brand refresh', 'Moodboard'] },
  { id: 'noah', name: 'Noah', row: 0, col: 2, skin: '#9b7152', wear: '#958a7c', chips: ['Vendor contracts', 'Logistics'] },
  { id: 'maya', name: 'Maya', row: 1, col: 0, skin: '#eed2b6', wear: '#c9a47c', hot: true, node: 'Documents', act: 'Maya moves press to Oct 1', chips: ['Press plan', 'Launch email'] },
  { id: 'leo', name: 'Leo', row: 1, col: 1, skin: '#b98865', wear: '#857a6c', hot: true, node: 'Tasks', act: 'Leo freezes Sep 29', chips: ['Build schedule', 'Beta invites'] },
  { id: 'ana', name: 'Ana', row: 1, col: 2, skin: '#8c6147', wear: '#dccbb0', hot: true, node: 'Meetings', act: 'Ana confirms with the client today', chips: ['Client call Tue', 'Launch date'] },
]
const HOT = PEOPLE.filter(p => p.hot)
const NODES = [['Conversations', 150], ['Documents', 330], ['Tasks', 510], ['Decisions', 690], ['Meetings', 870], ['Relationships', 1050]]
const nodeX = n => NODES.find(d => d[0] === n)[1]

const LABELS = [
  'Beat 1 of 8. A virtual office, six desks shown as an example. Maya, Leo, Ana, Sam, Iris and Noah each hold their own context.',
  'Beat 2 of 8. Thin amber lines connect Maya’s press plan, Leo’s build schedule and Ana’s client call.',
  'Beat 3 of 8. The floor turns to glass over one shared memory: conversations, documents, tasks, decisions, meetings, relationships.',
  'Beat 4 of 8. A change arrives: Client moved launch to Oct 3.',
  'Beat 5 of 8. The dependency lines to Maya, Leo and Ana brighten.',
  'Beat 6 of 8. Only Maya, Leo and Ana light up. Sam, Iris and Noah keep working.',
  'Beat 7 of 8. Next actions: Maya moves press to Oct 1. Leo freezes Sep 29. Ana confirms with the client today.',
  'Beat 8 of 8. A timeline from week 1 to week 12. Older weeks compress into one context bead.',
]
const SUMMARY = 'A virtual office above one shared memory. A change reaches only Maya, Leo and Ana, and twelve weeks compress into context.'

const at = p => {
  const dx = [190, 500, 810][p.col], dy = p.row ? 430 : 150
  const [hx, fy] = P(dx, dy - 58)
  return { dx, dy, hx, hy: fy - 70, chipX: hx + 25 }
}
const chipW = c => tw(c, 13.5) + 26

function defs(uid) {
  const fl = pts([P(0, 0), P(1000, 0), P(1000, 600), P(0, 600)])
  return `<defs>
<linearGradient id="${uid}-oak" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ebdfc8"/><stop offset="1" stop-color="#d9c4a1"/></linearGradient>
<linearGradient id="${uid}-glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".72"/><stop offset="1" stop-color="#fff" stop-opacity=".22"/></linearGradient>
<linearGradient id="${uid}-sheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".45" stop-color="#fff" stop-opacity=".5"/><stop offset=".6" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<linearGradient id="${uid}-mem" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#efe8da"/><stop offset="1" stop-color="#e3d8c4"/></linearGradient>
<radialGradient id="${uid}-light"><stop offset="0" stop-color="#fffbf2" stop-opacity=".85"/><stop offset="1" stop-color="#fffbf2" stop-opacity="0"/></radialGradient>
<radialGradient id="${uid}-shadow"><stop offset="0" stop-color="#6b5234" stop-opacity=".26"/><stop offset="1" stop-color="#6b5234" stop-opacity="0"/></radialGradient>
<radialGradient id="${uid}-halo"><stop offset="0" stop-color="#fff8e8" stop-opacity="1"/><stop offset="1" stop-color="#fff8e8" stop-opacity="0"/></radialGradient>
<radialGradient id="${uid}-amber"><stop offset="0" stop-color="#e3a44b" stop-opacity=".5"/><stop offset="1" stop-color="#e3a44b" stop-opacity="0"/></radialGradient>
<clipPath id="${uid}-fclip"><polygon points="${fl}"/></clipPath>
</defs>`
}

function memory(uid) {
  const MB = 250, MF = 680
  const mp = (u, v) => { const y = MB + (MF - MB) * v, h = 430 + 130 * v; return [600 - h + 2 * h * u, y] }
  let s = `<polygon class="o-memfloor" points="${pts([mp(0, 0), mp(1, 0), mp(1, 1), mp(0, 1)])}" fill="url(#${uid}-mem)"/>`
  for (let i = 1; i < 12; i++) s += ln(mp(i / 12, 0), mp(i / 12, 1), 'o-grid')
  for (let j = 1; j < 8; j++) s += ln(mp(0, j / 8), mp(1, j / 8), 'o-grid')
  s += `<line class="o-base" x1="150" y1="${NODE_Y}" x2="1050" y2="${NODE_Y}"/>`
  s += `<path class="o-chain" pathLength="1" d="M330 ${NODE_Y}H870"/>`
  s += NODES.map(([name, x]) => {
    const ticks = [-10, -5, 0, 5, 10].map((t, k) => `<line class="tick" x1="${t}" y1="41" x2="${t}" y2="${45 + (k % 3) * 2}"/>`).join('')
    return `<g class="o-node" transform="translate(${x} ${NODE_Y})">${name === 'Decisions' ? '<circle class="ring" r="20"/>' : ''}<circle class="dot" r="10"/><circle class="core" r="3.6"/><text class="o-node-t" y="31" text-anchor="middle">${name}</text>${ticks}</g>`
  }).join('')
  return `<g class="o-mem">${s}</g>`
}

function unit(p, i, uid) {
  const { dx, dy, hx, hy } = at(p), H = 20
  const b0 = P(dx - 85, dy - 32), b1 = P(dx + 85, dy - 32), f1 = P(dx + 85, dy + 32), f0 = P(dx - 85, dy + 32)
  const [cx, cy] = P(dx, dy)
  const sTop = hy + 17, sBot = b0[1] - H + 8
  const l0 = up(P(dx + 28, dy - 16), H), l1 = up(P(dx + 70, dy - 16), H), l2 = up(P(dx + 70, dy + 10), H), l3 = up(P(dx + 28, dy + 10), H)
  const body = `M${f(hx - 27)} ${f(sBot)}C${f(hx - 27)} ${f(sTop + 10)} ${f(hx - 18)} ${f(sTop)} ${f(hx)} ${f(sTop)}C${f(hx + 18)} ${f(sTop)} ${f(hx + 27)} ${f(sTop + 10)} ${f(hx + 27)} ${f(sBot)}Z`
  return `<g class="unit ${p.hot ? 'hot' : 'quiet'}">`
    + `<ellipse cx="${f(cx)}" cy="${f(cy + 8)}" rx="${f((f1[0] - f0[0]) * 0.62)}" ry="28" fill="url(#${uid}-shadow)"/>`
    + `<ellipse class="halo" style="--hd:${(-i * 0.85).toFixed(2)}s" cx="${f(hx)}" cy="${f(hy + 18)}" rx="78" ry="58" fill="url(#${uid}-halo)"/>`
    + (p.hot ? `<ellipse class="halo-a" cx="${f(hx)}" cy="${f(hy + 18)}" rx="86" ry="62" fill="url(#${uid}-amber)"/>` : '')
    + `<path class="o-body" fill="${p.wear}" d="${body}"/>`
    + `<circle class="o-head" fill="${p.skin}" cx="${f(hx)}" cy="${f(hy)}" r="13.5"/>`
    + `<polygon class="o-desk-top" points="${pts([up(b0, H), up(b1, H), up(f1, H), up(f0, H)])}"/>`
    + `<polygon class="o-desk-front" points="${pts([up(f0, H), up(f1, H), f1, f0])}"/>`
    + `<polygon class="o-screen" points="${pts([l0, l1, up(l1, 17), up(l0, 17)])}"/>`
    + `<polygon class="o-laptop" points="${pts([l0, l1, l2, l3])}"/>`
    + `<text class="o-name" x="${f(hx - 24)}" y="${f(hy + 5)}" text-anchor="end">${p.name}</text>`
    + `</g>`
}

function chips(p) {
  const { hy, chipX: x } = at(p)
  return `<g class="chips ${p.hot ? 'hot' : 'quiet'}">` + p.chips.map((c, i) => {
    const y = hy - 40 + i * 31, w = chipW(c), key = p.hot && i === 0
    const r = cls => `<rect class="${cls}" x="${f(x)}" y="${f(y)}" width="${f(w)}" height="26" rx="13"/>`
    return `<g class="chip${key ? ' key' : ''}">${r('o-chip')}${key ? r('hi') : ''}<text class="o-chip-t" x="${f(x + w / 2)}" y="${f(y + 17.5)}" text-anchor="middle">${c}</text></g>`
  }).join('') + `</g>`
}

function links() {
  let s = ''
  for (let i = 0; i < HOT.length - 1; i++) {
    const a = at(HOT[i]), b = at(HOT[i + 1])
    const A = [a.chipX + chipW(HOT[i].chips[0]), a.hy - 27], B = [b.chipX, b.hy - 27]
    s += `<path class="o-link" pathLength="1" d="M${f(A[0])} ${f(A[1])}C${f(A[0] + 50)} ${f(A[1] - 12)} ${f(B[0] - 50)} ${f(B[1] - 12)} ${f(B[0])} ${f(B[1])}"/>`
  }
  return s
}

function routes() {
  return HOT.map(p => {
    const { dx, dy } = at(p), [x, y] = P(dx, dy + 32), nx = nodeX(p.node), ny = NODE_Y + LIFT - 11
    const d = `M${f(x)} ${f(y + 2)}C${f(x)} ${f(y + 62)} ${nx} ${f(ny - 70)} ${nx} ${f(ny)}`
    return `<path class="o-route" pathLength="1" d="${d}"/><g class="o-route-hi"><path class="glow" d="${d}"/><path class="core" d="${d}"/></g>`
  }).join('')
}

function acts() {
  return HOT.map((p, i) => {
    const { dx, dy } = at(p), [x] = P(dx, dy + 32), w = tw(p.act, 14) + 36, y = 436
    return `<g class="o-act" style="--ad:${(i * 0.14).toFixed(2)}s"><rect x="${f(x - w / 2)}" y="${y}" width="${f(w)}" height="50" rx="13"/><text class="o-act-k" x="${f(x)}" y="${y + 19}" text-anchor="middle">NEXT ACTION</text><text class="o-act-t" x="${f(x)}" y="${y + 38}" text-anchor="middle">${p.act}</text></g>`
  }).join('')
}

const notes = () => PEOPLE.filter(p => !p.hot).map(p => {
  const { hx, hy } = at(p)
  return `<text class="o-keeps" x="${f(hx - 24)}" y="${f(hy + 24)}" text-anchor="end">keeps working</text>`
}).join('')

function office(uid) {
  const fl = [P(0, 0), P(1000, 0), P(1000, 600), P(0, 600)], W = 80
  let walls = `<polygon class="o-glass" points="${pts([P(0, 0), P(1000, 0), up(P(1000, 0), W), up(P(0, 0), W)])}" fill="url(#${uid}-glass)"/>`
  walls += `<polygon class="o-glass" points="${pts([P(0, 600), P(0, 0), up(P(0, 0), W), up(P(0, 600), W)])}" fill="url(#${uid}-glass)"/>`
  for (let k = 1; k < 8; k++) walls += ln(P(k * 125, 0), up(P(k * 125, 0), W), 'o-mull')
  for (let k = 1; k < 5; k++) walls += ln(P(0, k * 120), up(P(0, k * 120), W), 'o-mull')
  walls += ln(up(P(0, 600), W), up(P(0, 0), W), 'o-rail') + ln(up(P(0, 0), W), up(P(1000, 0), W), 'o-rail')
  let planks = ''
  for (let k = 1; k < 20; k++) planks += ln(P(k * 50, 0), P(k * 50, 600), 'o-plank')
  const a = P(0, 600), b = P(1000, 600)
  const slab = [a, b, [b[0], b[1] + 14], [a[0], a[1] + 14]]
  const back = PEOPLE.filter(p => p.row === 0), front = PEOPLE.filter(p => p.row === 1)
  return `<g class="o-office">`
    + `<polygon class="o-slab" points="${pts(slab)}"/>`
    + `<polygon class="o-floor" points="${pts(fl)}" fill="url(#${uid}-oak)"/>`
    + `<g class="o-planks">${planks}</g>`
    + `<ellipse class="o-light" cx="600" cy="330" rx="470" ry="190" fill="url(#${uid}-light)" clip-path="url(#${uid}-fclip)"/>`
    + `<polygon class="o-sheen" points="${pts(fl)}" fill="url(#${uid}-sheen)"/>`
    + walls
    + `<g class="o-routes">${routes()}</g>`
    + back.map((p, i) => unit(p, i, uid)).join('')
    + front.map((p, i) => unit(p, i + 3, uid)).join('')
    + PEOPLE.map(chips).join('')
    + `<g class="o-notes">${notes()}</g>`
    + `<g class="o-links">${links()}</g>`
    + `<g class="o-acts">${acts()}</g>`
    + `</g>`
}

function change() {
  const t = 'Client moved launch to Oct 3', w = tw(t, 17) + 64, x = 600 - w / 2
  return `<g class="o-change"><rect x="${f(x)}" y="12" width="${f(w)}" height="56" rx="16"/><circle class="o-change-dot" cx="${f(x + 24)}" cy="40" r="4.5"/><text class="o-change-k" x="600" y="33" text-anchor="middle">CHANGE</text><text class="o-change-t" x="600" y="56" text-anchor="middle">${t}</text></g>`
}

function timeline() {
  const X0 = 130, X1 = 1070, Y = 722, n = 12, step = (X1 - X0) / (n - 1)
  let s = `<path class="o-tline" pathLength="1" d="M${X0} ${Y}H${X1}"/>`
  for (let i = 0; i < n; i++) {
    const x = X0 + i * step
    s += `<circle class="bead ${i < 8 ? 'old' : 'new'}" cx="${f(x)}" cy="${Y}" r="5" style="--d:${(0.25 + i * 0.07).toFixed(2)}s;--dx:${f(X0 - x)}px"/>`
  }
  s += `<circle class="ctx" cx="${X0}" cy="${Y}" r="10"/><text class="o-ctx-t" x="${X0}" y="${Y - 18}" text-anchor="middle">context</text>`
  s += `<text class="o-week" x="${X0}" y="${Y + 28}" text-anchor="middle">Week 1</text><text class="o-week" x="${X1}" y="${Y + 28}" text-anchor="middle">Week 12</text>`
  return `<g class="o-time">${s}</g>`
}

function mount(host, uid, vb) {
  if (!host) return null
  host.innerHTML = `<svg class="office-svg" xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" preserveAspectRatio="xMidYMid meet" focusable="false">${defs(uid)}${memory(uid)}${office(uid)}${change()}${timeline()}</svg>`
  return host.querySelector('svg')
}

// Hero: the same office, beat 1, softly lit and decorative.
const heroSvg = mount(document.getElementById('hero-scene'), 'h', '40 36 1120 490')
if (heroSvg) heroSvg.setAttribute('aria-hidden', 'true')

// Story
const stage = document.getElementById('stage')
const story = document.getElementById('story')
const svg = mount(document.getElementById('story-scene'), 's', '0 0 1200 760')

if (stage && story && svg) {
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', LABELS[0])
  const copies = [...stage.querySelectorAll('.beat')]
  const dots = [...stage.querySelectorAll('.dots button')]
  let cur = 0, inView = false, ticking = false, timer = 0

  const setBeat = n => {
    if (n === cur) return
    cur = n
    stage.dataset.beat = String(n)
    for (let i = 1; i <= 8; i++) stage.classList.toggle('at-' + i, i <= n)
    copies.forEach((c, i) => c.classList.toggle('is-active', i === n - 1))
    dots.forEach((d, i) => (i === n - 1 ? d.setAttribute('aria-current', 'step') : d.removeAttribute('aria-current')))
    svg.setAttribute('aria-label', LABELS[n - 1])
    clearTimeout(timer)
    stage.classList.remove('compress')
    if (n === 8) timer = setTimeout(() => stage.classList.add('compress'), 1500)
  }

  if (rm) {
    document.documentElement.classList.add('rm')
    setBeat(8)
    clearTimeout(timer)
    stage.classList.add('compress')
    copies.forEach(c => c.classList.add('is-active'))
    svg.setAttribute('aria-label', SUMMARY)
  } else {
    const measure = () => {
      ticking = false
      const total = Math.max(1, story.offsetHeight - window.innerHeight)
      const p = Math.min(1, Math.max(0, -story.getBoundingClientRect().top / total))
      stage.style.setProperty('--progress', p.toFixed(4))
      setBeat(Math.min(8, Math.floor(p * 8) + 1))
    }
    const onScroll = () => { if (inView && !ticking) { ticking = true; requestAnimationFrame(measure) } }
    new IntersectionObserver(([e]) => { inView = e.isIntersecting; onScroll() }).observe(story)
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    setBeat(1)
    dots.forEach((d, i) => d.addEventListener('click', () => {
      const total = story.offsetHeight - window.innerHeight
      const top = story.getBoundingClientRect().top + window.scrollY + total * (i + 0.5) / 8
      window.scrollTo({ top, behavior: 'smooth' })
    }))
  }
}

// In-page links scroll smoothly (instant with reduced motion) and move focus.
document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('a[href^="#"]')
  if (!a) return
  const t = document.getElementById(a.getAttribute('href').slice(1))
  if (!t) return
  e.preventDefault()
  t.scrollIntoView({ behavior: rm ? 'auto' : 'smooth', block: 'start' })
  if (t.tabIndex >= 0 || t.hasAttribute('tabindex')) t.focus({ preventScroll: true })
})

// The office proof link appears only when /office is live (and is not a fallback to this page).
const officeItem = document.getElementById('proof-office')
if (officeItem) {
  fetch('/office', { method: 'HEAD', cache: 'no-store' }).then(async res => {
    if (!res.ok) return
    const html = await fetch('/office', { cache: 'no-store' }).then(r => (r.ok ? r.text() : '')).catch(() => '')
    if (html && !html.includes('data-page="compass-home"')) officeItem.hidden = false
  }).catch(() => {})
}
