/**
 * LONGVIEW deck and stage script: the single source of truth.
 * Used by /deck (slides + speaker notes), /script (printable stage script)
 * and docs/SCRIPT.md (generated from this file).
 * Keep this file free of imports so Node can read it directly.
 * Copy rule: no em dash character anywhere.
 */

export type Speaker = 'NAYL' | 'VINCENT';

/** One line of the stage script. `say` is spoken exactly as written; `cue` is a click or action. */
export interface Line {
  who: Speaker;
  cue?: string;
  /** seconds the cue costs on stage (click, page load, drag) */
  pause?: number;
  say?: string;
}

export interface SlideDef {
  n: number;
  key: string;
  eyebrow: string;
  title: string;
  /** stage script lines spoken while this slide, or the demo launched from it, is on screen */
  notes: Line[];
  /** talking points for Q&A or a longer slot; never needed for the 3:00 run */
  more?: string[];
}

export const TEAM = 'NAYL (AI Media Global) and Vincent';
export const EVENT = 'Long Horizon Agents hackathon';
export const TAGLINE = 'The acquisition agent that waits for the truth.';
export const URL_PLACEHOLDER = 'longview (live link in the demo)';
export const TARGET_SECONDS = 180;
/** delivery model for timestamps: calm, rehearsed pace */
export const WORDS_PER_MINUTE = 155;

export const DEMO_BEATS: { day: number | null; title: string; cue: string }[] = [
  { day: 0, title: 'Launch', cue: 'Next beat' },
  { day: 3, title: 'The dashboard says A', cue: 'Next beat' },
  { day: 6, title: 'Busy buyers answer', cue: 'Next beat, Replay webhook' },
  { day: 9, title: 'The agent changes its mind', cue: 'Next beat' },
  { day: 11, title: 'Late truth', cue: 'Next beat' },
  { day: 14, title: 'Pull the plug', cue: 'Pull the plug, Next beat, Resume' },
  { day: 21, title: 'Outcome', cue: 'Next beat' },
  { day: null, title: 'Time machine', cue: 'Drag to Day 3' },
];

export const PROVEN: string[] = [
  'Replay a webhook: nothing changes.',
  'A late event restates the past.',
  'Unknown budget stays unknown.',
  'Unknown attribution is never credited.',
  'Crash mid-run, resume: zero duplicate effects.',
  'No winner on thin samples.',
  'The time machine reproduces what the agent knew.',
];

export const SLIDES: SlideDef[] = [
  {
    n: 1,
    key: 'title',
    eyebrow: EVENT,
    title: 'Longview',
    notes: [
      { who: 'NAYL', cue: 'Deck open on slide 1, full screen. Start on silence.', pause: 0 },
      {
        who: 'NAYL',
        say: "I'm NAYL, from AI Media Global, and this is Vincent. We built Longview: the acquisition agent that waits for the truth.",
      },
    ],
    more: ['Built for the Long Horizon Agents hackathon with Nimble, Liquid AI and Tinybird.'],
  },
  {
    n: 2,
    key: 'problem',
    eyebrow: 'The problem',
    title: 'Judged on day one',
    notes: [
      { who: 'NAYL', cue: 'Click', pause: 1 },
      {
        who: 'NAYL',
        say: 'Ads are judged on day one. When a purchase takes thought, the customer arrives on day thirty. By then, the budget has moved.',
      },
    ],
    more: ['CPL is what an ad dashboard shows. Cost per qualified lead and revenue arrive weeks later.'],
  },
  {
    n: 3,
    key: 'insight',
    eyebrow: 'The insight',
    title: 'Busy buyers answer late',
    notes: [
      { who: 'NAYL', cue: 'Click', pause: 1 },
      {
        who: 'NAYL',
        say: 'Why? Busy buyers answer late. Fast responders fill the early data, so dashboards, and naive agents, learn the wrong lesson.',
      },
    ],
    more: ['The curves are an illustration of the demo scenario, not customer data.'],
  },
  {
    n: 4,
    key: 'what',
    eyebrow: 'What Longview does',
    title: 'What Longview does',
    notes: [
      { who: 'NAYL', cue: 'Click', pause: 1 },
      {
        who: 'NAYL',
        say: 'Longview keeps every experiment open until the truth arrives. It remembers what it believed and why, changes its mind with receipts, and corrects its own rules.',
      },
    ],
  },
  {
    n: 5,
    key: 'primitives',
    eyebrow: 'Four long-horizon primitives',
    title: 'Four primitives',
    notes: [
      { who: 'NAYL', cue: 'Click', pause: 1 },
      {
        who: 'NAYL',
        say: 'Four primitives make that work: a bitemporal ledger, commitments across time, versioned beliefs, and crash-safe runs. Plus a time machine. Vincent.',
      },
    ],
    more: [
      'Ledger: every event has occurredAt and learnedAt. Idempotent by event id.',
      'Commitments are cancelled when the answer arrives first.',
      'Beliefs only change version when status or favored arm changes.',
    ],
  },
  {
    n: 6,
    key: 'demo',
    eyebrow: 'Live demo',
    title: 'Live demo',
    notes: [
      { who: 'VINCENT', cue: 'Click, then switch to the /demo tab (or click the /demo link)', pause: 2 },
      {
        who: 'VINCENT',
        say: 'One honest note. The campaign data and the clock are simulated. The agent, the ledger, the crash and the resume are real. Sponsor calls are live only where the screen says LIVE.',
      },
      { who: 'VINCENT', cue: 'Next beat (Day 0)', pause: 1.5 },
      {
        who: 'VINCENT',
        say: 'Day zero. Two campaigns, same spend. A: a free AI audit for any small business. B: close-the-books autopilot for CPA partners.',
      },
      { who: 'VINCENT', cue: 'Next beat (Day 3)', pause: 1.5 },
      {
        who: 'VINCENT',
        say: 'Day three. A: about a dozen leads near fifty dollars. B: three, near two hundred. A dashboard says scale A. Longview only leans A, and schedules questions for missing budgets.',
      },
      { who: 'VINCENT', cue: 'Next beat (Day 6)', pause: 1.5 },
      {
        who: 'VINCENT',
        say: 'Day six. The busy partners answer, with real budgets. Liquid extracts each field with its quote.',
      },
      { who: 'VINCENT', cue: 'Replay webhook', pause: 1.5 },
      { who: 'VINCENT', say: 'Same webhook again: ignored. Nothing changes.' },
      { who: 'VINCENT', cue: 'Next beat (Day 9)', pause: 1.5 },
      {
        who: 'VINCENT',
        say: 'Day nine. It changes its mind: leaning B, with a diff. And a lesson: my day three read favored fast responders. Policy version two.',
      },
      { who: 'VINCENT', cue: 'Next beat (Day 11)', pause: 1.5 },
      {
        who: 'VINCENT',
        say: 'Day eleven. The CRM reports two calls from days five and seven. Late truth restates the past. Supported B.',
      },
      { who: 'VINCENT', cue: 'Pull the plug, then Next beat (Day 14)', pause: 2.5 },
      { who: 'VINCENT', say: 'Day fourteen. I pulled the plug: the run died after step three.' },
      { who: 'VINCENT', cue: 'Resume', pause: 1.5 },
      { who: 'VINCENT', say: 'It resumes at step four. Effects already done are skipped, not repeated.' },
      { who: 'VINCENT', cue: 'Next beat (Day 21)', pause: 1.5 },
      { who: 'VINCENT', say: "Day twenty-one. B wins an eighteen thousand dollar deal. A's only call ghosts." },
      { who: 'VINCENT', cue: 'Drag the time machine to Day 3', pause: 2 },
      { who: 'VINCENT', say: 'And the time machine: exactly what it knew on day three.' },
      { who: 'VINCENT', cue: 'Drag back to Day 21. Switch to the deck tab and hand over', pause: 1.5 },
    ],
    more: [
      'If the network fails, use the 20 second fallback on /script while this slide stays up.',
      "If Liquid shows BLOCKED or rules fallback on stage, say: 'The extractor pulls each field with its quote.'",
      'If a beat is slow, narrate what the agent is doing until the screen updates.',
    ],
  },
  {
    n: 7,
    key: 'architecture',
    eyebrow: 'How it runs',
    title: 'How it runs',
    notes: [
      { who: 'NAYL', cue: 'Click to slide 7', pause: 1 },
      {
        who: 'NAYL',
        say: 'Underneath: one append-only Postgres ledger. Nimble brings sourced market evidence, Liquid reads every reply, Tinybird serves metrics as of any day. Rules, not the model, decide who qualifies.',
      },
    ],
    more: [
      'Idempotency is the primary key: insert on conflict do nothing.',
      'Each step appends run.step with a deterministic id, so a resumed run skips finished steps.',
      'Without keys each sponsor shows BLOCKED and a labeled fallback runs instead.',
    ],
  },
  {
    n: 8,
    key: 'proof',
    eyebrow: 'What we proved',
    title: 'What we proved',
    notes: [
      { who: 'NAYL', cue: 'Click', pause: 1 },
      {
        who: 'NAYL',
        say: 'Every property you just saw is covered by a test.',
      },
    ],
    more: ['The engine is pure and deterministic: the same code runs in the tests, on the server and in the browser.'],
  },
  {
    n: 9,
    key: 'business',
    eyebrow: 'Business',
    title: 'Business',
    notes: [
      { who: 'NAYL', cue: 'Click', pause: 1 },
      {
        who: 'NAYL',
        say: 'We run it on our own pipeline first. Early access: 299 dollars a month per business, ad spend separate. It never buys ads or sends messages.',
      },
    ],
    more: ['First customers: AI implementation firms, agencies, B2B services. No automatic billing yet.'],
  },
  {
    n: 10,
    key: 'close',
    eyebrow: 'Thank you',
    title: 'Close',
    notes: [
      { who: 'NAYL', cue: 'Click', pause: 1 },
      {
        who: 'NAYL',
        say: 'Your dashboard remembers the click. Longview remembers what happened next. Thank you.',
      },
    ],
  },
];

export const FALLBACK: { who: Speaker; when: string; cue: string; say: string } = {
  who: 'VINCENT',
  when: 'The demo does not load within 5 seconds, or a click hangs.',
  cue: 'Stay on slide 6 and point along the horizon, left to right.',
  say: 'The network is down, so here is the run. Day three: the dashboard says A. Day six: busy buyers answer. Day nine: Longview changes its mind, with a lesson. Day eleven: late calls restate the past. Day fourteen: we kill the run, and it resumes without repeats. Day twenty-one: B wins.',
};

export const PRESHOW: string[] = [
  'Tab 1: /deck on slide 1. Use the browser full screen (Ctrl+Cmd+F on a Mac) so switching tabs keeps it.',
  'Tab 2: /demo (the stage link if the team set one). Press Reset. Confirm Day 0, the Next beat button, and the DEMO DATA and SIMULATED CLOCK labels.',
  'Offline backup: /deck/longview-deck.pdf saved on the desktop.',
  'Rehearse with N (speaker notes) on; press N again to hide them before going live.',
];

export const QA: { q: string; a: string }[] = [
  {
    q: 'Why not just use a CRM?',
    a: 'A CRM keeps the latest value of each field. Longview keeps when each fact happened and when we learned it, so it can show what it believed on any day and why it changed. It sits between the ads and the CRM, reads both, and writes decisions with evidence. You keep your CRM.',
  },
  {
    q: 'How does it know it was wrong?',
    a: 'Every belief is versioned with its evidence and the policy that produced it. When later evidence flips the favored campaign, it diffs the new belief against the old one, sees that the early read rested on fast responders, records a lesson, and raises the policy version. In the demo that means three resolved leads per campaign before it will lean.',
  },
  {
    q: 'What does exactly-once mean here?',
    a: 'Delivery can repeat; effects happen once. Every effect, like a drafted follow-up, has a deterministic key written to the ledger with insert on conflict do nothing. A replayed webhook or a resumed run finds the key and skips the effect. You saw that as SKIPPED_DUPLICATE after the crash.',
  },
  {
    q: 'Why Liquid?',
    a: 'Every reply needs a small extraction: budget, timeline, decision maker, each with its quote. That runs on every event, so it has to be cheap and fast, which is what small Liquid models are for. The output is schema validated, and rules, not the model, make the qualification call. Without a key it falls back to a rules extractor, labeled as such.',
  },
  {
    q: 'Why Tinybird?',
    a: 'Decisions need metrics as of a given day, with duplicates removed, while events keep streaming in. Tinybird takes the event stream and answers as-of queries with dedupe by id. Without a key we compute the same metrics from Postgres and label them LOCAL.',
  },
  {
    q: 'What changes with real ad data?',
    a: 'Only the ingest step. Spend, leads and replies arrive through the same events endpoint, from ad reporting and CRM webhooks, instead of the scenario, and the clock becomes the real clock. The ledger, beliefs, commitments and runs stay the same, and it still never changes a campaign. We start on our own pipeline.',
  },
  {
    q: 'What about privacy?',
    a: 'Secrets stay on the server. Receipts never contain tokens or personal data. Longview never sends messages and never touches the ad account. Nimble is used for public market evidence only, never for scraping personal contacts. The demo data is synthetic.',
  },
  {
    q: 'What does it cost?',
    a: 'Early access is 299 dollars a month per business, ad spend separate. No automatic billing yet. We run it on our own pipeline first, then with service businesses whose buyers take their time.',
  },
];

/* ---------------- timing helpers (pure) ---------------- */

export function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export interface TimedLine extends Line {
  slide: number;
  /** seconds from the start of the talk */
  t: number;
}

/** Walks the script in order and stamps every line with its start time. */
export function timeline(): { lines: TimedLine[]; totalSeconds: number; spokenWords: number } {
  const lines: TimedLine[] = [];
  let t = 0;
  let spokenWords = 0;
  for (const slide of SLIDES) {
    for (const line of slide.notes) {
      lines.push({ ...line, slide: slide.n, t });
      if (line.cue) t += line.pause ?? 1;
      if (line.say) {
        const w = words(line.say);
        spokenWords += w;
        t += (w / WORDS_PER_MINUTE) * 60;
      }
    }
  }
  return { lines, totalSeconds: t, spokenWords };
}

export function clock(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
