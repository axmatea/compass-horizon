/**
 * Deterministic rules extractor: reads a reply and returns fields with exact quotes.
 * Used as the public demo extractor and as the fallback whenever Liquid is unavailable or fails.
 * Every quote is an exact substring of the input text.
 */

export interface ExtractedField<T> {
  value: T;
  quote: string;
}

export interface Extraction {
  budgetUsd: ExtractedField<number> | null;
  timelineDays: ExtractedField<number> | null;
  decisionMaker: ExtractedField<boolean> | null;
  problem: ExtractedField<string> | null;
}

const WORD_NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

const UNIT_DAYS: Record<string, number> = { day: 1, week: 7, month: 30 };

function extractBudget(text: string): ExtractedField<number> | null {
  const none = /\bno budget\b/i.exec(text);
  const amount = /\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(\s?[kK]\b)?/.exec(text);
  if (amount) {
    const base = Number(amount[1].replace(/,/g, ''));
    const value = amount[2] ? base * 1000 : base;
    if (Number.isFinite(value)) return { value: Math.round(value), quote: amount[0].trim() };
  }
  if (none) return { value: 0, quote: none[0] };
  return null;
}

function extractTimeline(text: string): ExtractedField<number> | null {
  const re =
    /\b(?:(?:within|in the next|over the next|in about|in|for|at least|about)\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(day|week|month)s?\b/i;
  const m = re.exec(text);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : WORD_NUM[m[1].toLowerCase()];
  const unit = UNIT_DAYS[m[2].toLowerCase()];
  if (!n || !unit) return null;
  return { value: n * unit, quote: m[0] };
}

const DM_FALSE = [
  /\bnot the decision maker\b/i,
  /\bI don['’]t make (?:these|those|the) calls?\b/i,
  /\bwould (?:have|need) to approve\b/i,
  /\b(?:my|the) (?:boss|owner|partners?|business partner|managing partner) (?:decides|would decide|makes the call|signs off)\b/i,
  /\bI(?:['’]d| would) need (?:my|our|the) [a-z ]{2,30} to decide\b/i,
  /\bI(?:['’]m| am) just the [a-z ]{2,30}\b/i,
];

const DM_TRUE = [
  /\bI(?:['’]m| am) (?:the |a )?(?:sole )?(?:owner|founder|co-founder|managing partner|founding partner|senior partner|CEO|president|principal)\b/i,
  /\bI (?:own|run) (?:the|this|our|my) (?:firm|business|practice|company|shop|studio)\b/i,
  /\bI (?:sign off|make the (?:final )?call|decide)\b/i,
  /\b(?:managing|founding) partner(?:,)? (?:who )?(?:makes|signs)\b/i,
];

function extractDecisionMaker(text: string): ExtractedField<boolean> | null {
  for (const re of DM_FALSE) {
    const m = re.exec(text);
    if (m) return { value: false, quote: m[0] };
  }
  for (const re of DM_TRUE) {
    const m = re.exec(text);
    if (m) return { value: true, quote: m[0] };
  }
  return null;
}

const PROBLEM_RE =
  /(close|reconcil|invoic|bookkeeping|scheduling|month-end|payroll|spreadsheet|manual|data entry|takes us|eats|lose|losing|chasing|follow-ups|paperwork|intake)/i;

function extractProblem(text: string): ExtractedField<string> | null {
  const sentences = text.match(/[^.!?]+[.!?]?/g) ?? [];
  for (const s of sentences) {
    const t = s.trim();
    if (t && PROBLEM_RE.test(t) && !/\$|budget/i.test(t)) {
      const quote = t.replace(/[.!?]$/, '');
      return { value: quote, quote };
    }
  }
  return null;
}

export function extractRules(text: string): Extraction {
  return {
    budgetUsd: extractBudget(text),
    timelineDays: extractTimeline(text),
    decisionMaker: extractDecisionMaker(text),
    problem: extractProblem(text),
  };
}
