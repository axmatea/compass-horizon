// Mutable site brief ("spec"): the structured intent behind a website the user describes by voice.
// Same discipline as the dinner intent (server/state/intent.mjs): pure functions, every update
// returns a new state, only fields explicitly present in `set`/`unset`/`add_sections`/`remove_sections`
// can change, everything else is kept. Patch shape is contract v1: [{ field, from, to, status, change? }],
// with `added`/`removed` lists on the `sections` op.
//
// State shape (state.intent is the spec; action/history/version fields are shared with the runtime):
//   intent: { business, kind, audience, tone, theme, accent, font, hero, sections, headline, subhead, cta, lang }

export const SITE_FIELDS = Object.freeze(['business', 'kind', 'audience', 'tone', 'theme', 'accent', 'font', 'hero', 'sections', 'headline', 'subhead', 'cta', 'lang']);
export const SECTIONS = Object.freeze(['features', 'products', 'gallery', 'testimonials', 'pricing', 'faq', 'contact', 'signup']);
export const THEMES = Object.freeze(['light', 'dark']);
export const ACCENTS = Object.freeze(['gold', 'emerald', 'coral', 'sky', 'violet', 'rose', 'amber', 'slate']);
export const FONTS = Object.freeze(['serif', 'sans', 'display']);
export const HEROES = Object.freeze(['centered', 'split', 'poster']);
/** Design fields that get a default the moment a site exists (so the brief shows them and later changes read as updates). */
const DESIGN_DEFAULTS = Object.freeze({ theme: 'light', accent: 'gold', font: 'sans', hero: 'centered', tone: 'clear and confident' });
const DEFAULT_SECTIONS = Object.freeze(['features', 'signup']);
const MAX_LEN = 140;

export function createState(sessionId) {
  return {
    sessionId,
    version: 0,
    status: 'idle',
    intent: Object.fromEntries(SITE_FIELDS.map((f) => [f, null])),
    actions: [],
    history: [],
    updatedAt: new Date().toISOString(),
  };
}

// ---------- normalization ----------

function clean(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/\s+/g, ' ').trim().slice(0, MAX_LEN);
  return s || null;
}
const lower = (raw) => { const s = clean(raw); return s ? s.toLowerCase() : null; };

const THEME_WORDS = { dark: /dark|darker|black|night|noir|moody/, light: /light|lighter|bright|white|clean|day/ };
export function normalizeTheme(raw) {
  const s = lower(raw);
  if (!s) return null;
  if (THEMES.includes(s)) return s;
  for (const [k, re] of Object.entries(THEME_WORDS)) if (re.test(s)) return k;
  return null;
}

const ACCENT_WORDS = [
  ['emerald', /emerald|green|mint|sage|forest|teal/], ['sky', /sky|blue|azure|navy|cyan/], ['violet', /violet|purple|lavender|indigo/],
  ['rose', /rose|pink|magenta|fuchsia/], ['amber', /amber|orange|tangerine|peach/], ['coral', /coral|red|salmon|crimson|terracotta/],
  ['slate', /slate|gr[ae]y|silver|steel|graphite|mono/], ['gold', /gold|yellow|brass|champagne|warm/],
];
export function normalizeAccent(raw) {
  const s = lower(raw);
  if (!s) return null;
  if (ACCENTS.includes(s)) return s;
  for (const [k, re] of ACCENT_WORDS) if (re.test(s)) return k;
  return null;
}

const FONT_WORDS = [['serif', /serif|editorial|classic|elegant|book|times|georgia/], ['display', /display|bold|loud|heavy|poster|brutal|impact/], ['sans', /sans|clean|modern|minimal|simple|helvetica|inter/]];
export function normalizeFont(raw) {
  const s = lower(raw);
  if (!s) return null;
  if (FONTS.includes(s)) return s;
  for (const [k, re] of FONT_WORDS) if (re.test(s)) return k;
  return null;
}

const HERO_WORDS = [['split', /split|side|two.?col|left|right/], ['poster', /poster|full|cinematic|big|immersive|cover/], ['centered', /cent|middle|classic|simple/]];
export function normalizeHero(raw) {
  const s = lower(raw);
  if (!s) return null;
  if (HEROES.includes(s)) return s;
  for (const [k, re] of HERO_WORDS) if (re.test(s)) return k;
  return null;
}

const SECTION_ALIASES = [
  ['features', /feature|benefit|service|what we do|highlights?/], ['products', /product|shop|menu|catalog|items?|offerings?|store/],
  ['gallery', /gallery|photo|image|portfolio|work|showcase/], ['testimonials', /testimonial|review|quote|client|customer/],
  ['pricing', /pric|plan|package|tier|rate/], ['faq', /faq|question/], ['contact', /contact|reach|location|address|map/],
  ['signup', /sign.?up|subscribe|newsletter|waitlist|form|email|join|register|cta|call to action/],
];
export function normalizeSection(raw) {
  const s = lower(raw);
  if (!s) return null;
  if (SECTIONS.includes(s)) return s;
  if (s === 'hero' || s === 'header' || s === 'top') return null; // implicit, never listed
  for (const [k, re] of SECTION_ALIASES) if (re.test(s)) return k;
  return null;
}

/** Ordered, deduplicated list of known section ids. Unknown entries are dropped (reported by applyUpdate). */
export function normalizeSections(raw) {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,;/]|\band\b/) : [];
  const out = [];
  for (const item of list) { const id = normalizeSection(item); if (id && !out.includes(id)) out.push(id); }
  return out;
}

export function normalizeLang(raw) {
  const s = lower(raw);
  if (!s) return null;
  if (/^(en|english|англ)/.test(s)) return 'en';
  if (/^(ru|russian|рус)/.test(s)) return 'ru';
  return /^[a-z]{2}$/.test(s) ? s : null;
}

export function normalizeField(field, raw) {
  switch (field) {
    case 'theme': return normalizeTheme(raw);
    case 'accent': return normalizeAccent(raw);
    case 'font': return normalizeFont(raw);
    case 'hero': return normalizeHero(raw);
    case 'sections': return normalizeSections(raw);
    case 'lang': return normalizeLang(raw);
    case 'business': case 'headline': case 'subhead': case 'cta': return clean(raw);
    case 'kind': case 'audience': case 'tone': return lower(raw);
    default: return undefined;
  }
}

const sameList = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);

// ---------- patching ----------

/**
 * Apply a model-proposed update. `set` replaces fields; `add_sections`/`remove_sections` edit the
 * ordered section list (a full `set.sections` wins); `unset` clears fields. On the first turn that
 * makes a site exist (kind or business known) missing design fields get defaults, reported as added.
 */
export function applyUpdate(state, { set = {}, unset = [], add_sections = [], remove_sections = [] } = {}, meta = {}) {
  const next = structuredClone(state);
  const changed = [];
  const rejected = [];
  const before = state.intent;

  for (const [field, raw] of Object.entries(set)) {
    if (!SITE_FIELDS.includes(field)) { rejected.push({ field, reason: 'unknown_field' }); continue; }
    if (raw == null || raw === '' || (Array.isArray(raw) && !raw.length && field !== 'sections')) {
      if (before[field] != null) { next.intent[field] = null; changed.push(field); }
      continue;
    }
    const value = normalizeField(field, raw);
    if (value == null || (field === 'sections' && !value.length)) {
      rejected.push({ field, value: String(raw).slice(0, 40), reason: 'invalid_value' });
      continue;
    }
    if (field === 'sections') { if (!sameList(value, before.sections)) { next.intent.sections = value; changed.push('sections'); } continue; }
    if (value !== before[field]) { next.intent[field] = value; changed.push(field); }
  }

  if (!('sections' in set) && (add_sections.length || remove_sections.length)) {
    let list = [...(before.sections || [])];
    const rm = normalizeSections(remove_sections);
    list = list.filter((s) => !rm.includes(s));
    for (const s of normalizeSections(add_sections)) if (!list.includes(s)) list.push(s);
    for (const raw of [...add_sections, ...remove_sections]) if (!normalizeSection(raw)) rejected.push({ field: 'sections', value: String(raw).slice(0, 40), reason: 'unknown_section' });
    if (!sameList(list, before.sections)) { next.intent.sections = list; changed.push('sections'); }
  }

  for (const field of unset) {
    if (!SITE_FIELDS.includes(field)) { rejected.push({ field, reason: 'unknown_field' }); continue; }
    if (before[field] != null && !changed.includes(field)) { next.intent[field] = null; changed.push(field); }
  }

  // A site now exists: materialize the design defaults it will be rendered with.
  if (next.intent.kind || next.intent.business) {
    for (const [f, v] of Object.entries(DESIGN_DEFAULTS)) if (next.intent[f] == null) { next.intent[f] = v; changed.push(f); }
    if (next.intent.sections == null) { next.intent.sections = [...DEFAULT_SECTIONS]; changed.push('sections'); }
    if (next.intent.lang == null) { next.intent.lang = meta.lang || 'en'; changed.push('lang'); }
  }

  const patch = SITE_FIELDS.flatMap((field) => {
    const from = before[field];
    const to = next.intent[field];
    if (changed.includes(field)) {
      const change = from == null ? 'added' : to == null ? 'removed' : 'updated';
      const op = { field, from, to, status: 'active', change };
      if (field === 'sections') {
        op.added = (to || []).filter((s) => !(from || []).includes(s));
        op.removed = (from || []).filter((s) => !(to || []).includes(s));
      }
      return [op];
    }
    return to != null ? [{ field, from: to, to, status: 'kept' }] : [];
  });

  if (changed.length) {
    next.version = state.version + 1;
    next.updatedAt = new Date().toISOString();
  }
  next.history.push({ version: next.version, turnId: meta.turnId ?? null, text: meta.text ?? null, patch: patch.filter((p) => p.status === 'active') });
  return { state: next, patch, changed, rejected };
}

/** True once the brief describes something buildable. */
export const hasSite = (intent) => Boolean(intent && (intent.kind || intent.business));
