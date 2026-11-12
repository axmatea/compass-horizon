// Self-contained, scriptless HTML. Model strings never become markup or CSS.
import { profileFor, primaryTarget } from './design.mjs';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PALETTE = {
  gold: ['#a3864c', '#e4c887', '#735921'], emerald: ['#31836e', '#99d8c2', '#165943'], coral: ['#bd684e', '#f0bba5', '#8b3d28'],
  sky: ['#477ba7', '#adcbe9', '#245983'], violet: ['#7963b2', '#c8b9ed', '#584187'], rose: ['#b46586', '#ebbad0', '#853e60'],
  amber: ['#bd8342', '#efcf9b', '#81551c'], slate: ['#7b858b', '#c9d1d5', '#3e4b54'],
};
const FONT = {
  serif: { body: '-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif', head: '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif', weight: 500, track: '-.045em' },
  sans: { body: '-apple-system,BlinkMacSystemFont,"Inter","Helvetica Neue",Helvetica,Arial,sans-serif', head: 'inherit', weight: 600, track: '-.055em' },
  display: { body: '-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif', head: '"Avenir Next","Futura","Gill Sans",Helvetica,Arial,sans-serif', weight: 800, track: '-.06em' },
};
const DENSITY = {
  balanced: { section: 'clamp(52px,8vw,100px)', hero: 'clamp(64px,9vw,112px)', gap: '28px', card: '28px', radius: '10px' },
  airy: { section: 'clamp(72px,11vw,144px)', hero: 'clamp(88px,13vw,160px)', gap: '44px', card: '0px', radius: '3px' },
  compact: { section: 'clamp(36px,5vw,60px)', hero: 'clamp(40px,6vw,72px)', gap: '20px', card: '20px', radius: '8px' },
};
const TEXT = {
  en: { features: 'A considered approach.', products: 'The collection.', gallery: 'Selected work.', testimonials: 'What people say', pricing: 'Pricing.', faq: 'A few questions.', contact: 'Let’s talk.', signup: 'Keep in touch.', email: 'Email', name: 'Name', message: 'What do you have in mind?', send: 'Send enquiry', preview: 'Preview', note: 'Form preview · nothing is sent.', approved: 'Add an approved customer quote here.', image: 'Image placeholder', skip: 'Skip to content', choose: 'Enquire', service: 'Service', date: 'Preferred date', time: 'Preferred time', booking: 'Request a time', select: 'Choose a service', morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' },
  ru: { features: 'Продуманный подход.', products: 'Коллекция.', gallery: 'Избранные работы.', testimonials: 'Отзывы', pricing: 'Выберите свой вариант.', faq: 'Вопросы.', contact: 'Давайте поговорим.', signup: 'Будем на связи.', email: 'Электронная почта', name: 'Имя', message: 'Что у вас на уме?', send: 'Отправить запрос', preview: 'Превью', note: 'Пример формы · данные не отправляются.', approved: 'Добавьте подтверждённый отзыв клиента.', image: 'Место для изображения', skip: 'Перейти к содержанию', choose: 'Узнать подробнее', service: 'Услуга', date: 'Желаемая дата', time: 'Желаемое время', booking: 'Запросить время', select: 'Выберите услугу', morning: 'Утро', afternoon: 'День', evening: 'Вечер' },
};
const NAV = { en: { features: 'Approach', products: 'Collection', gallery: 'Work', testimonials: 'Reviews', pricing: 'Options', faq: 'Questions', contact: 'Contact', signup: 'Updates' }, ru: { features: 'Подход', products: 'Коллекция', gallery: 'Работы', testimonials: 'Отзывы', pricing: 'Варианты', faq: 'Вопросы', contact: 'Контакты', signup: 'Новости' } };
const titleCase = value => String(value || '').replace(/\b\p{L}+/gu, word => word.toLowerCase() === 'ai' ? 'AI' : word.charAt(0).toUpperCase() + word.slice(1));
const list = value => Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
const skeleton = (count = 2) => Array.from({ length: count }, (_, i) => `<span class="sk" style="width:${i % 2 ? 66 : 90}%"></span>`).join('');

// First-party layout studies reserve space for real images without pretending
// to be property photographs or client work. No external resources are loaded.
function media(profile, index = 0, ratio = '4 / 3', label = 'Image placeholder') {
  const offset = index % 3 * 18;
  const drawing = profile === 'property'
    ? `<path d="M50 280H550M110 280V116L278 64V280M278 116H482V280M134 151H250V245H134Z"/><path d="M310 148H448V220H310ZM164 280V218H220V280"/><path class="shade" d="M278 116H482V280H448V148H310V280H278Z"/>`
    : profile === 'booking'
      ? `<rect x="120" y="70" width="360" height="240" rx="8"/><path d="M120 130H480M198 54V89M402 54V89M170 176H224M273 176H327M376 176H430M170 225H224M273 225H327M376 225H430M170 274H224M273 274H327"/><rect class="shade" x="360" y="207" width="82" height="37" rx="5"/>`
      : profile === 'food'
        ? `<ellipse cx="300" cy="260" rx="167" ry="36"/><path class="shade" d="M161 236C161 117 238 85 300 85S439 117 439 236Z"/><path d="M244 104L209 207M304 88L270 215M365 105L330 207"/>`
        : `<path class="shade" d="M${156 + offset} 280V126L${300 + offset} 74L${444 - offset} 126V280Z"/><path d="M90 280H510M${156 + offset} 126L300 196L${444 - offset} 126M300 196V280M${207 + offset} 99L${390 - offset} 253"/>`;
  return `<div class="media" role="img" aria-label="${esc(label)}" style="aspect-ratio:${ratio}"><svg viewBox="0 0 600 380" aria-hidden="true" focusable="false">${drawing}</svg><span>${esc(label)}</span></div>`;
}

function hero(spec, copy, pending, profile, words, target) {
  const c = copy?.hero || {};
  const headline = spec.headline || c.headline || spec.business || titleCase(spec.kind);
  const subhead = spec.subhead || c.subhead;
  const cta = spec.cta || c.cta || words.choose;
  const eyebrow = spec.kind && titleCase(spec.kind);
  const text = pending
    ? `<p class="eyebrow">${esc(eyebrow)}</p><h1 class="skh">${skeleton(2)}</h1><p class="lead">${skeleton(2)}</p>`
    : `${eyebrow && eyebrow !== headline ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ''}<h1>${esc(headline)}</h1>${subhead ? `<p class="lead">${esc(subhead)}</p>` : ''}<a class="btn" href="#${target}">${esc(cta)} <span aria-hidden="true">↗</span></a>`;
  const layout = ['split', 'poster'].includes(spec.hero) ? spec.hero : 'centered';
  return `<header class="hero ${layout}" id="hero"><div class="copy">${text}</div>${layout === 'split' ? media(profile, 0, '5 / 4', words.image) : ''}</header>`;
}

function contactForm(profile, words) {
  const booking = profile === 'booking';
  return `<fieldset class="enquiry" aria-describedby="contact-note"><legend class="sr">${esc(booking ? words.booking : words.send)}</legend><div class="field-pair"><label>${esc(words.name)}<input name="name" autocomplete="name" placeholder="${esc(words.name)}"></label><label>${esc(words.email)}<input type="email" name="email" autocomplete="email" placeholder="${esc(words.email)}"></label></div>${booking ? `<label>${esc(words.service)}<select name="service"><option>${esc(words.select)}</option><option>${esc(words.booking)}</option></select></label><div class="field-pair"><label>${esc(words.date)}<input name="date" type="date"></label><label>${esc(words.time)}<select name="time"><option>${esc(words.morning)}</option><option>${esc(words.afternoon)}</option><option>${esc(words.evening)}</option></select></label></div>` : ''}<label>${esc(words.message)}<textarea name="message" rows="3" placeholder="${esc(words.message)}"></textarea></label><button type="button" class="btn" disabled>${esc(booking ? words.booking : words.send)}</button><p class="form-note" id="contact-note">${esc(words.note)}</p></fieldset>`;
}

function section(id, spec, copy, pending, profile, words, target) {
  const c = copy?.[id];
  const heading = id === 'products' && profile === 'property' ? (spec.lang === 'ru' ? 'Объекты.' : 'Places to explore.')
    : id === 'features' && profile === 'booking' ? (spec.lang === 'ru' ? 'Как это работает.' : 'Make it simple.')
      : id === 'contact' && profile === 'booking' ? words.booking : words[id];
  let body;
  if (id === 'features') {
    const items = pending ? [null, null, null] : list(c);
    body = `<div class="feature-grid">${items.map((item, i) => `<article class="feature"><span class="number" aria-hidden="true">0${i + 1}</span>${item ? `<h3>${esc(item.title)}</h3><p>${esc(item.text)}</p>` : `<h3>${skeleton(1)}</h3><p>${skeleton(2)}</p>`}</article>`).join('')}</div>`;
  } else if (id === 'products') {
    const items = pending ? [null, null, null] : list(c);
    body = `<div class="product-grid">${items.slice(0, 3).map((item, i) => `<article class="product">${media(profile, i, profile === 'property' ? '4 / 3' : '1 / 1', words.image)}<div class="product-copy">${item ? `<h3>${esc(item.name)}</h3><p>${esc(item.text)}</p>` : `<h3>${skeleton(1)}</h3><p>${skeleton(2)}</p>`}<span class="item-note">${esc(spec.lang === 'ru' ? 'Пример · добавьте свои данные' : profile === 'property' ? 'Listing placeholder' : 'Illustrative offering')}</span></div></article>`).join('')}</div>`;
  } else if (id === 'gallery') {
    const items = pending ? [null, null, null, null] : list(c);
    body = `<div class="gallery-grid">${items.slice(0, 6).map((item, i) => `<figure>${media(profile, i, i % 3 === 0 ? '5 / 4' : '4 / 3', words.image)}<figcaption>${item ? esc(item.caption) : skeleton(1)}</figcaption></figure>`).join('')}</div>`;
  } else if (id === 'testimonials') {
    body = `<p class="empty-copy">${esc(words.approved)}</p>`;
  } else if (id === 'pricing') {
    const items = pending ? [null, null, null] : list(c);
    body = `<div class="pricing-grid">${items.slice(0, 3).map(item => `<article class="plan">${item ? `<h3>${esc(item.plan)}</h3><p class="price">${esc(item.price || 'Custom')}</p><p>${esc(item.text)}</p><ul>${(Array.isArray(item.items) ? item.items : []).map(line => `<li>${esc(line)}</li>`).join('')}</ul>` : `<h3>${skeleton(1)}</h3><p>${skeleton(2)}</p>`}<a class="btn secondary" href="#${spec.sections?.includes('contact') ? 'contact' : target}">${esc(words.choose)}</a></article>`).join('')}</div>`;
  } else if (id === 'faq') {
    const items = pending ? [null, null, null] : list(c);
    body = `<div class="questions">${items.map(item => `<details><summary>${item ? esc(item.q) : skeleton(1)}<span aria-hidden="true">+</span></summary><p>${item ? esc(item.a) : skeleton(2)}</p></details>`).join('')}</div>`;
  } else if (id === 'contact') {
    body = `<div class="contact-layout"><div class="contact-copy">${pending ? skeleton(2) : `<p>${esc(c?.line || words.message)}</p>`}</div>${contactForm(profile, words)}</div>`;
  } else if (id === 'signup') {
    body = `<div class="signup"><div>${pending ? skeleton(2) : `<h3>${esc(c?.headline || words.signup)}</h3>${c?.text ? `<p>${esc(c.text)}</p>` : ''}`}</div><fieldset aria-describedby="signup-note"><legend class="sr">${esc(words.signup)}</legend><label class="sr" for="signup-email">${esc(words.email)}</label><input id="signup-email" type="email" autocomplete="email" placeholder="${esc(words.email)}"><button class="btn" type="button" disabled>${esc(c?.cta || words.signup)}</button><p class="form-note" id="signup-note">${esc(words.note)}</p></fieldset></div>`;
  } else return '';
  return `<section id="${id}" class="section ${id}" aria-labelledby="${id}-title"><div class="section-head"><h2 id="${id}-title">${esc(heading)}</h2></div>${body}</section>`;
}

export function renderSite({ spec, copy = null, pending = [], highlight = [], version = 0 }) {
  const lang = spec.lang === 'ru' ? 'ru' : 'en';
  const words = TEXT[lang];
  const profile = profileFor(spec).id;
  const accent = PALETTE[spec.accent] || PALETTE.slate;
  const font = FONT[spec.font] || FONT.sans;
  const density = Object.hasOwn(DENSITY, spec.density) ? spec.density : 'balanced';
  const mobile = spec.mobile === 'comfortable' ? 'comfortable' : 'standard';
  const d = DENSITY[density];
  const dark = spec.theme === 'dark';
  const sections = [...new Set((Array.isArray(spec.sections) ? spec.sections : []).filter(id => Object.hasOwn(NAV.en, id)))];
  const target = primaryTarget({ ...spec, sections });
  const brand = spec.business || titleCase(spec.kind || 'Your page');
  const nav = sections.filter(id => id !== 'signup').slice(0, 4).map(id => `<a href="#${id}">${esc(id === 'products' && profile === 'property' ? (lang === 'ru' ? 'Объекты' : 'Properties') : NAV[lang][id])}</a>`).join('');
  const pend = new Set(pending), changed = new Set(highlight);
  const vars = dark
    ? '--bg:#111315;--surface:#191c1f;--ink:#f4f4f1;--muted:#b2b8bc;--line:#363b40;--drawing:#6d777e;--wash:#242a2f;--button-ink:#111315'
    : '--bg:#fff;--surface:#f5f5f1;--ink:#191c1f;--muted:#626970;--line:#dedfdd;--drawing:#889195;--wash:#e4e7e5;--button-ink:#fff';
  return `<!doctype html>
<html lang="${lang}" data-theme="${dark ? 'dark' : 'light'}" data-version="${version}" data-profile="${profile}" data-font="${Object.hasOwn(FONT, spec.font) ? spec.font : 'sans'}" data-density="${density}" data-mobile="${mobile}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(brand)}</title>
<style>
:root{${vars};--accent:${dark ? accent[1] : accent[2]};--accent-soft:${dark ? accent[2] : accent[1]};--section-space:${d.section};--hero-space:${d.hero};--gap:${d.gap};--card-space:${d.card};--radius:${d.radius}}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:108px}body{margin:0;background:var(--bg);color:var(--ink);font-family:${font.body};font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased}h1,h2,h3,p,figure{margin:0}h1,h2,h3{font-family:${font.head};font-weight:${font.weight};letter-spacing:${font.track};line-height:1.08;text-wrap:balance;overflow-wrap:anywhere}h1{font-size:clamp(44px,7.2vw,94px);max-width:13ch}h2{font-size:clamp(30px,4.2vw,52px)}h3{font-size:22px;line-height:1.22;letter-spacing:-.025em}a{color:inherit;text-decoration:none}button,input,select,textarea{font:inherit}button,a,input,select,textarea{-webkit-tap-highlight-color:transparent}a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:5px}a:hover{text-decoration:underline;text-underline-offset:5px}.wrap{max-width:1280px;margin:auto;padding:0 clamp(20px,5vw,64px)}.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}.skip{position:absolute;left:20px;top:-100px;z-index:20;background:var(--ink);color:var(--bg);padding:12px 18px}.skip:focus{top:12px}
.site-nav{border-bottom:1px solid var(--line);background:var(--bg)}.nav-inner{max-width:1440px;margin:auto;display:flex;align-items:center;gap:28px;padding:20px clamp(20px,5vw,64px)}.brand{font-weight:650;letter-spacing:-.035em;font-size:22px;line-height:1.15;overflow-wrap:anywhere;min-width:0;max-width:38%}.nav-links{display:flex;align-items:center;gap:26px;margin-left:auto;font-size:15px;color:var(--muted)}.nav-links a{padding:8px 0;white-space:nowrap}.nav-action{flex-shrink:0}.btn{display:inline-flex;align-items:center;justify-content:center;gap:18px;min-height:48px;padding:12px 20px;border:1px solid transparent;border-radius:var(--radius);background:var(--accent);color:var(--button-ink);font-size:15px;font-weight:600;line-height:1.35;cursor:pointer;text-align:center}.btn:hover{filter:brightness(.94);text-decoration:none}.btn.secondary{background:transparent;border-color:var(--line);color:var(--ink)}.btn:disabled{cursor:default;opacity:.65}.nav-action .btn{font-size:14px;min-height:44px;padding:10px 16px}
.hero{padding:var(--hero-space) 0;position:relative}.hero .copy{min-width:0}.eyebrow{font-size:14px;color:var(--muted);margin-bottom:26px}.lead{font-size:clamp(17px,1.8vw,22px);color:var(--muted);max-width:43ch;margin:28px 0 32px;line-height:1.55}.hero.split{display:grid;grid-template-columns:minmax(0,1.04fr) minmax(0,1fr);gap:clamp(36px,5vw,80px);align-items:center}.hero.centered{text-align:center;max-width:940px;margin:auto}.hero.centered h1,.hero.centered .lead{margin-left:auto;margin-right:auto}.hero.poster{min-height:70vh;display:flex;align-items:center;border-bottom:1px solid var(--line)}.hero.poster h1{font-size:clamp(58px,10vw,132px);max-width:12ch}.hero.poster .copy{max-width:100%}.hero.poster::after{content:'';position:absolute;right:0;bottom:44px;width:18%;border-top:1px solid var(--accent)}.media{position:relative;display:grid;place-items:center;min-width:0;overflow:hidden;border-radius:var(--radius);background:var(--surface)}.media svg{width:100%;height:auto;fill:none;stroke:var(--drawing);stroke-width:1.2;stroke-linejoin:round}.media .shade{fill:var(--wash);stroke:none}.media span{position:absolute;bottom:18px;left:20px;font-size:14px;color:var(--muted)}
.section{padding:var(--section-space) 0;border-top:1px solid var(--line);scroll-margin-top:24px}.section-head{margin-bottom:clamp(28px,4vw,52px)}.feature-grid,.product-grid,.pricing-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--gap)}.feature{padding:var(--card-space);min-width:0;border-top:1px solid var(--line)}.feature .number{display:block;color:var(--accent);font-size:14px;margin-bottom:32px}.feature p,.product p,.plan>p:not(.price){font-size:16px;color:var(--muted);margin-top:14px;max-width:40ch}.product{min-width:0}.product-copy{padding-top:24px}.item-note{display:block;font-size:14px;color:var(--muted);margin-top:18px}.gallery-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:40px var(--gap)}.gallery-grid figure{min-width:0}.gallery-grid figure:nth-child(3n+2){padding-top:48px}.gallery-grid figcaption{margin-top:16px;font-size:16px}.plan{min-width:0;border:1px solid var(--line);border-radius:var(--radius);padding:28px;display:flex;flex-direction:column;align-items:flex-start}.plan:nth-child(2){border-color:var(--accent)}.price{font-size:36px;font-weight:500;letter-spacing:-.04em;margin-top:24px}.plan ul{padding-left:20px;color:var(--muted);font-size:15px;margin:22px 0 28px}.plan li+li{margin-top:8px}.plan .btn{margin-top:auto}.questions{max-width:900px}.questions details{border-top:1px solid var(--line)}.questions details:last-child{border-bottom:1px solid var(--line)}summary{padding:24px 0;cursor:pointer;display:flex;gap:32px;justify-content:space-between;align-items:center;list-style:none;font-size:18px;font-weight:500}summary::-webkit-details-marker{display:none}summary>span{color:var(--muted);font-size:22px}details[open] summary>span{transform:rotate(45deg)}.questions details p{color:var(--muted);max-width:65ch;padding:0 48px 28px 0}.empty-copy{font-size:18px;color:var(--muted);padding:24px 0}
.contact-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);gap:clamp(32px,7vw,100px)}.contact-copy>p{font-size:clamp(24px,3vw,36px);line-height:1.25;letter-spacing:-.035em;max-width:20ch}.enquiry{min-width:0;display:grid;gap:22px}fieldset{border:0;margin:0;padding:0;min-width:0}label{display:grid;gap:9px;min-width:0;font-size:14px;color:var(--muted)}input,select,textarea{min-width:0;width:100%;border:1px solid var(--line);border-radius:var(--radius);background:var(--bg);color:var(--ink);padding:13px 14px;line-height:1.4;font-size:16px}input,select{min-height:48px}textarea{resize:vertical}.field-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.enquiry .btn{justify-self:start}.form-note{font-size:14px;color:var(--muted);line-height:1.4}.signup{display:grid;grid-template-columns:1fr 1fr;gap:44px;align-items:start}.signup p{color:var(--muted);margin-top:14px}.signup fieldset{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px}.signup .form-note{grid-column:1/-1;margin:0}.foot{display:flex;justify-content:space-between;gap:24px;padding:28px 0 44px;border-top:1px solid var(--line);font-size:14px;color:var(--muted)}.foot span:first-child{color:var(--ink)}
.sk{display:block;height:.8em;margin:.35em 0;background:var(--line);border-radius:3px;animation:breathe 1.8s ease-in-out infinite}.skh .sk{height:.85em}.section[data-new],.hero[data-new]{animation:arrive .6s ease-out}@keyframes breathe{50%{opacity:.45}}@keyframes arrive{from{opacity:.5;transform:translateY(6px)}to{opacity:1;transform:none}}[data-density="airy"] .feature{border-top:0}[data-density="airy"] .hero.centered h1{max-width:16ch}[data-density="airy"] .media{background:var(--surface)}[data-density="compact"] h1{font-size:clamp(38px,6vw,72px)}[data-density="compact"] .lead{margin-top:20px;margin-bottom:24px}
@media(max-width:900px){.hero.split{grid-template-columns:1fr;gap:36px}.hero.split .copy{max-width:780px}.hero.split .media{max-height:420px;aspect-ratio:16/9!important}.feature-grid,.pricing-grid{gap:22px}.feature{padding:20px 0}.nav-links{gap:18px}.nav-inner{gap:22px}.nav-action{margin-left:auto}}
@media(max-width:640px){html{scroll-padding-top:20px}.nav-inner{flex-wrap:wrap;gap:16px 20px;padding-top:18px;padding-bottom:14px}.brand{max-width:calc(100% - 145px);font-size:20px}.nav-action{margin-left:auto}.nav-action .btn{max-width:150px}.nav-links{order:3;margin:0;width:100%;overflow-x:auto;gap:24px;padding-bottom:3px;font-size:14px}.nav-links a{min-height:36px}.hero{padding:56px 0}.hero h1{font-size:clamp(42px,11vw,62px)}.hero.poster{min-height:60vh}.hero.poster h1{font-size:clamp(52px,13vw,82px)}.hero.poster::after{display:none}.lead{font-size:18px;margin-top:22px}.eyebrow{margin-bottom:18px}.section{padding:56px 0}.feature-grid,.product-grid,.pricing-grid,.contact-layout,.signup{grid-template-columns:1fr}.feature-grid{gap:28px}.feature .number{margin-bottom:18px}.feature{padding:22px 0 0}.product-grid{gap:36px}.gallery-grid{gap:28px 18px}.gallery-grid figure:nth-child(3n+2){padding-top:0}.gallery-grid h3{font-size:18px}.gallery-grid .media span{font-size:13px;left:12px;bottom:12px}.media{min-height:160px}.hero.split .media{max-height:none;aspect-ratio:5/4!important}.plan{padding:24px}.field-pair{grid-template-columns:1fr}.signup{gap:28px}.signup fieldset{grid-template-columns:1fr}.signup .btn{justify-self:start}.contact-layout{gap:32px}.contact-copy>p{max-width:24ch}.foot{flex-direction:column;gap:8px}.questions details p{padding-right:20px}.btn{min-height:48px}.hero.centered .lead{max-width:32ch}}
@media(max-width:640px){[data-mobile="comfortable"] body{font-size:17px}[data-mobile="comfortable"] .wrap{padding-left:24px;padding-right:24px}[data-mobile="comfortable"] .hero{padding:44px 0 52px}[data-mobile="comfortable"] .hero h1{font-size:clamp(38px,10vw,54px);line-height:1.12}[data-mobile="comfortable"] .hero .btn{width:100%;max-width:420px;min-height:54px}[data-mobile="comfortable"] .hero.split .media{aspect-ratio:4/3!important}[data-mobile="comfortable"] .gallery-grid{grid-template-columns:1fr}[data-mobile="comfortable"] .gallery-grid .media span{font-size:14px}[data-mobile="comfortable"] .section{padding:48px 0}[data-mobile="comfortable"] input,[data-mobile="comfortable"] select{min-height:54px}[data-mobile="comfortable"] summary{min-height:64px;font-size:18px}[data-mobile="comfortable"] .feature p,[data-mobile="comfortable"] .product p{font-size:17px;line-height:1.7}[data-mobile="comfortable"] .enquiry .btn{width:100%;min-height:54px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*,*::before,*::after{animation:none!important;transition:none!important}}
</style></head>
<body><a class="skip" href="#main">${esc(words.skip)}</a><nav class="site-nav" aria-label="${lang === 'ru' ? 'Основная навигация' : 'Primary'}"><div class="nav-inner"><a class="brand" href="#hero">${esc(brand)}</a><div class="nav-links">${nav}</div><div class="nav-action"><a class="btn" href="#${target}">${esc(spec.cta || copy?.hero?.cta || words.choose)}</a></div></div></nav><main class="wrap" id="main">
${hero(spec, copy, pend.has('hero') || !copy?.hero, profile, words, target).replace('<header ', changed.has('hero') ? '<header data-new ' : '<header ')}
${sections.map(id => section(id, spec, copy, pend.has(id), profile, words, target).replace('<section ', changed.has(id) ? '<section data-new ' : '<section ')).join('\n')}
<footer class="foot"><span>${esc(brand)}</span><span>${esc(words.preview)} · v${version}</span></footer></main></body></html>`;
}
