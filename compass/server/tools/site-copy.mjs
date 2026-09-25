// write_copy: the one slow action of the site domain. Writes the words for the hero and every
// section in the brief with GLM (JSON mode). Incremental by design: when the brief is unchanged
// and only sections were added, previously written sections are reused verbatim and only the new
// ones are written, so "add a product section" never rewrites the hero the user already liked.
// If the model is unreachable the tool returns clearly labelled placeholder copy (fallback: true).
import { parseJsonLoose } from '../llm/nebius.mjs';

export const COPY_ARGS = Object.freeze(['business', 'kind', 'audience', 'tone', 'lang', 'hero', 'headline', 'subhead', 'cta', 'sections']);
const BRIEF = ['business', 'kind', 'audience', 'tone', 'lang'];
const HERO_INPUTS = ['hero', 'headline', 'subhead', 'cta'];
const LIMIT = { features: 3, products: 3, gallery: 6, testimonials: 2, pricing: 3, faq: 3 };
const S = (v, n = 160) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, n));

/** Which sections a run must write vs. can reuse from the previous result of this tool. */
export function copyPlan(args, previous) {
  const want = ['hero', ...(args.sections || [])];
  if (!previous?.result) return { write: want, reuse: [] };
  const p = previous.args || {};
  const same = (keys) => keys.every((k) => (args[k] ?? null) === (p[k] ?? null));
  if (!same(BRIEF)) return { write: want, reuse: [] };
  // Dictated headline/subhead/cta are overlaid by the renderer, so only a new hero LAYOUT needs new hero words.
  const heroSame = same(['hero']);
  const reuse = want.filter((s) => previous.result[s] != null && (s !== 'hero' || heroSame));
  return { write: want.filter((s) => !reuse.includes(s)), reuse };
}

const titleCase = (s) => String(s || '').replace(/\b\p{L}/gu, (c) => c.toUpperCase());

/** Placeholder words, used only when the model fails. Always labelled (fallback: true). */
export function fallbackCopy(args, sections) {
  const name = args.business || titleCase(args.kind || 'Untitled');
  const ru = args.lang === 'ru';
  const out = {};
  for (const s of sections) {
    switch (s) {
      case 'hero': out.hero = { headline: args.headline || name, subhead: args.subhead || (ru ? `${titleCase(args.kind || '')}. Текст появится здесь.` : `${titleCase(args.kind || 'A project')}. Placeholder text until the writer answers.`), cta: args.cta || (ru ? 'Узнать больше' : 'Learn more') }; break;
      case 'features': out.features = [1, 2, 3].map((i) => ({ title: ru ? `Преимущество ${i}` : `Benefit ${i}`, text: ru ? 'Текст-заполнитель.' : 'Placeholder text.' })); break;
      case 'products': out.products = [1, 2, 3].map((i) => ({ name: ru ? `Продукт ${i}` : `Product ${i}`, price: '—', text: ru ? 'Текст-заполнитель.' : 'Placeholder text.' })); break;
      case 'gallery': out.gallery = [1, 2, 3, 4, 5, 6].map((i) => ({ caption: ru ? `Фото ${i}` : `Photo ${i}` })); break;
      case 'testimonials': out.testimonials = [1, 2].map(() => ({ quote: ru ? 'Отзыв появится здесь.' : 'A customer quote goes here.', who: ru ? 'Клиент' : 'A customer' })); break;
      case 'pricing': out.pricing = ['Basic', 'Pro', 'Team'].map((p) => ({ plan: p, price: '—', text: ru ? 'Описание тарифа.' : 'Plan description.', items: [] })); break;
      case 'faq': out.faq = [1, 2, 3].map((i) => ({ q: ru ? `Вопрос ${i}` : `Question ${i}`, a: ru ? 'Ответ появится здесь.' : 'The answer goes here.' })); break;
      case 'contact': out.contact = { line: ru ? 'Напишите нам.' : 'Get in touch.', email: `hello@${name.toLowerCase().replace(/[^a-z0-9]+/g, '')}.example` }; break;
      case 'signup': out.signup = { headline: ru ? 'Будьте на связи' : 'Stay in the loop', text: ru ? 'Оставьте email.' : 'Leave your email.', cta: ru ? 'Присоединиться' : 'Join' }; break;
      default: break;
    }
  }
  out.footer = `© ${new Date().getFullYear()} ${name}`;
  return out;
}

const SHAPE = {
  hero: '{"headline": "4-8 words", "subhead": "one sentence, max 22 words", "cta": "2-3 words"}',
  features: '[{"title": "2-4 words", "text": "one sentence, max 18 words"}] x3',
  products: '[{"name": "product name", "price": "price with currency", "text": "one sentence, max 14 words"}] x3',
  gallery: '[{"caption": "3-6 words"}] x6',
  testimonials: '[{"quote": "one or two sentences, max 28 words", "who": "Name, role or city"}] x2',
  pricing: '[{"plan": "name", "price": "e.g. $19/mo", "text": "max 12 words", "items": ["3 short bullets"]}] x3',
  faq: '[{"q": "question", "a": "answer, max 24 words"}] x3',
  contact: '{"line": "one warm sentence inviting contact", "email": "plausible email", "place": "city or address, optional"}',
  signup: '{"headline": "3-6 words", "text": "one sentence, max 16 words", "cta": "1-3 words"}',
};

/** Some models (minimax-m2.7 on General Compute) return each section as a JSON-encoded string inside the JSON object. Unwrap before coercing. */
export function unwrap(v) {
  if (typeof v === 'string') { const t = v.trim(); if (/^[\[{]/.test(t)) { try { return unwrap(JSON.parse(t)); } catch { return v; } } return v; }
  if (Array.isArray(v)) return v.map(unwrap);
  return v;
}

function coerce(section, v) {
  v = unwrap(v);
  const take = (arr, n, f) => (Array.isArray(arr) ? arr.slice(0, n).map(f).filter(Boolean) : []);
  switch (section) {
    case 'hero': return v && typeof v === 'object' ? { headline: S(v.headline, 90), subhead: S(v.subhead, 200), cta: S(v.cta, 30) } : null;
    case 'features': { const a = take(v, LIMIT.features, (x) => x && S(x.title) && { title: S(x.title, 60), text: S(x.text, 200) }); return a.length ? a : null; }
    case 'products': { const a = take(v, LIMIT.products, (x) => x && S(x.name) && { name: S(x.name, 60), price: S(x.price, 24), text: S(x.text, 160) }); return a.length ? a : null; }
    case 'gallery': { const a = take(v, LIMIT.gallery, (x) => x && S(x.caption) && { caption: S(x.caption, 60) }); return a.length ? a : null; }
    case 'testimonials': { const a = take(v, LIMIT.testimonials, (x) => x && S(x.quote) && { quote: S(x.quote, 260), who: S(x.who, 60) }); return a.length ? a : null; }
    case 'pricing': { const a = take(v, LIMIT.pricing, (x) => x && S(x.plan) && { plan: S(x.plan, 40), price: S(x.price, 30), text: S(x.text, 120), items: take(x.items, 4, (i) => S(i, 60)) }); return a.length ? a : null; }
    case 'faq': { const a = take(v, LIMIT.faq, (x) => x && S(x.q) && { q: S(x.q, 120), a: S(x.a, 220) }); return a.length ? a : null; }
    case 'contact': return v && typeof v === 'object' && S(v.line) ? { line: S(v.line, 200), email: S(v.email, 80), place: S(v.place, 80) } : null;
    case 'signup': return v && typeof v === 'object' && S(v.headline) ? { headline: S(v.headline, 80), text: S(v.text, 160), cta: S(v.cta, 30) } : null;
    default: return null;
  }
}

function buildMessages(args, sections) {
  const lang = args.lang === 'ru' ? 'Russian' : 'English';
  const shape = Object.fromEntries(sections.map((s) => [s, SHAPE[s]]));
  const brief = { business: args.business || null, kind: args.kind, audience: args.audience || null, tone: args.tone || null, heroLayout: args.hero || null,
    mustUse: Object.fromEntries(HERO_INPUTS.slice(1).filter((k) => args[k]).map((k) => [k, args[k]])) };
  return [
    { role: 'system', content: `You write website copy for a landing page. Write in ${lang}. Concrete, specific to the brief, no filler, no hype words (unlock, elevate, seamless, empower), no em dashes. Short sentences. Prices must be plausible for the business. If mustUse gives a headline, subhead or cta, use them verbatim. Return ONLY a JSON object whose keys are exactly the requested sections, with these shapes:\n${JSON.stringify(shape, null, 1)}\nAlso add "footer": one short line (copyright or tagline).` },
    { role: 'user', content: JSON.stringify({ brief, sections }) },
  ];
}

export function createSiteCopyTool({ llm = null, maxTokens = 1000, attemptTimeoutMs = 22000, now = () => Date.now() } = {}) {
  async function write(args, sections, signal) {
    if (!llm) return null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const timer = AbortSignal.timeout(attemptTimeoutMs);
      const r = await llm.chat({ messages: buildMessages(args, sections), responseFormat: { type: 'json_object' }, temperature: 0.6, maxTokens, signal: signal ? AbortSignal.any([signal, timer]) : timer });
      let parsed = null;
      try { parsed = parseJsonLoose(r.message?.content || ''); } catch { parsed = null; }
      if (!parsed) continue;
      const out = {};
      for (const s of sections) { const v = coerce(s, parsed[s]); if (v) out[s] = v; }
      if (Object.keys(out).length < sections.length) { if (attempt === 0) continue; }
      if (!Object.keys(out).length) continue;
      out.footer = S(parsed.footer, 120) || null;
      out.latencyMs = r.latencyMs;
      return out;
    }
    return null;
  }

  return {
    name: 'write_copy',
    description: 'Write the words of the page (hero and every section). Needed when a site is started, sections are added, or the business/kind/tone/audience/hero changes. Not needed for theme, accent, font or reordering.',
    mock: false,
    sideEffect: false,
    requires: ['kind'],
    dependsOn: [...COPY_ARGS],
    argsFromIntent: (intent) => Object.fromEntries(COPY_ARGS.map((k) => [k, intent[k] ?? null])),
    async run(args, { signal, previous } = {}) {
      const started = now();
      const plan = copyPlan(args, previous);
      const out = { wrote: [], reused: plan.reuse, fallback: false, footer: previous?.result?.footer || null };
      for (const s of plan.reuse) out[s] = previous.result[s];
      if (!plan.write.length) { out.latencyMs = 0; return out; }
      let written = null;
      try { written = await write(args, plan.write, signal); } catch (err) { if (signal?.aborted) throw err; written = null; }
      if (!written) { Object.assign(out, fallbackCopy(args, plan.write)); out.fallback = true; }
      else { const { latencyMs, footer, ...rest } = written; Object.assign(out, rest); if (footer) out.footer = footer; }
      // Sections the model skipped get placeholders so the page is never half empty; still labelled.
      for (const s of plan.write) if (out[s] == null) { Object.assign(out, fallbackCopy(args, [s])); out.fallback = true; }
      out.wrote = plan.write;
      out.latencyMs = now() - started;
      return out;
    },
    summarize(result, intent, lang = 'en') {
      const names = lang === 'ru'
        ? { hero: 'шапка', features: 'преимущества', products: 'продукты', gallery: 'галерея', testimonials: 'отзывы', pricing: 'цены', faq: 'вопросы', contact: 'контакты', signup: 'подписка' }
        : { hero: 'the hero', features: 'features', products: 'products', gallery: 'the gallery', testimonials: 'testimonials', pricing: 'pricing', faq: 'the FAQ', contact: 'contact', signup: 'the signup' };
      const list = (result.wrote || []).map((s) => names[s] || s);
      const join = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${lang === 'ru' ? 'и' : 'and'} ${xs[xs.length - 1]}`);
      if (result.fallback) return lang === 'ru' ? 'Автор текста не ответил, пока стоят заглушки.' : "The writer didn't answer, so those words are placeholders for now.";
      if (!list.length) return '';
      return lang === 'ru' ? `Тексты готовы: ${join(list)}.` : `Words are in for ${join(list)}.`;
    },
  };
}
