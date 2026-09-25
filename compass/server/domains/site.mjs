// Website domain: the brief is the mutable intent, write_copy is the slow action, the renderer
// turns brief + words into a page. Nothing is published, hosted or deployed: the page exists only
// in the session (and at /api/site/:id/page while the session lives).
import { createState, applyUpdate } from '../state/site.mjs';
import { renderSite } from '../site/render.mjs';
import { copyPlan } from '../tools/site-copy.mjs';

const NAMES = {
  en: { features: 'features', products: 'products', gallery: 'a gallery', testimonials: 'testimonials', pricing: 'pricing', faq: 'an FAQ', contact: 'contact', signup: 'a signup' },
  ru: { features: 'преимущества', products: 'продукты', gallery: 'галерею', testimonials: 'отзывы', pricing: 'цены', faq: 'вопросы', contact: 'контакты', signup: 'подписку' },
};
const list = (xs, lang) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${lang === 'ru' ? 'и' : 'and'} ${xs[xs.length - 1]}`);

const D = {
  en: {
    theme: (v) => `Switched to a ${v} theme.`, accent: (v) => `Accent is now ${v}.`, font: (v) => `Font: ${v}.`, hero: () => 'New hero layout.',
    business: (v) => `Now for ${v}.`, kind: (v) => `Now a ${v}.`, tone: (v) => `Tone: ${v}.`, audience: (v) => `For ${v}.`,
    headline: () => 'New headline.', subhead: () => 'New subhead.', cta: (v) => `Button: ${v}.`, lang: (v) => `Copy in ${v === 'ru' ? 'Russian' : v === 'en' ? 'English' : v}.`,
    sections: (op) => [op.added?.length && `Added ${list(op.added.map((s) => NAMES.en[s] || s), 'en')}.`, op.removed?.length && `Removed ${list(op.removed.map((s) => NAMES.en[s] || s), 'en')}.`].filter(Boolean).join(' ') || 'Sections reordered.',
  },
  ru: {
    theme: (v) => `Тема теперь ${v === 'dark' ? 'тёмная' : 'светлая'}.`, accent: (v) => `Акцент теперь ${v}.`, font: (v) => `Шрифт: ${v}.`, hero: () => 'Новая компоновка шапки.',
    business: (v) => `Теперь для ${v}.`, kind: (v) => `Теперь это ${v}.`, tone: (v) => `Тон: ${v}.`, audience: (v) => `Для ${v}.`,
    headline: () => 'Новый заголовок.', subhead: () => 'Новый подзаголовок.', cta: (v) => `Кнопка: ${v}.`, lang: (v) => `Тексты на ${v === 'ru' ? 'русском' : v === 'en' ? 'английском' : v}.`,
    sections: (op) => [op.added?.length && `Добавлено: ${list(op.added.map((s) => NAMES.ru[s] || s), 'ru')}.`, op.removed?.length && `Убрано: ${list(op.removed.map((s) => NAMES.ru[s] || s), 'ru')}.`].filter(Boolean).join(' ') || 'Секции переставлены.',
  },
};

/** Spoken summary of updated fields (only real changes, not first-time additions). */
export function describeSiteChanges(patch, lang = 'en') {
  const L = D[lang] || D.en;
  return patch
    .filter((p) => p.status === 'active' && p.change === 'updated' && L[p.field])
    .map((p) => (p.field === 'sections' ? L.sections(p) : L[p.field](p.to)))
    .join(' ');
}

// The page is rendered in a preview. It is never published, deployed or hosted for the user.
const CLAIM = { en: /\b(published|deployed|deploying|launched|went live|is live|now live|online|hosted|your domain|on the internet)\b/i, ru: /(опубликован|задеплоен|запущен|в сети|онлайн|хостинг|в интернете)/i };
export function guardSiteAck(ack, state, lang = 'en') {
  if (!(CLAIM[lang] || CLAIM.en).test(String(ack || ''))) return null;
  return lang === 'ru' ? 'Страница собрана в превью. Ничего не опубликовано.' : "It's rendered in the preview. Nothing is published.";
}

/** Sections that just changed, for the soft highlight in the page. */
function highlightFrom(patch = [], wrote = []) {
  const hi = new Set(wrote);
  for (const op of patch) {
    if (op.status !== 'active') continue;
    if (op.field === 'sections') for (const s of op.added || []) hi.add(s);
    if (['hero', 'headline', 'subhead', 'cta'].includes(op.field) && op.change === 'updated') hi.add('hero');
  }
  return [...hi];
}

/** Render the current state: latest copy, skeletons for sections still being written. */
export function renderState(state, { patch = [], wrote = [] } = {}) {
  const spec = state.intent;
  const acts = state.actions.filter((a) => a.tool === 'write_copy');
  const running = acts.find((a) => a.status === 'running' || a.status === 'pending');
  const latest = [...acts].reverse().find((a) => a.result);
  let copy = latest?.result ?? null;
  let pending = [];
  if (running) {
    const plan = copyPlan(running.args, latest ? { args: latest.args, result: latest.result } : null);
    pending = plan.write;
    copy = latest ? Object.fromEntries(Object.entries(latest.result).filter(([k]) => plan.reuse.includes(k) || k === 'footer')) : null;
    if (copy && !Object.keys(copy).some((k) => k !== 'footer')) copy = null;
  } else if (!copy && (spec.kind || spec.business)) {
    pending = ['hero', ...(spec.sections || [])];
  }
  const highlight = highlightFrom(patch, wrote);
  return { html: renderSite({ spec, copy, pending, highlight, version: state.version }), pending, highlight, placeholder: Boolean(copy?.fallback) };
}

export const siteDomain = Object.freeze({
  name: 'site',
  createState,
  applyUpdate,
  describeChanges: describeSiteChanges,
  guardAck: guardSiteAck,
  render: renderState,
  /** A site exists once the brief has a kind or a name. */
  hasContent: (state) => Boolean(state.intent.kind || state.intent.business),
});
