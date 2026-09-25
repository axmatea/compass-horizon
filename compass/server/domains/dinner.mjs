// Dinner planning domain: the original COMPASS intent (task, date, time, location, cuisine, party_size).
import { createState, applyUpdate } from '../state/intent.mjs';
import { describeChanges, claimsCompletion, notePlan, t as tr } from '../i18n/lang.mjs';
import { correctMeridiem, keepHalfOfDay } from '../agent/meridiem.mjs';

export const dinnerDomain = Object.freeze({
  name: 'dinner',
  createState,
  applyUpdate,
  describeChanges,
  /** Explicit "8 in the morning" / "в 9 вечера" overrides the model's dinner-means-PM default. */
  refine(text, interp, state) {
    const fixedTime = correctMeridiem(text, interp.set?.time) || keepHalfOfDay(text, interp.set?.time, state.intent.time);
    if (!fixedTime) return null;
    return { interp: { ...interp, set: { ...interp.set, time: fixedTime }, reply: null }, note: { stage: 'meridiem_corrected', from: interp.set.time, to: fixedTime } };
  },
  /** Never let the model say something was booked/sent/set: only the plan changed. */
  guardAck(ack, state, lang) {
    if (!claimsCompletion(ack, lang)) return null;
    return notePlan(state.intent, lang) + (/\b(can't|cannot)\b|не могу|нельзя/i.test(ack) ? (lang === 'ru' ? ' Отправлять и бронировать я не умею.' : " I can't send, book or confirm anything.") : '');
  },
  askMissing(waiting, lang, ack) {
    return waiting.has('location') && !/[?？]\s*$/.test(ack || '') ? tr(lang).askLocation : null;
  },
});
