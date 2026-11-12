// write_copy for the public site builder. One slow step writes the hero and the sections.
// With no model, or when the model fails, a prepared page is returned and labelled.
// Currency amounts, customer counts, and named people are not invented.
import { completeJson } from '../llm.mjs';

export const COPY_ARGS = Object.freeze(['business', 'kind', 'audience', 'tone', 'lang', 'hero', 'headline', 'subhead', 'cta', 'sections']);
const BRIEF = ['business', 'kind', 'audience', 'tone', 'lang'];
const LIMIT = { features: 3, products: 3, gallery: 6, testimonials: 2, pricing: 3, faq: 3 };
const S = (v, n = 160) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, n));
const titleCase = (s) => String(s || '').replace(/\b\p{L}+/gu, (word) => word.toLowerCase() === 'ai' ? 'AI' : word.charAt(0).toUpperCase() + word.slice(1));

export function copyPlan(args, previous) {
  const want = ['hero', ...(args.sections || [])];
  if (!previous?.result) return { write: want, reuse: [] };
  const previousArgs = previous.args || {};
  const same = (keys) => keys.every((key) => (args[key] ?? null) === (previousArgs[key] ?? null));
  if (!same(BRIEF)) return { write: want, reuse: [] };
  const reuse = want.filter((section) => previous.result[section] != null && (section !== 'hero' || same(['hero'])));
  return { write: want.filter((section) => !reuse.includes(section)), reuse };
}

function scrub(value) {
  return S(String(value ?? '')
    .replace(/[$€£]\s?\d[\d,]*(?:\.\d+)?(?:\s*\/\s*[A-Za-z]+)?/g, 'Custom')
    .replace(/\b\d[\d,]*\+?\s+(?:customers|users|subscribers|clients)\b/gi, 'people'), 260);
}

export function preparedCopy(args, sections) {
  const name = args.business || titleCase(args.kind || 'This project');
  const kind = args.kind || 'project';
  const warm = /warm|gold|amber/.test(`${args.tone || ''} ${args.accent || ''}`);
  const ru = args.lang === 'ru';
  const out = {};
  const heroLine = warm
    ? `${name}, with room to breathe`
    : `A clear home for ${name}`;
  for (const section of sections) {
    switch (section) {
      case 'hero':
        out.hero = {
          headline: args.headline || (ru ? `${name}` : heroLine),
          subhead: args.subhead || (ru
            ? `${titleCase(kind)}. Страница собрана для этого сеанса и никуда не публикуется.`
            : `A ${args.tone || 'clear'} page for ${titleCase(kind)}. It exists only in this preview.`),
          cta: args.cta || (warm ? 'Start here' : 'See the work'),
        };
        break;
      case 'features':
        out.features = [
          { title: warm ? 'A warmer first screen' : 'One clear promise', text: `The page says what ${kind} is for, before anything else.` },
          { title: 'Built in this session', text: 'The brief, the words, and the layout stay together while you change your mind.' },
          { title: 'Nothing published', text: 'The result is a preview. It is not deployed and it is not a live site.' },
        ];
        break;
      case 'products':
        out.products = [1, 2, 3].map((index) => ({ name: `${name} ${index}`, price: 'Custom', text: `A sample offering for ${kind}.` }));
        break;
      case 'gallery':
        out.gallery = [1, 2, 3, 4, 5, 6].map((index) => ({ caption: `Study ${index}` }));
        break;
      case 'testimonials':
        out.testimonials = [
          { quote: 'The first version stayed. Only the parts I changed were rewritten.', who: 'Sample note, written for this preview' },
          { quote: 'I asked for a lighter page and the rest of the brief held.', who: 'Sample note, written for this preview' },
        ];
        break;
      case 'pricing':
        out.pricing = [
          { plan: 'Intro', price: 'Custom', text: 'A starting conversation.', items: ['One page', 'A clear headline', 'A way to reply'] },
          { plan: 'Studio', price: 'Custom', text: 'The fuller page.', items: ['More sections', 'A warmer tone', 'Room to revise'] },
          { plan: 'Practice', price: 'Custom', text: 'For a longer engagement.', items: ['Ongoing edits', 'Shared review', 'No public launch from this preview'] },
        ];
        break;
      case 'faq':
        out.faq = [
          { q: 'Is this page live?', a: 'No. It is rendered for this session and nothing is published.' },
          { q: 'Can the direction change?', a: 'Yes. A later sentence updates the brief and only the parts that no longer fit.' },
          { q: 'Where do the words come from?', a: 'From the brief. Prepared lines stand in when a writer is not configured.' },
        ];
        break;
      case 'contact':
        out.contact = { line: `Write to ${name} when you are ready.`, email: 'hello@example.com' };
        break;
      case 'signup':
        out.signup = { headline: warm ? 'Stay close' : 'Leave a note', text: 'The form is part of the preview. It does not send anything.', cta: 'Join' };
        break;
      default:
        break;
    }
  }
  out.footer = `Preview · ${name}`;
  return out;
}

export function unwrap(value) {
  if (typeof value === 'string') {
    const text = value.trim();
    if (/^[\[{]/.test(text)) { try { return unwrap(JSON.parse(text)); } catch { return value; } }
    return value;
  }
  if (Array.isArray(value)) return value.map(unwrap);
  return value;
}

function coerce(section, value) {
  value = unwrap(value);
  const take = (list, count, map) => (Array.isArray(list) ? list.slice(0, count).map(map).filter(Boolean) : []);
  switch (section) {
    case 'hero': return value && typeof value === 'object' ? { headline: scrub(value.headline).slice(0, 90), subhead: scrub(value.subhead).slice(0, 200), cta: scrub(value.cta).slice(0, 30) } : null;
    case 'features': { const items = take(value, LIMIT.features, (item) => item && scrub(item.title) && { title: scrub(item.title).slice(0, 60), text: scrub(item.text).slice(0, 200) }); return items.length ? items : null; }
    case 'products': { const items = take(value, LIMIT.products, (item) => item && scrub(item.name) && { name: scrub(item.name).slice(0, 60), price: 'Custom', text: scrub(item.text).slice(0, 160) }); return items.length ? items : null; }
    case 'gallery': { const items = take(value, LIMIT.gallery, (item) => item && scrub(item.caption) && { caption: scrub(item.caption).slice(0, 60) }); return items.length ? items : null; }
    case 'testimonials': { const items = take(value, LIMIT.testimonials, (item) => item && scrub(item.quote) && { quote: scrub(item.quote).slice(0, 260), who: 'Sample note, written for this preview' }); return items.length ? items : null; }
    case 'pricing': { const items = take(value, LIMIT.pricing, (item) => item && scrub(item.plan) && { plan: scrub(item.plan).slice(0, 40), price: 'Custom', text: scrub(item.text).slice(0, 120), items: take(item.items, 4, (line) => scrub(line).slice(0, 60)) }); return items.length ? items : null; }
    case 'faq': { const items = take(value, LIMIT.faq, (item) => item && scrub(item.q) && { q: scrub(item.q).slice(0, 120), a: scrub(item.a).slice(0, 220) }); return items.length ? items : null; }
    case 'contact': return value && typeof value === 'object' && scrub(value.line) ? { line: scrub(value.line).slice(0, 200), email: 'hello@example.com', place: scrub(value.place).slice(0, 80) } : null;
    case 'signup': return value && typeof value === 'object' && scrub(value.headline) ? { headline: scrub(value.headline).slice(0, 80), text: scrub(value.text).slice(0, 160), cta: scrub(value.cta).slice(0, 30) } : null;
    default: return null;
  }
}

function wait(ms, signal) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => { clearTimeout(timer); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); };
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const SHAPE = {
  hero: '{"headline":"4-8 words","subhead":"one sentence, max 22 words","cta":"2-3 words"}',
  features: '[{"title":"2-4 words","text":"one sentence"}] x3',
  products: '[{"name":"name","text":"one sentence"}] x3',
  gallery: '[{"caption":"3-6 words"}] x6',
  testimonials: '[{"quote":"one sentence"}] x2',
  pricing: '[{"plan":"name","text":"max 12 words","items":["3 short lines"]}] x3',
  faq: '[{"q":"question","a":"answer"}] x3',
  contact: '{"line":"one sentence"}',
  signup: '{"headline":"3-6 words","text":"one sentence","cta":"1-3 words"}',
};

export function createSiteCopyTool({ clients = [], stepMs = 0, maxTokens = 1400 } = {}) {
  const resolveClients = () => (typeof clients === 'function' ? clients() : clients);
  async function write(args, sections, signal) {
    const ready = resolveClients();
    if (!ready.length) return null;
    const lang = args.lang === 'ru' ? 'Russian' : 'English';
    const result = await completeJson({
      clients: ready,
      maxTokens,
      signal,
      accept: (json) => sections.some((section) => coerce(section, json?.[section])),
      messages: [
        { role: 'system', content: `You write website copy. Write in ${lang}. Concrete, specific to the brief, no filler, no hype words (unlock, elevate, seamless, empower). Do not include currency amounts, customer counts, revenue, or real people's names. Use the word Custom anywhere a price would go. If mustUse gives a headline, subhead, or cta, use it. Return one JSON object whose keys are the requested sections, with these shapes:\n${JSON.stringify(Object.fromEntries(sections.map((section) => [section, SHAPE[section]])))}\nAlso add "footer": one short line with no year and no claim of publication.` },
        { role: 'user', content: JSON.stringify({ brief: { business: args.business || null, kind: args.kind, audience: args.audience || null, tone: args.tone || null, heroLayout: args.hero || null, mustUse: { headline: args.headline || undefined, subhead: args.subhead || undefined, cta: args.cta || undefined } }, sections }) },
      ],
    });
    if (!result.json) return null;
    const out = {};
    for (const section of sections) {
      const value = coerce(section, result.json[section]);
      if (value) out[section] = value;
    }
    if (!Object.keys(out).length) return null;
    out.footer = scrub(result.json.footer).slice(0, 120) || null;
    return out;
  }

  return {
    name: 'write_copy',
    description: 'Write the words of the page.',
    mock: false,
    requires: ['kind'],
    dependsOn: [...COPY_ARGS],
    argsFromIntent: (intent) => Object.fromEntries(COPY_ARGS.map((key) => [key, intent[key] ?? null])),
    async run(args, { signal, previous, localOnly = false } = {}) {
      const started = Date.now();
      const plan = copyPlan(args, previous);
      const out = { wrote: [], reused: plan.reuse, fallback: false, footer: previous?.result?.footer || null };
      for (const section of plan.reuse) out[section] = previous.result[section];
      if (!plan.write.length) { out.latencyMs = 0; return out; }
      await wait(stepMs, signal);
      let written = null;
      try { written = localOnly ? null : await write(args, plan.write, signal); }
      catch (err) { if (signal?.aborted || err?.name === 'AbortError' || err?.code === 'aborted') throw err; written = null; }
      if (!written) { Object.assign(out, preparedCopy(args, plan.write)); out.fallback = true; }
      else {
        const { footer, ...rest } = written;
        Object.assign(out, rest);
        if (footer) out.footer = footer;
      }
      for (const section of plan.write) if (out[section] == null) { Object.assign(out, preparedCopy(args, [section])); out.fallback = true; }
      out.wrote = plan.write;
      out.latencyMs = Date.now() - started;
      return out;
    },
    summarize(result, _intent, lang = 'en') {
      const names = lang === 'ru'
        ? { hero: 'шапка', features: 'преимущества', products: 'продукты', gallery: 'галерея', testimonials: 'отзывы', pricing: 'цены', faq: 'вопросы', contact: 'контакты', signup: 'подписка' }
        : { hero: 'the hero', features: 'features', products: 'products', gallery: 'the gallery', testimonials: 'testimonials', pricing: 'pricing', faq: 'the FAQ', contact: 'contact', signup: 'the signup' };
      const list = (result.wrote || []).map((section) => names[section] || section);
      const join = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
      if (result.fallback) return lang === 'ru' ? 'Стоят подготовленные тексты для этого сеанса.' : 'Prepared copy is in for this session.';
      if (!list.length) return '';
      return lang === 'ru' ? `Тексты готовы: ${join(list)}.` : `Words are in for ${join(list)}.`;
    },
  };
}
