// Explicit AM/PM beats the model. GLM applies "dinner means PM" even when the user
// says "8 in the morning"; state must follow what the user actually said.
const EN = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const RU = { 'час': 1, 'один': 1, 'два': 2, 'двух': 2, 'три': 3, 'трёх': 3, 'трех': 3, 'четыре': 4, 'четырёх': 4, 'четырех': 4, 'пять': 5, 'пяти': 5, 'шесть': 6, 'шести': 6, 'семь': 7, 'семи': 7, 'восемь': 8, 'восьми': 8, 'девять': 9, 'девяти': 9, 'десять': 10, 'десяти': 10, 'одиннадцать': 11, 'одиннадцати': 11, 'двенадцать': 12, 'двенадцати': 12 };
const NUM = `(\\d{1,2})(?::(\\d{2}))?(?!\\d)|(${EN.slice(1).join('|')}|${Object.keys(RU).join('|')})(?![\\p{L}\\d])`;
const AM = /^(?:a\.?\s?m\b\.?|in the morning|утра|ночи)/i;
const PM = /^(?:p\.?\s?m\b\.?|in the (?:evening|afternoon)|at night|tonight|вечера|дня)/i;
const PHRASE = new RegExp(`(?<![\\p{L}\\d])(?:${NUM})(?:\\s*(?:o'?clock|часов|часа))?\\s*`, 'giu');

function hourOf(m) {
  if (m[1]) return Number(m[1]);
  const w = m[3].toLowerCase();
  return EN.includes(w) ? EN.indexOf(w) : RU[w];
}

/** Explicit meridiem phrases in the utterance: [{ hour 1..12, pm: bool }]. */
export function explicitMeridiems(text) {
  const found = [];
  for (const m of String(text || '').matchAll(PHRASE)) {
    const hour = hourOf(m);
    if (!hour || hour > 12) continue;
    const rest = text.slice(m.index + m[0].length);
    if (AM.test(rest)) found.push({ hour, pm: false });
    else if (PM.test(rest)) found.push({ hour, pm: true });
  }
  return found;
}

/**
 * If the user named exactly one explicit AM/PM time and the model's HH:MM has the
 * same hour on the wrong half of the day, flip it. Returns the corrected time or null.
 */
export function correctMeridiem(text, time) {
  const t = /^(\d{2}):(\d{2})$/.exec(time || '');
  if (!t) return null;
  const said = explicitMeridiems(text);
  if (said.length !== 1) return null;
  const { hour, pm } = said[0];
  const h = Number(t[1]);
  if (h % 12 !== hour % 12) return null;
  const want = pm ? (hour % 12) + 12 : hour % 12;
  return want === h ? null : `${String(want).padStart(2, '0')}:${t[2]}`;
}

/** Hours 1..12 the user mentioned without any AM/PM marker. */
function bareHours(text) {
  const out = [];
  for (const m of String(text || '').matchAll(PHRASE)) {
    const hour = hourOf(m);
    if (!hour || hour > 12) continue;
    const rest = text.slice(m.index + m[0].length);
    if (!AM.test(rest) && !PM.test(rest)) out.push(hour);
  }
  return out;
}

const mins = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/**
 * A bare hour that corrects an existing time stays on the same half of the day as the
 * current plan: 9 AM meeting + "push it to 10" -> 10:00; 7 PM dinner + "make it 8" -> 20:00.
 * Returns the corrected time or null.
 */
export function keepHalfOfDay(text, time, prevTime) {
  const t = /^(\d{2}):(\d{2})$/.exec(time || '');
  if (!t || !/^\d{2}:\d{2}$/.test(prevTime || '')) return null;
  if (explicitMeridiems(text).length) return null;
  if (/\b(?:1[3-9]|2[0-3]):\d{2}\b/.test(text)) return null; // user spoke 24h
  const h = Number(t[1]);
  const hours = bareHours(text).filter((x) => x % 12 === h % 12);
  if (hours.length !== 1) return null;
  const am = h % 12;
  const options = [am, am + 12].map((x) => `${String(x).padStart(2, '0')}:${t[2]}`);
  const best = options.reduce((a, b) => (Math.abs(mins(b) - mins(prevTime)) < Math.abs(mins(a) - mins(prevTime)) ? b : a));
  return best === time ? null : best;
}
