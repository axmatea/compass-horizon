// Turn an utterance into a website-brief patch.
// A prepared reading always works. A configured model is asked first and skipped on failure.
import { completeJson, loadLlm } from '../llm.mjs';
import { SITE_FIELDS, SECTIONS, normalizeSection } from './spec.mjs';

const SECTION_PATTERNS = [
  ['features', /features?|benefits?|services?/],
  ['products', /products?|shop|menu|catalog/],
  ['gallery', /gallery|photos?|portfolio/],
  ['testimonials', /testimonials?|reviews?|quotes?/],
  ['pricing', /pricing|prices?|plans?|packages?/],
  ['faq', /faq|questions?/],
  ['contact', /contact/],
  ['signup', /sign-?up|newsletter|waitlist/],
];

function mentioned(text, pattern) {
  return pattern.test(text);
}

export function interpretLocal(state, text) {
  const intent = state?.intent || {};
  const isNew = !intent.kind && !intent.business;
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  const lower = raw.toLowerCase();
  const set = {};
  const add = [];
  const remove = [];

  if (/\b(lighter|make it light|brighten|brighter|white background)\b/.test(lower)) set.theme = 'light';
  else if (/\b(darker|dark mode|dark|noir|black|moody)\b/.test(lower) || (isNew && /\bcinematic\b/.test(lower))) set.theme = 'dark';

  if (/\bwarm/.test(lower)) { set.tone = 'warm'; set.accent = 'gold'; }
  else if (/\bpremium\b/.test(lower) && isNew) set.tone = 'premium and calm';
  if (/\bminimal\b/.test(lower)) set.font = 'sans';
  if (/\b(serif|editorial)\b/.test(lower)) set.font = 'serif';
  if (/\b(loud|brutal|display)\b/.test(lower)) set.font = 'display';

  if (/\b(split|two column)\b/.test(lower)) set.hero = 'split';
  else if (/\b(more ambitious|change the hero|different hero|new hero)\b/.test(lower)) set.hero = intent.hero === 'poster' ? 'split' : 'poster';
  else if (/\b(cinematic|poster|full-bleed|full bleed)\b/.test(lower)) set.hero = 'poster';

  const color = [
    ['emerald', /green|emerald|mint/], ['sky', /\bblue\b|azure/], ['violet', /purple|violet/],
    ['rose', /pink|rose/], ['amber', /orange|amber/], ['coral', /\bred\b|coral/], ['slate', /grey|gray|slate/],
  ];
  if (!set.accent) {
    for (const [name, pattern] of color) if (pattern.test(lower)) set.accent = name;
  }

  for (const [id, pattern] of SECTION_PATTERNS) {
    if (!mentioned(lower, pattern)) continue;
    const window = lower.slice(Math.max(0, lower.search(pattern) - 24), lower.search(pattern) + 12);
    if (/\b(remove|drop|without|delete)\b/.test(window)) remove.push(id);
    else if (/\b(add|include|with|plus|and)\b/.test(window) || isNew) add.push(id);
  }

  const named = raw.match(/\b(?:called|named)\s+["“]?([A-Za-z][\w'’-]*(?:\s+[A-Za-z][\w'’-]*){0,3})/);
  if (named) set.business = named[1];

  if (isNew) {
    const kind = raw.split(/[.!?]/)[0].match(/(?:website|site|page|landing page)\s+for\s+(?:an?\s+|my\s+|the\s+)?([^.,]+)/i)
      || raw.match(/\bfor\s+(?:an?\s+|my\s+|the\s+)([^.,]+)/i);
    set.kind = (kind ? kind[1] : 'project').replace(/\b(make it|and|with|that is)\b[\s\S]*$/i, '').trim().slice(0, 80) || 'project';
    if (/\bminimal\b/.test(lower) && !set.tone) set.tone = 'minimal';
    if (/\bcinematic\b/.test(lower) && set.tone && !/cinematic/.test(set.tone)) set.tone = `${set.tone}, cinematic`;
    else if (/\bcinematic\b/.test(lower) && !set.tone) set.tone = 'cinematic';
  }

  if (/[а-яё]/i.test(raw) || /\bin russian\b/.test(lower)) set.lang = 'ru';

  const headline = raw.match(/\bheadline (?:should say|says|is)\s+["“]?([^"”]+)["”]?/i);
  if (headline) set.headline = headline[1].trim().slice(0, 90);
  const button = raw.match(/\b(?:button|cta) (?:should say|says|is)\s+["“]?([^"”]+)["”]?/i);
  if (button) set.cta = button[1].trim().slice(0, 30);

  const copyFields = ['business', 'kind', 'audience', 'tone', 'hero', 'headline', 'subhead', 'cta'];
  const tool = (isNew || add.length || copyFields.some((key) => set[key] != null)) && (isNew || set.kind || intent.kind || set.business || intent.business) ? 'write_copy' : null;
  const bits = [];
  if (isNew) bits.push(`Building a ${set.theme === 'dark' ? 'dark ' : ''}page for ${set.kind || 'this project'}`);
  else {
    if (set.theme) bits.push(set.theme === 'light' ? 'Switching to a light theme' : 'Going darker');
    if (set.tone === 'warm') bits.push('warming the tone');
    if (set.hero) bits.push('changing the hero');
    if (add.length) bits.push(`adding ${add.join(' and ')}`);
    if (remove.length) bits.push(`removing ${remove.join(' and ')}`);
  }
  const reply = (bits.join(', ').replace(/^./, (c) => c.toUpperCase()) || 'Keeping what still holds').replace(/\.$/, '') + '.';
  return { set, unset: [], add_sections: add, remove_sections: remove, tool, reply: reply.slice(0, 180) };
}

export function validateSiteInterpretation(obj) {
  const out = { set: {}, unset: [], add_sections: [], remove_sections: [], tool: null, reply: '' };
  const source = obj && typeof obj.set === 'object' && !Array.isArray(obj.set) ? obj.set : {};
  for (const [key, value] of Object.entries(source)) if (SITE_FIELDS.includes(key) && value != null && value !== '') out.set[key] = value;
  for (const key of ['add_sections', 'remove_sections']) {
    if (Array.isArray(obj?.[key])) out[key] = obj[key].map(normalizeSection).filter((id) => id && SECTIONS.includes(id));
  }
  if (Array.isArray(obj?.unset)) out.unset = obj.unset.filter((field) => SITE_FIELDS.includes(field));
  if (obj?.tool === 'write_copy') out.tool = 'write_copy';
  if (typeof obj?.reply === 'string') out.reply = obj.reply.replace(/\b(published|deployed|launched|went live|is live)\b/gi, 'previewed').trim().slice(0, 180);
  return out;
}

function usable(parsed, intent) {
  return Boolean(parsed.reply || parsed.tool || Object.keys(parsed.set).length || parsed.add_sections.length || parsed.remove_sections.length || intent.kind);
}

export async function interpretSite({ state, text, env, fetchImpl, signal }) {
  const local = interpretLocal(state, text);
  const loaded = loadLlm(env, fetchImpl);
  if (!loaded.clients.length) return { ...local, source: 'prepared' };
  const result = await completeJson({
    clients: loaded.clients,
    maxTokens: 700,
    signal,
    accept: (json) => usable(validateSiteInterpretation(json), state?.intent || {}),
    messages: [
      { role: 'system', content: 'You update a website brief. Return one JSON object and nothing else. Keys: set (object of changed fields only), add_sections (array), remove_sections (array), unset (array), tool ("write_copy" or null), reply (one short sentence, max 18 words). Fields: business, kind, audience, tone, theme (light|dark), accent (gold|emerald|coral|sky|violet|rose|amber|slate), font (serif|sans|display), hero (centered|split|poster), headline, subhead, cta, lang. Sections: features, products, gallery, testimonials, pricing, faq, contact, signup. On a new site set kind, tone, theme, font, hero and 2 or 3 fitting sections. Later, set only what changed. Use write_copy when the site starts or when business, kind, audience, tone, hero, headline, or sections change. Use null for theme, accent, or font alone. Never say published, deployed, or launched. Do not invent a business name, a price, a customer count, or a real person.' },
      { role: 'user', content: JSON.stringify({ current: state?.intent || {}, utterance: String(text || '').slice(0, 500) }) },
    ],
  });
  if (!result.json) return { ...local, source: 'prepared' };
  const parsed = validateSiteInterpretation(result.json);
  if (!parsed.reply) parsed.reply = local.reply;
  if (!parsed.tool && (local.tool === 'write_copy') && (Object.keys(parsed.set).length || parsed.add_sections.length)) parsed.tool = 'write_copy';
  if (!Object.keys(parsed.set).length && !parsed.add_sections.length && !parsed.remove_sections.length) return { ...local, source: 'prepared' };
  return { ...parsed, source: 'model' };
}
