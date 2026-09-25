/**
 * Mock backend. Loaded ONLY when NEXT_PUBLIC_LV_MOCK=1 (see api.ts).
 * Produces believable WorldView objects for the DEMO story "ai-media-q4"
 * so the UI can be designed and QA'd before the engine lands.
 * Every number here is derived from the scenario tables below, never typed
 * into components. QA control: /demo?beat=5 (interrupted), &resumed=1, &asOf=3.
 */
import type {
  BeliefView,
  CampaignView,
  CommitmentView,
  CurvePoint,
  FieldKey,
  FieldValue,
  HealthResponse,
  LedgerEntry,
  LeadStatus,
  LeadView,
  LessonView,
  MarketSignal,
  OutcomeStage,
  ProviderName,
  ProviderStatus,
  ReceiptView,
  RunView,
  StageBeat,
  WorldView,
} from "@/contract";
import { ApiError } from "./api";

/* ------------------------------------------------------------------ scenario */

const HORIZON = 30;
const START_MS = Date.UTC(2026, 9, 5, 16, 0, 0); // Day 0 = Mon Oct 5 2026
const DAY_MS = 86_400_000;
const DAILY_SPEND = 150;
const TEST_WINDOW = 14;
const A = "cmp_a";
const B = "cmp_b";
const BEAT_DAYS = [0, 3, 6, 9, 11, 14, 21, 21];

const RULES = { version: 1, minBudgetUsd: 10_000, maxTimelineDays: 90, requireDecisionMaker: true };

const BEATS: { title: string; caption: string; next: string | null }[] = [
  {
    title: "Launch",
    caption:
      "Two campaigns go live at $150 a day. Longview writes down its qualification rules and decision policy before it sees a single lead.",
    next: "Advance to Day 3",
  },
  {
    title: "The dashboard says A",
    caption:
      "Day 3. A has 12 leads at $50, B has 3 at $200. Every ad dashboard crowns A. Longview only leans, and books a follow-up for every open question.",
    next: "Advance to Day 6",
  },
  {
    title: "Busy buyers answer",
    caption:
      "Day 6. CPA partners reply with real budgets, A's follow-ups reveal no budget, and a duplicate webhook is ignored. The belief drops back to insufficient.",
    next: "Advance to Day 9",
  },
  {
    title: "The agent changes its mind",
    caption:
      "Day 9. Longview now leans B, shows exactly what changed, and tightens its own policy: three resolved leads per arm before it leans again.",
    next: "Advance to Day 11",
  },
  {
    title: "Late truth",
    caption:
      "Day 11. A CRM sync reports two calls booked back on Days 5 and 7. The past is restated, not overwritten. The belief is now supported.",
    next: "Advance to Day 14",
  },
  {
    title: "Pull the plug",
    caption:
      "Day 14. The wake has promises due. We kill the worker after step 3. The ledger survives, the run resumes at step 4, nothing happens twice.",
    next: "Advance to Day 21",
  },
  {
    title: "Outcome",
    caption:
      "Day 21. B closes an $18,000 deal and A's only call ghosted. Scaling A on Day 3 would have bought cheap leads and no revenue.",
    next: "Open the time machine",
  },
  {
    title: "Time machine",
    caption:
      "Drag the horizon back to Day 3 and see exactly what the agent knew then, and why it leaned A. Then return to now.",
    next: null,
  },
];

interface ReplySpec {
  day: number;
  text: string;
  budget?: number | null;
  budgetQuote?: string;
  timeline?: number | null;
  timelineQuote?: string;
  dm?: boolean | null;
  dmQuote?: string;
  duplicate?: boolean;
}

interface LeadSpec {
  id: string;
  name: string;
  company: string;
  role: string;
  campaignId: string | null;
  capturedDay: number;
  form: string;
  reply?: ReplySpec;
  outcomes?: { stage: OutcomeStage; day: number; learnedDay: number; valueUsd?: number }[];
}

const FIRST = ["Jake", "Lena", "Omar", "Bea", "Carl", "Nina", "Theo", "Ivy", "Raj", "Mia", "Ben", "Zoe", "Eli", "Ada", "Sam", "Kim", "Leo", "Ana", "Max", "Joy", "Gus", "Eva", "Hal", "Uma", "Ned", "Ola", "Pat", "Ray", "Sue", "Vic"];
const LAST = ["Moreno", "Park", "Haddad", "Quinn", "Novak", "Ferris", "Ahmed", "Brooks", "Castillo", "Duval", "Engel", "Fox", "Garner", "Hale", "Ito", "Jansen", "Kaur", "Lowe", "Mercer", "Nash", "Ortiz", "Pryor", "Rossi", "Sato", "Tate", "Ueda", "Vance", "Wolfe", "Young", "Zeller"];
const BIZ = ["Coffee Co.", "Auto Detailing", "Yoga Studio", "Bakery", "Plumbing", "Pet Grooming", "Florist", "Print Shop", "Barbershop", "Cleaning Services", "Food Truck", "Photography", "Handyman Services", "Boutique", "Fitness Studio"];
const ROLES = ["Owner", "Owner", "Store manager", "Founder", "Office manager", "Owner"];
const FORMS_A = [
  "Curious what AI could do for a shop like mine.",
  "We spend too long answering the same customer emails.",
  "Want to see if AI can help with bookings.",
  "Saw the free audit, sounds interesting.",
  "Looking for ways to save time on admin.",
];
const NAF_REPLIES: ReplySpec[] = [
  { day: 0, text: "We do not really have a budget for this. Maybe $500 if it is cheap.", budget: 500, budgetQuote: "Maybe $500 if it is cheap." },
  { day: 0, text: "I would need to ask my boss, I just manage the front desk.", dm: false, dmQuote: "I would need to ask my boss" },
  { day: 0, text: "Maybe next year, we are just looking around for now.", timeline: 365, timelineQuote: "Maybe next year" },
  { day: 0, text: "Our whole software budget is about $1,200 a year.", budget: 1200, budgetQuote: "about $1,200 a year" },
];

function buildLeads(): LeadSpec[] {
  const leads: LeadSpec[] = [];
  // Campaign A: 3 leads a day for 14 days. Cheap, fast, mostly no budget.
  for (let i = 0; i < 42; i++) {
    const capturedDay = Math.floor(i / 3);
    const id = `lead_a${String(i + 1).padStart(2, "0")}`;
    const base: LeadSpec = {
      id,
      name: `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`,
      company: `${LAST[(i * 7) % LAST.length]} ${BIZ[i % BIZ.length]}`,
      role: ROLES[i % ROLES.length],
      campaignId: A,
      capturedDay,
      form: FORMS_A[i % FORMS_A.length],
    };
    if (i % 3 === 1) {
      const r = NAF_REPLIES[i % NAF_REPLIES.length];
      base.reply = { ...r, day: Math.min(capturedDay + 3, 20) };
    } else if (i % 3 === 2) {
      base.reply = {
        day: capturedDay + 2,
        text: "Can you send pricing first? Not sure yet.",
        timeline: 60,
        timelineQuote: "Not sure yet",
        dm: true,
        dmQuote: "I run the place",
      };
      base.reply.text = "Can you send pricing first? I run the place, would want something in the next couple of months.";
    }
    leads.push(base);
  }
  const a = (n: number) => leads[n];
  Object.assign(a(0), {
    name: "Marco Reyes",
    company: "Reyes Landscaping",
    role: "Owner",
    form: "Scheduling and quoting eat my evenings.",
    reply: {
      day: 1,
      text: "We could put about $10k toward this if it saves real hours. Hoping to start next month. I own the company.",
      budget: 10_000,
      budgetQuote: "about $10k toward this",
      timeline: 30,
      timelineQuote: "start next month",
      dm: true,
      dmQuote: "I own the company",
    },
    outcomes: [
      { stage: "CALL_BOOKED", day: 8, learnedDay: 8, valueUsd: 10_000 },
      { stage: "GHOSTED", day: 16, learnedDay: 16 },
    ],
  });
  Object.assign(a(1), {
    name: "Dana Whitfield",
    company: "Whitfield Dental Studio",
    role: "Practice owner",
    form: "Front desk drowns in reschedules.",
    reply: {
      day: 2,
      text: "Budget is around $12,000 for the year. Ready to go within 60 days. It is my practice.",
      budget: 12_000,
      budgetQuote: "around $12,000 for the year",
      timeline: 60,
      timelineQuote: "within 60 days",
      dm: true,
      dmQuote: "It is my practice",
    },
  });
  Object.assign(a(2), {
    name: "Priya Natarajan",
    company: "Natarajan Tutoring",
    role: "Founder",
    reply: { day: 3, text: "Honestly just curious what AI can do. Maybe $500 if it is cheap.", budget: 500, budgetQuote: "Maybe $500" },
  });
  Object.assign(a(8), {
    name: "Victor Hale",
    company: "Hale Family Chiropractic",
    role: "Managing partner",
    reply: {
      day: 6,
      text: "We have $15k set aside. Within 45 days would be ideal. I am the managing partner.",
      budget: 15_000,
      budgetQuote: "$15k set aside",
      timeline: 45,
      timelineQuote: "Within 45 days",
      dm: true,
      dmQuote: "I am the managing partner",
    },
  });
  Object.assign(a(21), {
    name: "Irene Castillo",
    company: "Castillo Insurance Agency",
    role: "Owner",
    reply: {
      day: 10,
      text: "About $11,000 this quarter, 90 days, my call.",
      budget: 11_000,
      budgetQuote: "About $11,000 this quarter",
      timeline: 90,
      timelineQuote: "90 days",
      dm: true,
      dmQuote: "my call",
    },
  });

  // Campaign B: CPA firm partners. Expensive, slow (busy season), real budgets.
  const b = (
    id: string,
    name: string,
    company: string,
    role: string,
    capturedDay: number,
    form: string,
    reply?: ReplySpec,
    outcomes?: LeadSpec["outcomes"],
  ): LeadSpec => ({ id, name, company, role, campaignId: B, capturedDay, form, reply, outcomes });

  leads.push(
    b("lead_b01", "Helen Okafor", "Okafor & Lin CPAs", "Managing partner", 0, "Month-end close takes us 9 days. Partners review spreadsheets at midnight.", {
      day: 5,
      text: "Sorry for the slow reply, busy season. We have $25,000 budgeted for automation this year and would want it live before January. I sign off on vendors.",
      budget: 25_000,
      budgetQuote: "$25,000 budgeted for automation",
      timeline: 75,
      timelineQuote: "live before January",
      dm: true,
      dmQuote: "I sign off on vendors",
    }, [
      { stage: "CALL_BOOKED", day: 5, learnedDay: 11, valueUsd: 25_000 },
      { stage: "PROPOSAL", day: 15, learnedDay: 15, valueUsd: 25_000 },
    ]),
    b("lead_b02", "Tom Brennan", "Brennan Tax Group", "Partner", 2, "Interested, but timing is tough.", {
      day: 3,
      text: "Not until after tax season. Maybe next summer.",
      timeline: 240,
      timelineQuote: "Maybe next summer",
    }),
    b("lead_b03", "Rachel Stein", "Stein Accounting", "Founding partner", 3, "Our close is a mess of email threads.", {
      day: 6,
      text: "We can commit $18,000. Timeline is about 60 days. I have final say.",
      budget: 18_000,
      budgetQuote: "We can commit $18,000",
      timeline: 60,
      timelineQuote: "about 60 days",
      dm: true,
      dmQuote: "I have final say",
      duplicate: true,
    }, [
      { stage: "CALL_BOOKED", day: 7, learnedDay: 11, valueUsd: 18_000 },
      { stage: "PROPOSAL", day: 13, learnedDay: 13, valueUsd: 18_000 },
      { stage: "WON", day: 20, learnedDay: 21, valueUsd: 18_000 },
    ]),
    b("lead_b04", "Luis Ortega", "Ortega CPA", "Owner", 5, "12 staff, close takes 8 days.", {
      day: 6,
      text: "$30k if it actually cuts the close in half. Next 90 days. Yes, my decision.",
      budget: 30_000,
      budgetQuote: "$30k if it actually cuts the close in half",
      timeline: 90,
      timelineQuote: "Next 90 days",
      dm: true,
      dmQuote: "Yes, my decision",
    }, [{ stage: "CALL_BOOKED", day: 12, learnedDay: 12, valueUsd: 30_000 }]),
    b("lead_b05", "Grace Liu", "Liu & Partners", "Partner", 6, "Reconciliations are killing us.", {
      day: 7,
      text: "Budget around $20k. 30 to 60 days. I am the managing partner.",
      budget: 20_000,
      budgetQuote: "around $20k",
      timeline: 60,
      timelineQuote: "30 to 60 days",
      dm: true,
      dmQuote: "I am the managing partner",
    }),
    b("lead_b06", "Aaron Feld", "Feld Advisory", "Partner", 8, "Want the close under 4 days.", {
      day: 9,
      text: "$15,000. Within the quarter. I decide.",
      budget: 15_000,
      budgetQuote: "$15,000",
      timeline: 80,
      timelineQuote: "Within the quarter",
      dm: true,
      dmQuote: "I decide",
    }),
    b("lead_b07", "Monica Hart", "Hart CPA Group", "Partner", 9, "Clients wait too long for monthly packs.", {
      day: 11,
      text: "We could do $12k. 90 days. I am a partner and can approve it.",
      budget: 12_000,
      budgetQuote: "We could do $12k",
      timeline: 90,
      timelineQuote: "90 days",
      dm: true,
      dmQuote: "can approve it",
    }),
    b("lead_b08", "Kevin Doyle", "Doyle & Co", "Partner", 10, "Looking at close automation.", {
      day: 13,
      text: "$20k, 60 days, my call.",
      budget: 20_000,
      budgetQuote: "$20k",
      timeline: 60,
      timelineQuote: "60 days",
      dm: true,
      dmQuote: "my call",
    }),
    b("lead_b09", "Sara Kim", "Kim Bookkeeping & Tax", "Owner", 12, "Small team, want to grow without hiring.", {
      day: 16,
      text: "Probably $8,000 at most this year.",
      budget: 8_000,
      budgetQuote: "$8,000 at most",
    }),
    b("lead_b10", "Nate Pruitt", "Pruitt CPA", "Partner", 13, "Need a faster close before year end.", {
      day: 16,
      text: "$22k approved. 45 days. I own the decision.",
      budget: 22_000,
      budgetQuote: "$22k approved",
      timeline: 45,
      timelineQuote: "45 days",
      dm: true,
      dmQuote: "I own the decision",
    }),
  );

  // One organic lead with no UTM. Qualifies, never credited to A or B.
  leads.push({
    id: "lead_u01",
    name: "Jordan Blake",
    company: "Blake Wealth & Tax",
    role: "Principal",
    campaignId: null,
    capturedDay: 4,
    form: "A friend forwarded your post. No idea which ad.",
    reply: {
      day: 8,
      text: "$20,000 is realistic, 60 days, I own the firm.",
      budget: 20_000,
      budgetQuote: "$20,000 is realistic",
      timeline: 60,
      timelineQuote: "60 days",
      dm: true,
      dmQuote: "I own the firm",
    },
  });
  return leads;
}

const LEADS = buildLeads();

/* ------------------------------------------------------------------ beliefs */

const BELIEFS: BeliefView[] = [
  {
    id: "belief_v1",
    version: 1,
    day: 3,
    status: "LEANING",
    favors: A,
    probability: 0.78,
    statement: "Leaning A. Two of three resolved A leads qualify at a $50 cost per lead. B's only resolved lead is not a fit.",
    recommendation: "Keep both campaigns running. Do not scale A yet: 3 resolved A leads and 1 resolved B lead is thin evidence.",
    nextTest: "Ask every open lead for budget, timeline and decision maker within 2 days.",
    evidence: [
      { eventId: "evt_lead_a01_qualified", day: 1, label: "Marco Reyes (A) qualified, $10,000" },
      { eventId: "evt_lead_a02_qualified", day: 2, label: "Dana Whitfield (A) qualified, $12,000" },
      { eventId: "evt_lead_b02_fields", day: 3, label: "Tom Brennan (B) not a fit, timeline 240 days" },
    ],
    policyVersion: 1,
    rulesVersion: 1,
  },
  {
    id: "belief_v2",
    version: 2,
    day: 6,
    status: "INSUFFICIENT",
    favors: null,
    probability: null,
    statement: "Mixed evidence. B partners now reply with real budgets while most A follow-ups reveal no budget. Neither campaign clears the bar.",
    recommendation: "Hold budgets flat and keep collecting answers. No winner on thin samples.",
    nextTest: "Resolve at least 3 leads per campaign before leaning again.",
    evidence: [
      { eventId: "evt_lead_b01_qualified", day: 5, label: "Helen Okafor (B) qualified, $25,000" },
      { eventId: "evt_lead_b03_qualified", day: 6, label: "Rachel Stein (B) qualified, $18,000" },
      { eventId: "evt_lead_a05_fields", day: 5, label: "A follow-up: not the decision maker" },
      { eventId: "evt_lead_a08_fields", day: 6, label: "A follow-up: maybe next year" },
    ],
    revisedFrom: {
      version: 1,
      status: "LEANING",
      favors: A,
      statement: "Leaning A. Two of three resolved A leads qualify at a $50 cost per lead. B's only resolved lead is not a fit.",
    },
    changes: [
      "Status: leaning A to insufficient",
      "B resolved leads 1 to 5, qualified 0 to 3",
      "A resolved leads 3 to 9, qualified 2 to 3",
      "Qualified per dollar is now even: $350 per qualified lead on both",
    ],
    policyVersion: 1,
    rulesVersion: 1,
  },
  {
    id: "belief_v3",
    version: 3,
    day: 9,
    status: "LEANING",
    favors: B,
    probability: 0.84,
    statement: "Leaning B. Counting only resolved leads, B yields more qualified leads per dollar: $300 per qualified lead against $500 for A.",
    recommendation: "Hold budgets flat. Keep asking A's open leads; B answers slower, but the answers are real.",
    nextTest: "Confirm calls and outcomes for B's qualified leads by Day 14.",
    evidence: [
      { eventId: "evt_lead_b04_qualified", day: 6, label: "Luis Ortega (B) qualified, $30,000" },
      { eventId: "evt_lead_b05_qualified", day: 7, label: "Grace Liu (B) qualified, $20,000" },
      { eventId: "evt_lead_b06_qualified", day: 9, label: "Aaron Feld (B) qualified, $15,000" },
      { eventId: "evt_curve_flip_d7", day: 7, label: "Cost per qualified ranking flipped on Day 7" },
    ],
    revisedFrom: {
      version: 1,
      status: "LEANING",
      favors: A,
      statement: "Leaning A. Two of three resolved A leads qualify at a $50 cost per lead. B's only resolved lead is not a fit.",
    },
    changes: [
      "Favored campaign: A to B",
      "Cost per qualified lead: A $500, B $300 (Day 3: A $300, B unknown)",
      "Resolved leads: A 15, B 6 (policy v2 requires 3 per campaign)",
      "P(B yields more qualified leads per dollar) = 0.84",
    ],
    policyVersion: 2,
    rulesVersion: 1,
  },
  {
    id: "belief_v4",
    version: 4,
    day: 11,
    status: "SUPPORTED",
    favors: B,
    probability: 0.93,
    statement: "Supported: B yields more qualified leads per dollar ($300 against $450), and two B calls were already booked on Days 5 and 7.",
    recommendation: "Move the next test budget toward B's angle. Do not scale anything until outcomes land.",
    nextTest: "Check outcomes for B's booked calls on Day 14 and Day 21.",
    evidence: [
      { eventId: "evt_lead_b01_outcome_0", day: 5, label: "Call booked Day 5, learned Day 11 (CRM sync)" },
      { eventId: "evt_lead_b03_outcome_0", day: 7, label: "Call booked Day 7, learned Day 11 (CRM sync)" },
      { eventId: "evt_lead_b07_qualified", day: 11, label: "Monica Hart (B) qualified, $12,000" },
    ],
    revisedFrom: {
      version: 3,
      status: "LEANING",
      favors: B,
      statement: "Leaning B. Counting only resolved leads, B yields more qualified leads per dollar: $300 per qualified lead against $500 for A.",
    },
    changes: [
      "Status: leaning to supported",
      "Two calls learned late: booked Day 5 and Day 7, learned Day 11",
      "Resolved leads: A 18, B 7. Qualified: A 4, B 6",
      "P 0.84 to 0.93",
    ],
    policyVersion: 2,
    rulesVersion: 1,
  },
  {
    id: "belief_v5",
    version: 5,
    day: 21,
    status: "SUPPORTED",
    favors: B,
    probability: 0.97,
    statement:
      "Supported: B closed $18,000 and holds $55,000 in open pipeline. A's only booked call ghosted. Doubling A on Day 3 would have spent $1,500 more for about 30 more leads, roughly 3 more qualified, and no revenue so far.",
    recommendation: "Scale B's angle in the next test window. Retire A's broad free-audit angle.",
    nextTest: "Test the B offer for bookkeeping firms (adjacent segment) at $150 a day for 14 days, outcomes tracked to Day 30.",
    evidence: [
      { eventId: "evt_lead_b03_outcome_2", day: 20, label: "Stein Accounting (B) won, $18,000" },
      { eventId: "evt_lead_a01_outcome_1", day: 16, label: "Reyes Landscaping (A) call ghosted" },
      { eventId: "evt_lead_b10_qualified", day: 16, label: "Nate Pruitt (B) qualified, $22,000" },
    ],
    revisedFrom: {
      version: 4,
      status: "SUPPORTED",
      favors: B,
      statement: "Supported: B yields more qualified leads per dollar ($300 against $450), and two B calls were already booked on Days 5 and 7.",
    },
    changes: [
      "Won: $18,000 from Stein Accounting (B)",
      "A's only booked call ghosted on Day 16",
      "Pipeline: B $55,000, A $0",
      "P 0.93 to 0.97",
    ],
    policyVersion: 2,
    rulesVersion: 1,
  },
];

const LESSONS: LessonView[] = [
  {
    id: "lesson_1",
    day: 9,
    text: "My Day 3 read favored fast responders. Busy buyers answer late, so the first resolved leads over-represent the cheap, fast campaign. Policy v2: require at least 3 resolved leads per campaign before leaning.",
    policyFrom: 1,
    policyTo: 2,
    evidence: [
      { eventId: "belief_v1", day: 3, label: "Belief v1 leaned A on 3 resolved A leads, 1 resolved B lead" },
      { eventId: "evt_lead_b01_qualified", day: 5, label: "B replies arrived on Days 5 to 9" },
      { eventId: "evt_curve_flip_d7", day: 7, label: "Cost per qualified flipped to B on Day 7" },
    ],
  },
];

/* ------------------------------------------------------------------ state */

type RunFate = "INTERRUPTED" | "RESUMED";
interface MockState {
  beat: number;
  chaosArmed: boolean;
  fates: Record<number, RunFate>;
  replays: number;
}

const initialState = (): MockState => ({ beat: 0, chaosArmed: false, fates: {}, replays: 0 });
let S: MockState = initialState();

/* ------------------------------------------------------------------ helpers */

const iso = (day: number) => new Date(START_MS + day * DAY_MS).toISOString();
const spendThrough = (d: number) => (d < 0 ? 0 : DAILY_SPEND * (Math.min(d, TEST_WINDOW - 1) + 1));
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const unknown = <T,>(): FieldValue<T> => ({ value: null, status: "UNKNOWN" });

function statusOf(l: LeadSpec, v: number) {
  const r = l.reply && l.reply.day <= v ? l.reply : undefined;
  const budget = r?.budget ?? null;
  const timeline = r?.timeline ?? null;
  const dm = r?.dm ?? null;
  const reasons: string[] = [];
  const missing: FieldKey[] = [];
  let fail = false;
  if (budget === null) missing.push("budgetUsd");
  else if (budget < RULES.minBudgetUsd) {
    fail = true;
    reasons.push(`Budget ${money(budget)} is below the ${money(RULES.minBudgetUsd)} minimum`);
  } else reasons.push(`Budget ${money(budget)} meets the ${money(RULES.minBudgetUsd)} minimum`);
  if (timeline === null) missing.push("timelineDays");
  else if (timeline > RULES.maxTimelineDays) {
    fail = true;
    reasons.push(`Timeline ${timeline} days exceeds ${RULES.maxTimelineDays}`);
  } else reasons.push(`Timeline ${timeline} days is within ${RULES.maxTimelineDays}`);
  if (dm === null) missing.push("decisionMaker");
  else if (!dm) {
    fail = true;
    reasons.push("Not the decision maker");
  } else reasons.push("Decision maker confirmed");
  const status: LeadStatus = fail ? "NOT_A_FIT" : missing.length ? "UNRESOLVED" : "QUALIFIED";
  if (status === "UNRESOLVED") reasons.push(`Waiting on ${missing.length} field${missing.length > 1 ? "s" : ""}`);
  return { status, reasons, missing, reply: r };
}

const QUESTIONS: Record<FieldKey, string> = {
  budgetUsd: "Roughly what budget have you set aside to fix this in the next quarter?",
  timelineDays: "When would you want this running: this month, this quarter, or later?",
  decisionMaker: "Who else would weigh in on a decision like this?",
  problem: "What is the one process you would most like to take off your plate?",
};

function wakeDays(beat: number): number[] {
  return Array.from(new Set(BEAT_DAYS.slice(0, beat + 1)));
}

function leadView(l: LeadSpec, v: number, wakes: number[]): LeadView {
  const { status, reasons, missing, reply } = statusOf(l, v);
  const src = (quote?: string) =>
    reply ? { eventId: `evt_${l.id}_fields`, day: reply.day, quote, provider: "rules" as const } : undefined;
  const fv = <T,>(val: T | null | undefined, quote?: string): FieldValue<T> =>
    val === null || val === undefined ? unknown<T>() : { value: val, status: "CONFIRMED", source: src(quote) };
  const draftDay = wakes.find((w) => w >= l.capturedDay && w <= v && !(l.reply && l.reply.day <= w));
  const messages: LeadView["messages"] = [{ day: l.capturedDay, from: "lead", text: l.form }];
  if (draftDay !== undefined) {
    const firstMissing = statusOf(l, draftDay).missing[0];
    if (firstMissing) messages.push({ day: draftDay, from: "agent-draft", text: QUESTIONS[firstMissing] });
  }
  if (reply) messages.push({ day: reply.day, from: "lead", text: reply.text });
  return {
    id: l.id,
    name: l.name,
    company: l.company,
    role: l.role,
    campaignId: l.campaignId,
    capturedDay: l.capturedDay,
    fields: {
      budgetUsd: fv<number>(reply?.budget, reply?.budgetQuote),
      timelineDays: fv<number>(reply?.timeline, reply?.timelineQuote),
      decisionMaker: fv<boolean>(reply?.dm, reply?.dmQuote),
      problem: { value: l.form, status: "CONFIRMED", source: { eventId: `evt_${l.id}_captured`, day: l.capturedDay, quote: l.form, provider: "user" } },
    },
    status,
    reasons,
    missing,
    nextQuestion: status === "UNRESOLVED" && missing[0] ? QUESTIONS[missing[0]] : null,
    rulesVersion: RULES.version,
    outcomes: (l.outcomes ?? []).filter((o) => o.learnedDay <= v),
    messages: messages.sort((x, y) => x.day - y.day),
  };
}

function campaignView(id: string, v: number, leads: LeadView[]): CampaignView {
  const mine = leads.filter((l) => l.campaignId === id);
  const spend = spendThrough(v);
  const q = mine.filter((l) => l.status === "QUALIFIED").length;
  const outcomes = mine.flatMap((l) => l.outcomes.map((o) => ({ ...o, lead: l })));
  let pipeline = 0;
  let won = 0;
  for (const l of mine) {
    if (!l.outcomes.length) continue;
    const last = l.outcomes[l.outcomes.length - 1];
    if (last.stage === "WON") won += last.valueUsd ?? 0;
    else if (last.stage === "CALL_BOOKED" || last.stage === "PROPOSAL") pipeline += last.valueUsd ?? 0;
  }
  const isA = id === A;
  return {
    id,
    key: isA ? "A" : "B",
    name: isA ? "Free AI Audit" : "Close-the-books Autopilot",
    angle: isA ? "A free 30-minute AI audit for any small business" : "Month-end close automation for CPA firms",
    audience: isA ? "Small business owners, broad" : "CPA firm partners, 5 to 50 staff",
    offer: isA ? "Free AI audit" : "Close-the-books Autopilot pilot",
    creative: isA
      ? { headline: "Get a free AI audit for your business", body: "Find out where AI can save you 10 hours a week. Thirty minutes, no cost.", cta: "Book my free audit" }
      : { headline: "Close the books in 3 days, not 10", body: "An AI close assistant for CPA firms with 5 to 50 staff. Implemented with you, reviewed by your team.", cta: "See the 3-day close" },
    spendUsd: spend,
    leads: mine.length,
    cplUsd: mine.length ? spend / mine.length : null,
    qualified: q,
    unresolved: mine.filter((l) => l.status === "UNRESOLVED").length,
    notAFit: mine.filter((l) => l.status === "NOT_A_FIT").length,
    costPerQualifiedUsd: q ? spend / q : null,
    callsBooked: outcomes.filter((o) => o.stage === "CALL_BOOKED").length,
    pipelineUsd: pipeline,
    wonUsd: won,
  };
}

function curves(v: number): WorldView["curves"] {
  const byCampaign: Record<string, CurvePoint[]> = { [A]: [], [B]: [] };
  let flipDay: number | null = null;
  for (let d = 0; d <= v; d++) {
    const pts: Record<string, CurvePoint> = {};
    for (const id of [A, B]) {
      const leads = LEADS.filter((l) => l.campaignId === id && l.capturedDay <= d);
      const q = leads.filter((l) => statusOf(l, d).status === "QUALIFIED").length;
      const spend = spendThrough(d);
      pts[id] = {
        day: d,
        leads: leads.length,
        qualified: q,
        cplUsd: leads.length ? spend / leads.length : null,
        costPerQualifiedUsd: q ? spend / q : null,
      };
      byCampaign[id].push(pts[id]);
    }
    const a = pts[A];
    const b = pts[B];
    if (
      flipDay === null &&
      a.cplUsd !== null &&
      b.cplUsd !== null &&
      a.costPerQualifiedUsd !== null &&
      b.costPerQualifiedUsd !== null &&
      Math.sign(a.cplUsd - b.cplUsd) !== 0 &&
      Math.sign(a.costPerQualifiedUsd - b.costPerQualifiedUsd) === -Math.sign(a.cplUsd - b.cplUsd)
    ) {
      flipDay = d;
    }
  }
  return { byCampaign, flipDay };
}

/* commitments: ASK_MISSING per unresolved lead at each wake, plus scheduled checks */
function commitments(v: number, wakes: number[], fates: Record<number, RunFate>): CommitmentView[] {
  const out: CommitmentView[] = [];
  const step4Done = (w: number) => fates[w] !== "INTERRUPTED";
  const keptAt = (due: number) => wakes.find((w) => w >= due && w <= v && step4Done(w));
  const hasOpen = new Set<string>();
  for (const w of wakes) {
    if (w > v || w === 0 || !step4Done(w)) continue;
    for (const l of LEADS) {
      if (l.capturedDay > w || hasOpen.has(l.id)) continue;
      const st = statusOf(l, w);
      if (st.status !== "UNRESOLVED") continue;
      hasOpen.add(l.id);
      const due = w + 2;
      const answered = l.reply && l.reply.day <= v && l.reply.day <= due ? l.reply.day : null;
      const kept = answered === null ? keptAt(due) : undefined;
      const state: CommitmentView["state"] = answered !== null ? "CANCELLED" : kept !== undefined ? "KEPT" : due < v ? "OVERDUE" : "OPEN";
      out.push({
        id: `cmt_ask_${l.id}_d${w}`,
        kind: "ASK_MISSING",
        leadId: l.id,
        title: `Ask ${l.name.split(" ")[0]} for ${st.missing[0] === "budgetUsd" ? "budget" : st.missing[0] === "timelineDays" ? "timeline" : "decision maker"}`,
        reason: answered !== null ? `Answer arrived on Day ${answered}, before the follow-up was due` : `${st.missing.length} field${st.missing.length > 1 ? "s" : ""} unknown, question drafted (not sent)`,
        createdDay: w,
        dueDay: due,
        state,
        keptDay: kept,
        runId: `run_d${w}`,
      });
    }
  }
  const scheduled: { id: string; kind: CommitmentView["kind"]; title: string; reason: string; created: number; due: number; leadId?: string }[] = [
    { id: "cmt_rescan_d14", kind: "MARKET_RESCAN", title: "Re-scan competitor offers for both hypotheses", reason: "Market evidence older than 14 days is stale", created: 0, due: 14 },
    { id: "cmt_review_policy", kind: "REVIEW", title: "Review policy v2 against Day 14 evidence", reason: "Lesson recorded on Day 9 changed the lean threshold", created: 9, due: 14 },
    { id: "cmt_outcome_a01", kind: "CHECK_OUTCOME", title: "Check outcome of Marco Reyes call", reason: "Call booked Day 8", created: 9, due: 16, leadId: "lead_a01" },
    { id: "cmt_outcome_b03", kind: "CHECK_OUTCOME", title: "Check outcome of Rachel Stein call", reason: "Call booked Day 7, learned Day 11", created: 11, due: 14, leadId: "lead_b03" },
    { id: "cmt_outcome_b01", kind: "CHECK_OUTCOME", title: "Check outcome of Helen Okafor call", reason: "Call booked Day 5, learned Day 11", created: 11, due: 21, leadId: "lead_b01" },
    { id: "cmt_outcome_b04", kind: "CHECK_OUTCOME", title: "Check outcome of Luis Ortega call", reason: "Call booked Day 12", created: 14, due: 21, leadId: "lead_b04" },
    { id: "cmt_final_d30", kind: "CHECK_OUTCOME", title: "Final outcome check for every qualified lead", reason: "Outcomes are tracked to Day 30", created: 14, due: 30 },
  ];
  for (const c of scheduled) {
    const createdWake = wakes.find((w) => w >= c.created && w <= v && step4Done(w));
    if (createdWake === undefined) continue;
    const kept = keptAt(c.due);
    out.push({
      id: c.id,
      kind: c.kind,
      leadId: c.leadId,
      title: c.title,
      reason: c.reason,
      createdDay: createdWake,
      dueDay: c.due,
      state: kept !== undefined ? "KEPT" : c.due < v ? "OVERDUE" : "OPEN",
      keptDay: kept,
      runId: `run_d${createdWake}`,
    });
  }
  return out;
}

const STEP_NAMES = ["Ingest", "Extract", "Qualify", "Commitments", "Metrics", "Decide", "Market"];

function runFor(w: number, prev: number, v: number, fate?: RunFate): RunView[] {
  const captured = LEADS.filter((l) => l.capturedDay > prev && l.capturedDay <= w).length;
  const replies = LEADS.filter((l) => l.reply && l.reply.day > prev && l.reply.day <= w).length;
  const late = LEADS.flatMap((l) => l.outcomes ?? []).filter((o) => o.learnedDay > prev && o.learnedDay <= w && o.learnedDay > o.day).length;
  const statuses = LEADS.filter((l) => l.capturedDay <= w).map((l) => statusOf(l, w).status);
  const qn = statuses.filter((s) => s === "QUALIFIED").length;
  const fn = statuses.filter((s) => s === "NOT_A_FIT").length;
  const un = statuses.filter((s) => s === "UNRESOLVED").length;
  const cm = commitments(w, wakeDays(S.beat).filter((x) => x <= w), {}).filter((c) => c.createdDay === w || c.keptDay === w);
  const created = cm.filter((c) => c.createdDay === w).length;
  const keptN = cm.filter((c) => c.keptDay === w).length;
  const belief = BELIEFS.find((b) => b.day === w);
  const lesson = LESSONS.find((l) => l.day === w);
  const cA = curves(w).byCampaign[A][w];
  const cB = curves(w).byCampaign[B][w];
  const fmt = (n: number | null) => (n === null ? "unknown" : money(n));
  const summaries = [
    `${captured + replies + late} events materialized (${captured} leads, ${replies} replies${late ? `, ${late} late` : ""})${w === 6 ? ", 1 duplicate ignored" : ""}`,
    replies ? `Fields extracted from ${replies} repl${replies === 1 ? "y" : "ies"} (rules fallback)` : "No new replies to extract",
    `${qn} qualified, ${fn} not a fit, ${un} unresolved (rules v1)`,
    `${created} created, ${keptN} kept`,
    `Cost per qualified: A ${fmt(cA.costPerQualifiedUsd)}, B ${fmt(cB.costPerQualifiedUsd)} (computed locally)`,
    belief ? `Belief v${belief.version} ${belief.status.toLowerCase()}${belief.favors ? ` ${belief.favors === A ? "A" : "B"}` : ""}${lesson ? `, lesson recorded, policy v${lesson.policyTo}` : ""}` : w === 0 ? "No evidence yet, no belief recorded" : "No change in status or favored campaign",
    w === 0 || w === 14 ? "Nimble blocked: no key, no sources invented" : "No market scan due",
  ];
  const drafts = LEADS.filter((l) => l.capturedDay <= w && statusOf(l, w).status === "UNRESOLVED").slice(0, 4);
  const effects: RunView["effects"] = [
    ...drafts.map((l) => ({ key: `d${w}:draft:ask:${l.id}`, kind: "DRAFT_QUESTION", state: "PERFORMED" as const })),
    ...(belief ? [{ key: `d${w}:belief:v${belief.version}`, kind: "BELIEF_RECORD", state: "PERFORMED" as const }] : []),
    ...(lesson ? [{ key: `d${w}:lesson:${lesson.id}`, kind: "LESSON_RECORD", state: "PERFORMED" as const }] : []),
  ];
  const steps = (fn: (n: number) => RunView["steps"][number]["state"]) =>
    STEP_NAMES.map((name, i) => ({ n: i + 1, name, state: fn(i + 1), summary: summaries[i] }));
  if (fate === "INTERRUPTED" || fate === "RESUMED") {
    const partial = effects.slice(0, 2);
    const dead: RunView = {
      id: `run_d${w}`,
      day: w,
      trigger: "BEAT",
      state: "INTERRUPTED",
      steps: steps((n) => (n <= 3 ? "DONE" : "PENDING")).map((s) => (s.n > 3 ? { ...s, summary: undefined } : s)),
      effects: partial,
      costUsd: 0,
    };
    if (fate === "INTERRUPTED" || v < w) return [dead];
    const resumed: RunView = {
      id: `run_d${w}_resume`,
      day: w,
      trigger: "RESUME",
      state: "COMPLETED",
      steps: steps((n) => (n <= 3 ? "SKIPPED_ALREADY_DONE" : "DONE")),
      effects: [
        ...partial.map((e) => ({ ...e, state: "SKIPPED_DUPLICATE" as const })),
        ...effects.slice(2),
        { key: `d${w}:keep:cmt_rescan_d14`, kind: "COMMITMENT_KEPT", state: "PERFORMED" },
        { key: `d${w}:keep:cmt_outcome_b03`, kind: "COMMITMENT_KEPT", state: "PERFORMED" },
      ],
      resumedFromStep: 4,
      costUsd: 0,
    };
    return [resumed, dead];
  }
  return [{ id: `run_d${w}`, day: w, trigger: "BEAT", state: "COMPLETED", steps: steps(() => "DONE"), effects, costUsd: 0 }];
}

const PROVIDERS: WorldView["providers"] = {
  nimble: { status: "BLOCKED", detail: "NIMBLE_API_KEY is not set. No market calls made, no sources invented." },
  liquid: { status: "READY", detail: "Key present, no successful call yet in this workspace. The public demo uses the rules extractor." },
  tinybird: { status: "BLOCKED", detail: "TINYBIRD_TOKEN is not set. Metrics are computed locally from the ledger." },
};

function receipts(wakes: number[], v: number): ReceiptView[] {
  const out: ReceiptView[] = [];
  let k = 0;
  const push = (day: number, provider: ProviderName, operation: string, status: ProviderStatus, note: string) =>
    out.push({ id: `rcpt_${k}`, provider, operation, status, day, wallTime: new Date(Date.UTC(2026, 8, 25, 18, 0, k++ * 7)).toISOString(), note });
  for (const w of wakes) {
    if (w > v) continue;
    const replies = LEADS.filter((l) => l.reply && l.reply.day <= w).length;
    if (w === 0 || w === 14) push(w, "nimble", "market.scan", "BLOCKED", "No API key, no call made, no sources invented");
    if (replies) push(w, "liquid", "extract.fields", "READY", "Rules fallback used, no model call, $0.00");
    push(w, "tinybird", "events.mirror", "BLOCKED", "No token, metrics computed locally");
  }
  return out.reverse();
}

function market(wakes: number[], v: number): MarketSignal[] {
  const out: MarketSignal[] = [];
  for (const w of wakes.filter((x) => (x === 0 || x === 14) && x <= v)) {
    out.push({ id: `mkt_a_d${w}`, campaignId: A, query: "free AI audit offer for small business", day: w, status: "BLOCKED", sources: [] });
    out.push({ id: `mkt_b_d${w}`, campaignId: B, query: "month-end close automation for CPA firms", day: w, status: "BLOCKED", sources: [] });
  }
  return out;
}

function ledger(v: number, wakes: number[], fates: Record<number, RunFate>, replays: number): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  const add = (id: string, type: string, occurredDay: number, learnedDay: number, lane: string, label: string, source: string) => {
    if (learnedDay > v) return;
    out.push({ id, type, occurredDay, learnedDay, lane, label, late: learnedDay > occurredDay, source });
  };
  add("evt_launch_a", "campaign.launched", 0, 0, A, "Campaign A launched at $150/day", "scenario");
  add("evt_launch_b", "campaign.launched", 0, 0, B, "Campaign B launched at $150/day", "scenario");
  add("evt_rules_v1", "rules.versioned", 0, 0, "agent", "Qualification rules v1", "agent");
  add("evt_policy_v1", "policy.versioned", 0, 0, "agent", "Decision policy v1", "agent");
  for (const l of LEADS) {
    const lane = l.campaignId ?? "unknown";
    add(`evt_${l.id}_captured`, "lead.captured", l.capturedDay, l.capturedDay, lane, `${l.name} captured`, "webhook");
    if (l.reply) {
      add(`evt_${l.id}_reply1`, "lead.replied", l.reply.day, l.reply.day, lane, `${l.name} replied`, "webhook");
      const st = statusOf(l, l.reply.day).status;
      if (st === "QUALIFIED") add(`evt_${l.id}_qualified`, "lead.qualified", l.reply.day, l.reply.day, lane, `${l.name} qualified`, "agent");
    }
    (l.outcomes ?? []).forEach((o, i) =>
      add(`evt_${l.id}_outcome_${i}`, "outcome.recorded", o.day, o.learnedDay, lane, `${l.name}: ${o.stage.replace("_", " ").toLowerCase()}${o.valueUsd && o.stage === "WON" ? ` ${money(o.valueUsd)}` : ""}`, o.learnedDay > o.day ? "crm-sync" : "crm"),
    );
  }
  add("evt_dup_b03", "webhook.duplicate_ignored", 6, 6, "agent", "Duplicate webhook ignored (same externalId)", "webhook");
  for (let i = 0; i < replays; i++) add(`evt_replay_${i}`, "webhook.duplicate_ignored", wakes[wakes.length - 1] ?? 0, wakes[wakes.length - 1] ?? 0, "agent", "Replayed webhook ignored (same externalId)", "webhook");
  for (const b of BELIEFS) add(b.id, "belief.recorded", b.day, b.day, "agent", `Belief v${b.version}: ${b.status.toLowerCase()}${b.favors ? ` ${b.favors === A ? "A" : "B"}` : ""}`, "agent");
  for (const l of LESSONS) {
    add(l.id, "lesson.recorded", l.day, l.day, "agent", "Lesson: early read favored fast responders", "agent");
    add(`evt_policy_v${l.policyTo}`, "policy.versioned", l.day, l.day, "agent", `Decision policy v${l.policyTo}`, "agent");
  }
  for (const w of wakes) {
    if (w > v) continue;
    if (w === 0 || w === 14) add(`evt_market_d${w}`, "market.scanned", w, w, "market", "Market scan blocked (no Nimble key)", "nimble");
    if (fates[w] === "INTERRUPTED" || fates[w] === "RESUMED") add(`evt_chaos_d${w}`, "chaos.fired", w, w, "agent", "Worker killed after step 3", "chaos");
    if (fates[w] === "RESUMED") add(`evt_resume_d${w}`, "run.resumed", w, w, "agent", "Run resumed from step 4", "agent");
    if (fates[w] !== "INTERRUPTED") add(`evt_run_d${w}`, "run.completed", w, w, "agent", `Wake on Day ${w} completed`, "agent");
  }
  // Only beliefs recorded by wakes that already ran.
  return out
    .filter((e) => e.type !== "belief.recorded" || wakes.includes(e.learnedDay))
    .sort((x, y) => x.learnedDay - y.learnedDay || x.occurredDay - y.occurredDay);
}

/* ------------------------------------------------------------------ projection */

function project(state: MockState, asOf?: number | null): WorldView {
  const clockDay = BEAT_DAYS[state.beat];
  const v = asOf === undefined || asOf === null || Number.isNaN(asOf) ? clockDay : Math.max(0, Math.min(clockDay, Math.round(asOf)));
  const allWakes = wakeDays(state.beat);
  const wakes = allWakes.filter((w) => w <= v);
  const leads = LEADS.filter((l) => l.capturedDay <= v).map((l) => leadView(l, v, wakes));
  const campaigns = [campaignView(A, v, leads), campaignView(B, v, leads)];
  const unknownLeads = leads.filter((l) => l.campaignId === null);
  const beliefs = BELIEFS.filter((b) => b.day <= v && wakes.includes(b.day) && state.fates[b.day] !== "INTERRUPTED");
  const lessons = LESSONS.filter((l) => l.day <= v && wakes.includes(l.day));
  const policyVersion = lessons.length ? lessons[lessons.length - 1].policyTo : 1;
  const runs: RunView[] = [];
  wakes.forEach((w, i) => runs.unshift(...runFor(w, i === 0 ? -1 : wakes[i - 1], v, state.fates[w]).reverse()));
  const runsSorted = runs.sort((x, y) => y.day - x.day || (x.trigger === "RESUME" ? -1 : 1));
  const ledgerEntries = ledger(v, wakes, state.fates, v === clockDay ? state.replays : 0);
  const effectsPerformed = runsSorted.flatMap((r) => r.effects).filter((e) => e.state === "PERFORMED").length;
  const effectsSkipped = runsSorted.flatMap((r) => r.effects).filter((e) => e.state === "SKIPPED_DUPLICATE").length;
  const beat = state.beat;
  const stage: StageBeat = {
    beat,
    totalBeats: BEATS.length,
    title: BEATS[beat].title,
    caption: BEATS[beat].caption,
    nextLabel: BEATS[beat].next,
  };
  return {
    workspace: { id: "ws_mock", mode: "DEMO", label: "Demo workspace (mock)", scenario: "ai-media-q4", liveProviders: false },
    clock: { day: clockDay, iso: iso(clockDay), simulated: true, horizonDays: HORIZON },
    asOfDay: v,
    isTimeTravel: v < clockDay,
    rules: { ...RULES },
    policy: {
      version: policyVersion,
      minResolvedPerArmToLean: policyVersion >= 2 ? 3 : 1,
      minResolvedPerArmToSupport: 5,
      leanAt: 0.75,
      supportAt: 0.9,
    },
    campaigns,
    unknownAttribution: { leads: unknownLeads.length, qualified: unknownLeads.filter((l) => l.status === "QUALIFIED").length },
    leads,
    beliefs,
    currentBelief: beliefs.length ? beliefs[beliefs.length - 1] : null,
    lessons,
    commitments: commitments(v, wakes, state.fates),
    runs: runsSorted,
    ledger: ledgerEntries,
    curves: curves(v),
    market: market(wakes, v),
    receipts: receipts(wakes, v),
    providers: PROVIDERS,
    stage,
    stats: {
      events: ledgerEntries.length + runsSorted.reduce((n, r) => n + r.steps.filter((s) => s.state === "DONE").length, 0),
      duplicatesIgnored: ledgerEntries.filter((e) => e.type === "webhook.duplicate_ignored").length,
      lateEvents: ledgerEntries.filter((e) => e.late).length,
      effectsPerformed,
      effectsSkipped,
      cognitionCostUsd: 0,
    },
  };
}

/* ------------------------------------------------------------------ API surface */

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const latency = () => wait(180 + Math.round(Math.random() * 220));

function latestRun(w: WorldView): RunView | undefined {
  return w.runs[0];
}

function interruptedDay(): number | null {
  const e = Object.entries(S.fates).find(([, f]) => f === "INTERRUPTED");
  return e ? Number(e[0]) : null;
}

export const mockApi = {
  /** QA hook: /demo?beat=5 shows the interrupted Day 14 run, &resumed=1 shows it resumed. */
  applyQuery(params: URLSearchParams) {
    const beatParam = params.get("beat");
    if (beatParam === null) return;
    const beat = Math.max(0, Math.min(BEATS.length - 1, Number(beatParam) || 0));
    S = initialState();
    S.beat = beat;
    if (beat === 5) S.fates[14] = params.get("resumed") === "1" ? "RESUMED" : "INTERRUPTED";
    if (beat > 5) S.fates[14] = "RESUMED";
  },

  async state(q: { asOf?: number | null; stage?: string | null } = {}): Promise<WorldView> {
    await wait(120);
    return project(S, q.asOf);
  },

  async beat() {
    await latency();
    if (interruptedDay() !== null) throw new ApiError("A run is interrupted. Resume it before the next beat.", 409, "INTERRUPTED");
    if (S.beat >= BEATS.length - 1) return { world: project(S), run: undefined };
    S.beat += 1;
    const day = BEAT_DAYS[S.beat];
    const isNewWake = BEAT_DAYS.indexOf(day) === S.beat;
    if (S.chaosArmed && isNewWake) {
      S.chaosArmed = false;
      S.fates[day] = "INTERRUPTED";
      throw new ApiError("Worker process exited during the run (chaos).", 500);
    }
    const world = project(S);
    return { world, run: isNewWake ? latestRun(world) : undefined };
  },

  async advance(days: number) {
    await latency();
    void days;
    return { world: project(S), run: undefined };
  },

  async reset() {
    await latency();
    S = initialState();
    return { world: project(S) };
  },

  async chaos(afterStep: number) {
    await wait(120);
    void afterStep;
    S.chaosArmed = true;
    return { armed: true as const };
  },

  async replayWebhook() {
    await latency();
    S.replays += 1;
    return { duplicate: true as const, world: project(S) };
  },

  async wake() {
    await latency();
    const d = interruptedDay();
    if (d !== null) S.fates[d] = "RESUMED";
    const world = project(S);
    return { world, run: latestRun(world) as RunView };
  },

  async sendEvent(input: unknown) {
    await latency();
    void input;
    return { duplicate: false, world: project(S) };
  },

  async health(): Promise<HealthResponse> {
    await wait(150);
    return { ok: true, db: "ready", providers: PROVIDERS, deployment: "mock" };
  },

  async earlyAccess(input: { email: string }) {
    await latency();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email)) throw new ApiError("Please enter a valid email address.", 400, "BAD_EMAIL");
    return { ok: true };
  },
};
