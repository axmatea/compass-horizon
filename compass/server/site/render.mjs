// Deterministic renderer: site spec + copy -> one self-contained HTML document.
// No scripts, no external requests, every string escaped. The page is displayed in a sandboxed
// iframe (no allow-scripts) and served under a strict CSP by /api/site/:id/page.
// Generated content never executes code on the server or in the browser.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PALETTE = {
  gold: ['#b8933f', '#e9cf8b', '#7a5f1f'], emerald: ['#1f8a6a', '#7fd7b6', '#0f5a44'], coral: ['#e0603f', '#ffb59d', '#a03a22'],
  sky: ['#2b7bd6', '#9fcdff', '#1c4f8a'], violet: ['#6a52e6', '#bcaaff', '#3f2fa0'], rose: ['#d94d86', '#ffb2cf', '#8f2d58'],
  amber: ['#e08a1e', '#ffd07c', '#8f5410'], slate: ['#5b6b7b', '#b9c6d3', '#34414d'],
};
const FONT = {
  serif: { body: '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,"Times New Roman",serif', head: 'inherit', weight: 500, track: '-0.02em', eyebrow: 'Georgia,serif' },
  sans: { body: '-apple-system,BlinkMacSystemFont,"Inter","Helvetica Neue",Helvetica,Arial,sans-serif', head: 'inherit', weight: 640, track: '-0.035em', eyebrow: 'inherit' },
  display: { body: '"Avenir Next","Futura","Gill Sans","Trebuchet MS",Helvetica,Arial,sans-serif', head: 'inherit', weight: 760, track: '-0.04em', eyebrow: 'inherit' },
};
const TITLE = { en: { features: 'What you get', products: 'Products', gallery: 'Gallery', testimonials: 'What people say', pricing: 'Pricing', faq: 'Questions', contact: 'Contact', signup: 'Stay in the loop' },
  ru: { features: 'Что вы получаете', products: 'Продукты', gallery: 'Галерея', testimonials: 'Отзывы', pricing: 'Цены', faq: 'Вопросы', contact: 'Контакты', signup: 'Будьте на связи' } };
const NAV = { en: { features: 'Features', products: 'Products', gallery: 'Gallery', testimonials: 'Reviews', pricing: 'Pricing', faq: 'FAQ', contact: 'Contact', signup: 'Sign up' },
  ru: { features: 'Преимущества', products: 'Продукты', gallery: 'Галерея', testimonials: 'Отзывы', pricing: 'Цены', faq: 'Вопросы', contact: 'Контакты', signup: 'Подписка' } };
const WORDS = { en: { email: 'Your email', join: 'Join', send: 'Send a message', mostPopular: 'Most popular', choose: 'Choose', preview: 'Preview' },
  ru: { email: 'Ваш email', join: 'Присоединиться', send: 'Написать', mostPopular: 'Популярный', choose: 'Выбрать', preview: 'Превью' } };

const titleCase = (s) => String(s || '').replace(/\b\p{L}/gu, (c) => c.toUpperCase());

/** Abstract art tile: accent gradient + a few shapes, varied by seed. Pure CSS, no images. */
function art(seed, a, ratio = '4/3', extra = '') {
  const s = (seed * 9301 + 49297) % 233280 / 233280;
  const x = Math.round(20 + s * 60), y = Math.round(20 + ((s * 7) % 1) * 60), r = Math.round(30 + ((s * 13) % 1) * 40);
  const rot = Math.round(((s * 17) % 1) * 360);
  return `<div class="art" style="aspect-ratio:${ratio};background:radial-gradient(${r}% ${r + 10}% at ${x}% ${y}%,${a[1]} 0,transparent 70%),linear-gradient(${rot}deg,${a[0]} 0,var(--bg2) 100%);${extra}"><i style="left:${100 - x}%;top:${100 - y}%"></i></div>`;
}

function skeleton(n = 2, wide = false) {
  return Array.from({ length: n }, (_, i) => `<span class="sk" style="width:${wide ? 100 : [62, 84, 48, 74][i % 4]}%"></span>`).join('');
}

/** Hero (three layouts). */
function hero(spec, copy, pending, a, w) {
  const c = copy?.hero || {};
  const headline = spec.headline || c.headline;
  const subhead = spec.subhead || c.subhead;
  const cta = spec.cta || c.cta || w.join;
  const eyebrow = [spec.kind && titleCase(spec.kind), spec.audience && `for ${spec.audience}`].filter(Boolean).join(' · ');
  const text = pending
    ? `<p class="eyebrow">${esc(eyebrow)}</p><h1 class="skh">${skeleton(2, true)}</h1><p class="lead">${skeleton(2)}</p><a class="btn">${esc(cta)}</a>`
    : `<p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(headline || spec.business || titleCase(spec.kind))}</h1>${subhead ? `<p class="lead">${esc(subhead)}</p>` : ''}<a class="btn" href="#signup">${esc(cta)}</a>`;
  if (spec.hero === 'split') return `<header class="hero split" id="hero"><div class="copy">${text}</div>${art(1, a, '5/4')}</header>`;
  if (spec.hero === 'poster') return `<header class="hero poster" id="hero">${art(2, a, 'auto', 'position:absolute;inset:0;opacity:.55')}<div class="copy">${text}</div></header>`;
  return `<header class="hero centered" id="hero"><div class="copy">${text}</div>${art(3, a, '16/7', 'margin-top:48px')}</header>`;
}

function section(id, spec, copy, pending, a, lang) {
  const T = TITLE[lang] || TITLE.en; const W = WORDS[lang] || WORDS.en;
  const c = (copy && copy[id]) || null;
  const head = (extra = '') => `<div class="shead"><h2>${esc(T[id])}</h2>${extra}</div>`;
  let body = '';
  switch (id) {
    case 'features': {
      const items = pending || !c ? [0, 1, 2].map(() => null) : c;
      body = `<div class="grid3">${items.map((f, i) => `<div class="card"><span class="dot" style="--i:${i}"></span>${f ? `<h3>${esc(f.title)}</h3><p>${esc(f.text)}</p>` : `<h3>${skeleton(1)}</h3><p>${skeleton(2)}</p>`}</div>`).join('')}</div>`;
      break;
    }
    case 'products': {
      const items = pending || !c ? [0, 1, 2].map(() => null) : c;
      body = `<div class="grid3">${items.map((p, i) => `<div class="product">${art(10 + i, a, '1/1')}${p ? `<div class="prow"><h3>${esc(p.name)}</h3><b>${esc(p.price)}</b></div><p>${esc(p.text)}</p>` : `<div class="prow"><h3>${skeleton(1)}</h3></div><p>${skeleton(2)}</p>`}</div>`).join('')}</div>`;
      break;
    }
    case 'gallery': {
      const caps = pending || !c ? [0, 1, 2, 3, 4, 5].map(() => null) : c;
      body = `<div class="gal">${caps.slice(0, 6).map((g, i) => `<figure>${art(20 + i, a, i % 3 === 1 ? '3/4' : '4/3')}<figcaption>${g ? esc(g.caption) : skeleton(1)}</figcaption></figure>`).join('')}</div>`;
      break;
    }
    case 'testimonials': {
      const items = pending || !c ? [0, 1].map(() => null) : c;
      body = `<div class="grid2">${items.map((t) => `<blockquote>${t ? `<p>“${esc(t.quote)}”</p><footer>${esc(t.who)}</footer>` : `<p>${skeleton(3)}</p><footer>${skeleton(1)}</footer>`}</blockquote>`).join('')}</div>`;
      break;
    }
    case 'pricing': {
      const plans = pending || !c ? [0, 1, 2].map(() => null) : c;
      body = `<div class="grid3">${plans.map((p, i) => `<div class="plan${i === 1 ? ' hot' : ''}">${i === 1 ? `<span class="pill">${esc(W.mostPopular)}</span>` : ''}${p ? `<h3>${esc(p.plan)}</h3><div class="price">${esc(p.price)}</div><p>${esc(p.text)}</p><ul>${(p.items || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<h3>${skeleton(1)}</h3><div class="price">${skeleton(1)}</div><p>${skeleton(2)}</p>`}<a class="btn ghost">${esc(W.choose)}</a></div>`).join('')}</div>`;
      break;
    }
    case 'faq': {
      const qs = pending || !c ? [0, 1, 2].map(() => null) : c;
      body = `<div class="faq">${qs.map((q, i) => `<details${i === 0 ? ' open' : ''}><summary>${q ? esc(q.q) : skeleton(1)}</summary><p>${q ? esc(q.a) : skeleton(2)}</p></details>`).join('')}</div>`;
      break;
    }
    case 'contact': {
      body = `<div class="contact"><div>${pending || !c ? `<p>${skeleton(2)}</p>` : `<p>${esc(c.line)}</p>${c.email ? `<p class="mail">${esc(c.email)}</p>` : ''}${c.place ? `<p class="mail">${esc(c.place)}</p>` : ''}`}<a class="btn" href="#signup">${esc(W.send)}</a></div>${art(30, a, '3/2')}</div>`;
      break;
    }
    case 'signup': {
      body = `<div class="signup">${pending || !c ? `<h3>${skeleton(1)}</h3><p>${skeleton(2)}</p>` : `<h3>${esc(c.headline)}</h3>${c.text ? `<p>${esc(c.text)}</p>` : ''}`}<form onsubmit="return false"><input type="email" placeholder="${esc(W.email)}" aria-label="${esc(W.email)}"><button type="button" class="btn">${esc((!pending && c && c.cta) || W.join)}</button></form></div>`;
      break;
    }
    default: return '';
  }
  return `<section id="${id}" class="s ${id}">${id === 'signup' ? '' : head()}${body}</section>`;
}

/**
 * Render the site. `pending` lists section ids whose copy is still being written (skeleton),
 * `highlight` lists section ids that just changed (soft glow), `copy` is the write_copy result or null.
 */
export function renderSite({ spec, copy = null, pending = [], highlight = [], version = 0 }) {
  const lang = spec.lang === 'ru' ? 'ru' : 'en';
  const a = PALETTE[spec.accent] || PALETTE.gold;
  const f = FONT[spec.font] || FONT.sans;
  const dark = spec.theme === 'dark';
  const W = WORDS[lang]; const N = NAV[lang] || NAV.en;
  const sections = spec.sections || [];
  const pend = new Set(pending); const hi = new Set(highlight);
  const brand = spec.business || titleCase(spec.kind || 'Untitled');
  const nav = sections.filter((s) => s !== 'signup').slice(0, 4).map((s) => `<a href="#${s}">${esc(N[s])}</a>`).join('');
  const vars = dark
    ? `--bg:#0a0c11;--bg2:#12151c;--ink:#f3f4f6;--sub:#a3abb8;--line:rgba(255,255,255,.1);--card:rgba(255,255,255,.04);--btnink:#0a0c11`
    : `--bg:#f8f7f3;--bg2:#ffffff;--ink:#141618;--sub:#5d646e;--line:rgba(20,22,24,.1);--card:rgba(255,255,255,.7);--btnink:#ffffff`;
  const html = `<!doctype html>
<html lang="${lang}" data-theme="${dark ? 'dark' : 'light'}" data-version="${version}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(brand)}</title>
<style>
:root{${vars};--a:${a[0]};--a2:${a[1]};--a3:${a[2]};--r:18px}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--ink);font-family:${f.body};line-height:1.55;-webkit-font-smoothing:antialiased;overflow-x:hidden}
a{color:inherit;text-decoration:none}
h1,h2,h3{font-family:${f.head};font-weight:${f.weight};letter-spacing:${f.track};line-height:1.06}
h1{font-size:clamp(40px,6vw,76px)}
h2{font-size:clamp(26px,3.4vw,40px)}
h3{font-size:19px;letter-spacing:-.01em;line-height:1.25}
.wrap{max-width:1120px;margin:0 auto;padding:0 clamp(18px,4vw,40px)}
nav{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:26px;padding:16px clamp(18px,4vw,40px);background:color-mix(in srgb,var(--bg) 82%,transparent);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
nav .brand{font-weight:${Math.min(f.weight + 60, 800)};letter-spacing:.02em;display:flex;align-items:center;gap:10px}
nav .brand i{width:10px;height:10px;border-radius:50%;background:linear-gradient(135deg,var(--a2),var(--a));box-shadow:0 0 12px var(--a2)}
nav .links{display:flex;gap:22px;margin-left:auto;font-size:14px;color:var(--sub)}
nav .links a:hover{color:var(--ink)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:13px 22px;border-radius:999px;background:var(--a);color:var(--btnink);font-weight:600;font-size:15px;border:1px solid transparent;transition:transform .15s,box-shadow .25s;box-shadow:0 10px 30px -14px var(--a)}
.btn:hover{transform:translateY(-1px);box-shadow:0 14px 34px -14px var(--a)}
.btn.ghost{background:transparent;color:var(--ink);border-color:var(--line)}
nav .btn{padding:9px 16px;font-size:13px}
.eyebrow{font-family:${f.eyebrow};font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:var(--a);margin-bottom:22px;font-weight:600}
.lead{font-size:clamp(17px,1.6vw,21px);color:var(--sub);max-width:56ch;margin:22px 0 34px}
.hero{position:relative;padding:clamp(56px,9vw,120px) 0 clamp(40px,6vw,80px)}
.hero.centered{text-align:center}.hero.centered .copy{max-width:820px;margin:0 auto}.hero.centered .lead{margin-left:auto;margin-right:auto}.hero.centered h1{margin:0 auto}
.hero.split{display:grid;grid-template-columns:1.1fr .9fr;gap:clamp(28px,5vw,72px);align-items:center}
.hero.poster{min-height:78vh;display:flex;align-items:flex-end;overflow:hidden;border-radius:var(--r);padding:clamp(40px,7vw,90px);margin-top:24px}
.hero.poster .copy{position:relative;max-width:760px}
.hero.poster .art i{opacity:.3}
.art{position:relative;overflow:hidden;border-radius:var(--r);border:1px solid var(--line)}
.art i{position:absolute;width:38%;aspect-ratio:1;border-radius:50%;border:1px solid var(--a2);opacity:.55;transform:translate(-50%,-50%);box-shadow:inset 0 0 60px color-mix(in srgb,var(--a2) 35%,transparent)}
.art::after{content:'';position:absolute;inset:auto 6% 8% auto;width:26%;height:2px;background:linear-gradient(90deg,transparent,var(--a2));opacity:.7}
.s{padding:clamp(44px,7vw,96px) 0;border-top:1px solid var(--line)}
.shead{display:flex;align-items:baseline;justify-content:space-between;gap:20px;margin-bottom:clamp(24px,3vw,40px)}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.grid2{display:grid;grid-template-columns:repeat(2,1fr);gap:20px}
.card{padding:26px;border:1px solid var(--line);border-radius:var(--r);background:var(--card);backdrop-filter:blur(8px)}
.card .dot{display:block;width:12px;height:12px;border-radius:50%;background:linear-gradient(135deg,var(--a2),var(--a));margin-bottom:22px;box-shadow:0 0 14px color-mix(in srgb,var(--a2) 60%,transparent)}
.card p,.product p,.plan p,blockquote p,.faq p,.contact p{color:var(--sub);font-size:15.5px;margin-top:10px}
.product{display:grid;gap:12px}
.prow{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.prow b{color:var(--a);font-size:15px;white-space:nowrap}
.gal{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.gal figure{display:grid;gap:8px}.gal figcaption{font-size:13px;color:var(--sub)}
blockquote{padding:28px;border:1px solid var(--line);border-radius:var(--r);background:var(--card)}
blockquote p{font-size:19px;color:var(--ink);line-height:1.45;margin:0}
blockquote footer{margin-top:18px;font-size:13px;color:var(--sub);letter-spacing:.04em}
.plan{position:relative;padding:28px;border:1px solid var(--line);border-radius:var(--r);background:var(--card);display:grid;gap:12px;align-content:start}
.plan.hot{border-color:var(--a);box-shadow:0 30px 60px -40px var(--a)}
.plan .pill{position:absolute;top:-12px;left:24px;padding:4px 10px;border-radius:999px;background:var(--a);color:var(--btnink);font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:700}
.price{font-size:38px;font-weight:${f.weight};letter-spacing:-.03em}
.plan ul{list-style:none;display:grid;gap:8px;font-size:14.5px;color:var(--sub)}
.plan li::before{content:'—';color:var(--a);margin-right:8px}
.faq{display:grid;gap:10px;max-width:820px}
details{border:1px solid var(--line);border-radius:14px;padding:16px 20px;background:var(--card)}
summary{cursor:pointer;font-weight:600;list-style:none;display:flex;justify-content:space-between;align-items:center}
summary::after{content:'+';color:var(--a);font-size:20px}details[open] summary::after{content:'–'}
.contact{display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:center}
.contact p{font-size:18px;color:var(--ink)}.contact .mail{color:var(--a);font-size:15px;margin-top:6px}.contact .btn{margin-top:24px}
.signup{text-align:center;max-width:640px;margin:0 auto;padding:clamp(28px,5vw,56px);border:1px solid var(--line);border-radius:calc(var(--r) + 6px);background:radial-gradient(80% 120% at 50% 0,color-mix(in srgb,var(--a) 14%,transparent),transparent 70%),var(--card)}
.signup h3{font-size:clamp(24px,3vw,34px)}
.signup p{color:var(--sub);margin:12px 0 0}
.signup form{display:flex;gap:10px;margin-top:26px}
.signup input{flex:1;min-width:0;padding:13px 16px;border-radius:999px;border:1px solid var(--line);background:var(--bg2);color:var(--ink);font:inherit;font-size:15px}
footer.foot{padding:36px 0 56px;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:20px;font-size:13px;color:var(--sub)}
.sk{display:inline-block;height:.85em;border-radius:6px;background:linear-gradient(90deg,var(--line),color-mix(in srgb,var(--sub) 25%,transparent),var(--line));background-size:200% 100%;animation:sk 1.6s linear infinite;vertical-align:middle;margin:.18em 0}
h1 .sk,.skh .sk{height:.9em}
@keyframes sk{to{background-position:-200% 0}}
[data-new]{animation:glow 2.6s ease-out 1}
@keyframes glow{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--a) 0%,transparent);background-color:color-mix(in srgb,var(--a) 14%,transparent)}25%{box-shadow:0 0 0 6px color-mix(in srgb,var(--a) 22%,transparent)}100%{box-shadow:0 0 0 0 transparent;background-color:transparent}}
.s[data-new],.hero[data-new]{border-radius:var(--r)}
@media(max-width:820px){.hero.split,.grid3,.grid2,.contact{grid-template-columns:1fr}.gal{grid-template-columns:1fr 1fr}nav .links{display:none}.hero.poster{min-height:60vh}}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
</head>
<body>
<nav><a class="brand" href="#hero"><i></i>${esc(brand)}</a><div class="links">${nav}</div><a class="btn" href="#signup">${esc(spec.cta || copy?.hero?.cta || W.join)}</a></nav>
<main class="wrap">
${hero(spec, copy, pend.has('hero') || !copy?.hero, a, W).replace('<header ', hi.has('hero') ? '<header data-new ' : '<header ')}
${sections.map((id) => section(id, spec, copy, pend.has(id), a, lang).replace('<section ', hi.has(id) ? '<section data-new ' : '<section ')).join('\n')}
<footer class="foot"><span>${esc(copy?.footer || `© ${new Date().getFullYear()} ${brand}`)}</span><span>${esc(W.preview)} · v${version}</span></footer>
</main>
</body>
</html>`;
  return html;
}
