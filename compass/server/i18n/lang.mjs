// Spoken-language layer. Only languages that were tested end to end are listed.
// State values stay canonical English (GLM normalizes); only spoken text is localized.
export const SUPPORTED_LANGS = Object.freeze(['en', 'ru']);

/** Deterministic script-based detection. Cyrillic -> ru, otherwise en. */
export function detectLang(text) {
  return /[Ѐ-ӿ]/.test(String(text || '')) ? 'ru' : 'en';
}

/** True when the text is plausibly written in lang (used to catch GLM answering in the wrong language). */
export function matchesLang(text, lang) {
  const cyr = /[Ѐ-ӿ]/.test(String(text || ''));
  return lang === 'ru' ? cyr : !cyr;
}

const DATE_RU = {
  today: 'сегодня', tonight: 'сегодня вечером', tomorrow: 'завтра', 'the day after tomorrow': 'послезавтра',
  'next week': 'следующая неделя', 'the week after next': 'через две недели', 'week after next': 'через две недели',
  'this weekend': 'эти выходные', 'next weekend': 'следующие выходные',
};
export const dateRu = (d) => DATE_RU[String(d).toLowerCase()] || d;

export function formatTime(hhmm, lang = 'en') {
  if (!hhmm) return null;
  if (lang === 'ru') return hhmm;
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, '0')} ${suffix}` : `${h12} ${suffix}`;
}

const T = {
  en: {
    fallback: "Sorry, I didn't catch that. Could you say it again?",
    time: (v) => `Moved to ${formatTime(v, 'en')}.`,
    date: (v) => `Moved to ${v}.`,
    location: (v) => `Now near ${v}.`,
    cuisine: (v) => `Switched to ${v}.`,
    party_size: (v) => `Table for ${v}.`,
    task: (v) => `Now: ${v}.`,
    askLocation: 'Where should I look?',
    toolFailed: "I couldn't reach the map service just now. Want me to try again?",
  },
  ru: {
    fallback: 'Простите, не удалось расслышать. Повторите, пожалуйста?',
    time: (v) => `Время теперь ${v}.`,
    date: (v) => `Дата теперь: ${dateRu(v)}.`,
    location: (v) => `Теперь рядом с ${v}.`,
    cuisine: (v) => `Кухня теперь: ${v}.`,
    party_size: (v) => `Гостей: ${v}.`,
    task: (v) => `Задача: ${v}.`,
    askLocation: 'Где искать?',
    toolFailed: 'Сейчас не удалось связаться с картами. Попробовать ещё раз?',
  },
};
export const t = (lang) => T[lang] || T.en;

/** Spoken summary of updated fields (only real changes, not additions). */
export function describeChanges(patch, lang = 'en') {
  const L = t(lang);
  return patch
    .filter((p) => p.status === 'active' && p.change === 'updated' && L[p.field])
    .map((p) => L[p.field](p.to))
    .join(' ');
}

// COMPASS keeps a plan and searches places. It never books, confirms, sends or creates
// calendar events, so a spoken reply must not say it did.
const CLAIM = {
  en: /\b(booked|reserved|confirmed|sent|invited|scheduled|all set|done|set (?:for|up|at))\b|\bset\s*[.;!]?$/i,
  ru: /(забронир|зарезервир|подтвержд|отправлен|приглаш|назначен|запланирован|готово)/i,
};
const NEGATION = /\b(can't|cannot|can not|won't|haven't|not|no)\b|не\s|нельзя/i;

/** True if the reply asserts a completed action (clauses that deny it are ignored). */
export function claimsCompletion(reply, lang = 'en') {
  const re = CLAIM[lang] || CLAIM.en;
  return String(reply || '').split(/[.;,!?]|\s[-–]\s/).some((c) => re.test(c) && !NEGATION.test(c));
}

/** Truthful acknowledgement of the current plan: "Noted in the plan: schedule meeting, tomorrow at 9 AM." */
export function notePlan(intent = {}, lang = 'en') {
  if (lang === 'ru') {
    const parts = [intent.date && dateRu(intent.date), intent.time && `в ${intent.time}`, intent.location && `рядом с ${intent.location}`].filter(Boolean);
    return parts.length ? `Записано в план: ${parts.join(', ')}.` : 'Записано в план.';
  }
  const when = [intent.date, intent.time && `at ${formatTime(intent.time, 'en')}`].filter(Boolean).join(' ');
  const parts = [intent.task, when, intent.location && `near ${intent.location}`].filter(Boolean);
  return parts.length ? `Noted in the plan: ${parts.join(', ')}.` : 'Noted.';
}
