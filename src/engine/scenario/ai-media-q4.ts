/**
 * DEMO scenario "ai-media-q4": the whole simulated world as data.
 * Fictional people and firms. Nothing here is a result: the engine computes every number from these events.
 */
import type { OutcomeStage } from '@/contract';
import { dayToIso, externalEventId, type EventType } from '../events';

export const SCENARIO_ID = 'ai-media-q4';
export const HORIZON = 30;
export const DAILY_SPEND_USD = 150;
export const TEST_DAYS = 14;

export interface ScenarioCampaign {
  id: 'A' | 'B';
  key: 'A' | 'B';
  name: string;
  angle: string;
  audience: string;
  offer: string;
  creative: { headline: string; body: string; cta: string };
  dailySpendUsd: number;
  testDays: number;
  marketQuery: string;
  adjacentSegment: { name: string; query: string };
}

export const CAMPAIGNS: ScenarioCampaign[] = [
  {
    id: 'A',
    key: 'A',
    name: 'Free AI Audit',
    angle: 'A free, no-commitment AI audit for any small business',
    audience: 'Small business owners, broad US audience',
    offer: 'Free 30 minute AI audit with a written action plan',
    creative: {
      headline: 'Get a free AI audit for your business',
      body: 'In 30 minutes we map where AI could take repetitive work off your team, and you keep the written plan. No cost, no commitment.',
      cta: 'Book my free audit',
    },
    dailySpendUsd: DAILY_SPEND_USD,
    testDays: TEST_DAYS,
    marketQuery: 'free AI audit offer for small businesses',
    adjacentSegment: { name: 'local service businesses with a front desk', query: 'AI front desk automation offer for local service businesses' },
  },
  {
    id: 'B',
    key: 'B',
    name: 'Close-the-books Autopilot',
    angle: 'Month-end close automation for busy CPA firms',
    audience: 'CPA firm partners, firms with 5 to 50 staff',
    offer: 'Done-with-you close automation pilot, scoped in one call',
    creative: {
      headline: 'Take the grind out of month-end close',
      body: 'For CPA firms with 5 to 50 staff: AI that reconciles, flags exceptions and drafts client follow-ups, reviewed by your team. Target outcome: a shorter close, measured in your own numbers.',
      cta: 'Scope my pilot',
    },
    dailySpendUsd: DAILY_SPEND_USD,
    testDays: TEST_DAYS,
    marketQuery: 'month-end close automation for CPA firms',
    adjacentSegment: { name: 'bookkeeping firms that serve small CPA practices', query: 'month-end close automation for bookkeeping firms' },
  },
];

export interface ScenarioLead {
  id: string;
  name: string;
  company: string;
  role: string;
  campaignId: 'A' | 'B' | null;
  utm: string | null;
  day: number;
  hour: number;
}

export const LEADS: ScenarioLead[] = [
  { id: 'A01', name: 'Maya Okafor', company: 'Okafor Family Dental', role: 'Owner', campaignId: 'A', utm: 'meta_free_ai_audit', day: 0, hour: 1 },
  { id: 'A02', name: 'Diego Ramirez', company: 'Ramirez Landscaping', role: 'Owner', campaignId: 'A', utm: 'meta_free_ai_audit', day: 0, hour: 3 },
  { id: 'A03', name: 'Hannah Lindqvist', company: 'Lindqvist Yoga Studio', role: 'Founder', campaignId: 'A', utm: 'meta_free_ai_audit', day: 0, hour: 5 },
  { id: 'A04', name: 'Samuel Adeyemi', company: 'Adeyemi Auto Repair', role: 'Owner', campaignId: 'A', utm: 'meta_free_ai_audit', day: 1, hour: 1 },
  { id: 'A05', name: 'Priya Nair', company: 'Nair Physical Therapy', role: 'Office Manager', campaignId: 'A', utm: 'meta_free_ai_audit', day: 1, hour: 4 },
  { id: 'A06', name: 'Tom Becker', company: 'Becker Home Inspections', role: 'Owner', campaignId: 'A', utm: 'meta_free_ai_audit', day: 1, hour: 6 },
  { id: 'A07', name: 'Aisha Rahman', company: 'Rahman Tutoring', role: 'Founder', campaignId: 'A', utm: 'meta_free_ai_audit', day: 2, hour: 1 },
  { id: 'A08', name: "Kevin O'Brien", company: "O'Brien Plumbing", role: 'Office Lead', campaignId: 'A', utm: 'meta_free_ai_audit', day: 2, hour: 3 },
  { id: 'A09', name: 'Lucia Ferreira', company: 'Ferreira Bakery', role: 'Owner', campaignId: 'A', utm: 'meta_free_ai_audit', day: 2, hour: 5 },
  { id: 'A10', name: 'Marcus Chen', company: 'Chen Fitness', role: 'Owner', campaignId: 'A', utm: 'meta_free_ai_audit', day: 3, hour: 1 },
  { id: 'A11', name: 'Fatima Al-Sayed', company: 'Sayed Boutique', role: 'Owner', campaignId: 'A', utm: 'meta_free_ai_audit', day: 3, hour: 3 },
  { id: 'A12', name: 'Jonah Weiss', company: 'Weiss Photography', role: 'Owner', campaignId: 'A', utm: 'meta_free_ai_audit', day: 3, hour: 6 },
  { id: 'A13', name: 'Grace Kim', company: 'Kim Cleaning Co', role: 'Owner', campaignId: 'A', utm: 'meta_free_ai_audit', day: 4, hour: 2 },
  { id: 'A14', name: 'Rahul Mehta', company: 'Mehta Printing', role: 'Operations Lead', campaignId: 'A', utm: 'meta_free_ai_audit', day: 4, hour: 4 },
  { id: 'A15', name: 'Chloe Martin', company: 'Martin Florals', role: 'Owner', campaignId: 'A', utm: 'meta_free_ai_audit', day: 5, hour: 1 },
  { id: 'A16', name: 'Obinna Eze', company: 'Eze Mobile Detailing', role: 'Owner', campaignId: 'A', utm: 'meta_free_ai_audit', day: 5, hour: 3 },
  { id: 'A17', name: 'Sofia Rossi', company: 'Rossi Pet Grooming', role: 'Owner', campaignId: 'A', utm: 'meta_free_ai_audit', day: 6, hour: 2 },
  { id: 'A18', name: 'Daniel Park', company: 'Park Tax Prep', role: 'Owner', campaignId: 'A', utm: 'meta_free_ai_audit', day: 7, hour: 2 },
  { id: 'A19', name: 'Irina Volkova', company: 'Volkova Translations', role: 'Office Coordinator', campaignId: 'A', utm: 'meta_free_ai_audit', day: 9, hour: 1 },
  { id: 'A20', name: 'Jamal Washington', company: 'Washington Moving', role: 'Owner', campaignId: 'A', utm: 'meta_free_ai_audit', day: 11, hour: 2 },
  { id: 'B01', name: 'Dana Whitfield', company: 'Whitfield & Cole CPAs', role: 'Managing Partner', campaignId: 'B', utm: 'meta_close_autopilot', day: 0, hour: 4 },
  { id: 'B02', name: 'Arjun Patel', company: 'Patel Nguyen & Co', role: 'Founding Partner', campaignId: 'B', utm: 'meta_close_autopilot', day: 2, hour: 2 },
  { id: 'B03', name: 'Rosa Delgado', company: 'Delgado Tax & Advisory', role: 'Managing Partner', campaignId: 'B', utm: 'meta_close_autopilot', day: 3, hour: 5 },
  { id: 'B04', name: 'Thomas Mbeki', company: 'Mbeki & Associates', role: 'Owner', campaignId: 'B', utm: 'meta_close_autopilot', day: 4, hour: 3 },
  { id: 'B05', name: 'Hiroshi Tanaka', company: 'Tanaka Kaur CPA Group', role: 'Partner', campaignId: 'B', utm: 'meta_close_autopilot', day: 5, hour: 2 },
  { id: 'B06', name: 'Grace Oyelaran', company: 'Oyelaran CPAs', role: 'Managing Partner', campaignId: 'B', utm: 'meta_close_autopilot', day: 6, hour: 4 },
  { id: 'B07', name: 'William Foster', company: 'Foster & Reyes CPAs', role: 'Managing Partner', campaignId: 'B', utm: 'meta_close_autopilot', day: 8, hour: 2 },
  { id: 'B08', name: 'Nadia Haddad', company: 'Haddad Accounting', role: 'Partner', campaignId: 'B', utm: 'meta_close_autopilot', day: 12, hour: 3 },
  { id: 'U01', name: 'Leila Farouk', company: 'Farouk & Stein CPAs', role: 'Managing Partner', campaignId: null, utm: null, day: 4, hour: 5 },
];

export interface ScenarioReply {
  leadId: string;
  externalId: string;
  day: number;
  hour: number;
  text: string;
  /** Fixture expectations for tests only. The engine never reads these. */
  expect: { budgetUsd?: number | null; timelineDays?: number | null; decisionMaker?: boolean | null };
}

export const REPLIES: ScenarioReply[] = [
  // A: fast responders
  { leadId: 'A01', externalId: 'msg-A01-1', day: 1, hour: 2, text: "We have about $8k budgeted for automation this quarter. I'm the owner and I sign off on spend. Want it running within 30 days, our front desk loses hours to scheduling.", expect: { budgetUsd: 8000, timelineDays: 30, decisionMaker: true } },
  { leadId: 'A02', externalId: 'msg-A02-1', day: 1, hour: 1, text: 'Sounds interesting. What does the audit actually include?', expect: { budgetUsd: null, timelineDays: null, decisionMaker: null } },
  { leadId: 'A03', externalId: 'msg-A03-1', day: 1, hour: 4, text: 'No budget right now, just curious what AI can do.', expect: { budgetUsd: 0 } },
  { leadId: 'A04', externalId: 'msg-A04-1', day: 2, hour: 1, text: 'I run the shop and I make the call. We set aside $10k for this and want it live in the next 6 weeks. Invoicing eats my evenings.', expect: { budgetUsd: 10000, timelineDays: 42, decisionMaker: true } },
  { leadId: 'A05', externalId: 'msg-A05-1', day: 2, hour: 3, text: "I'm just the office manager, the owner would have to approve anything like this.", expect: { decisionMaker: false } },
  { leadId: 'A06', externalId: 'msg-A06-1', day: 2, hour: 5, text: 'Is the audit really free? Send me more info.', expect: { budgetUsd: null, timelineDays: null, decisionMaker: null } },
  { leadId: 'A07', externalId: 'msg-A07-1', day: 2, hour: 6, text: "We're a two person shop, no budget for this, only looking for free tips.", expect: { budgetUsd: 0, timelineDays: null } },
  { leadId: 'A08', externalId: 'msg-A08-1', day: 3, hour: 1, text: 'What do you need from me to get started?', expect: { budgetUsd: null, timelineDays: null, decisionMaker: null } },
  { leadId: 'A09', externalId: 'msg-A09-1', day: 3, hour: 2, text: 'Curious how this would work for a bakery.', expect: { budgetUsd: null, timelineDays: null, decisionMaker: null } },
  { leadId: 'A10', externalId: 'msg-A10-1', day: 3, hour: 4, text: "There's no budget for this right now, but I'd love the free audit.", expect: { budgetUsd: 0 } },
  { leadId: 'A02', externalId: 'msg-A02-2', day: 4, hour: 2, text: 'Thanks for the details. To be honest there is no budget for paid tools this year.', expect: { budgetUsd: 0 } },
  { leadId: 'A11', externalId: 'msg-A11-1', day: 4, hour: 1, text: 'No budget, just exploring ideas.', expect: { budgetUsd: 0 } },
  { leadId: 'A12', externalId: 'msg-A12-1', day: 4, hour: 3, text: 'What tools do you use for this?', expect: { budgetUsd: null, timelineDays: null, decisionMaker: null } },
  { leadId: 'A08', externalId: 'msg-A08-2', day: 5, hour: 3, text: "Talked to the team. I don't make these calls, my business partner decides on anything we buy.", expect: { decisionMaker: false } },
  { leadId: 'A13', externalId: 'msg-A13-1', day: 5, hour: 1, text: 'No budget this year, sorry.', expect: { budgetUsd: 0 } },
  { leadId: 'A14', externalId: 'msg-A14-1', day: 6, hour: 2, text: "I'm not the decision maker, my boss decides on vendors.", expect: { decisionMaker: false } },
  { leadId: 'A15', externalId: 'msg-A15-1', day: 6, hour: 4, text: 'Nice ad. Is this a webinar or a call?', expect: { budgetUsd: null, timelineDays: null, decisionMaker: null } },
  { leadId: 'A06', externalId: 'msg-A06-2', day: 7, hour: 2, text: 'Read it all. We have no budget for this kind of project, maybe later.', expect: { budgetUsd: 0 } },
  { leadId: 'A17', externalId: 'msg-A17-1', day: 7, hour: 3, text: "Honestly no budget, we're just starting out.", expect: { budgetUsd: 0 } },
  { leadId: 'A09', externalId: 'msg-A09-2', day: 8, hour: 1, text: "Thought about it, there's no budget for it at the moment.", expect: { budgetUsd: 0 } },
  { leadId: 'A16', externalId: 'msg-A16-1', day: 8, hour: 2, text: "We looked at it and there's no budget for it.", expect: { budgetUsd: 0 } },
  { leadId: 'A18', externalId: 'msg-A18-1', day: 8, hour: 4, text: "I'm the owner but there's no budget until spring.", expect: { budgetUsd: 0, decisionMaker: true } },
  { leadId: 'A19', externalId: 'msg-A19-1', day: 9, hour: 5, text: 'The owner would have to approve this, I only collect info.', expect: { decisionMaker: false } },
  { leadId: 'A20', externalId: 'msg-A20-1', day: 12, hour: 2, text: 'How long does the audit take?', expect: { budgetUsd: null, timelineDays: null, decisionMaker: null } },
  // B: busy buyers answer late
  { leadId: 'B01', externalId: 'msg-B01-1', day: 2, hour: 3, text: "I'm the managing partner at a 12 person firm. We have about $20k set aside for this and want it live within 60 days. Month-end close takes us far too long and my seniors do it by hand.", expect: { budgetUsd: 20000, timelineDays: 60, decisionMaker: true } },
  { leadId: 'U01', externalId: 'msg-U01-1', day: 5, hour: 2, text: "A colleague forwarded your page. I'm the managing partner, we have about $12k for this, and we'd want it live within 60 days.", expect: { budgetUsd: 12000, timelineDays: 60, decisionMaker: true } },
  { leadId: 'B02', externalId: 'msg-B02-1', day: 5, hour: 6, text: "Sorry for the slow reply, busy season. I'm the founding partner and I sign off on tools. Budget is around $15k and we'd want it running in the next 45 days. Reconciliations eat most of our first week each month.", expect: { budgetUsd: 15000, timelineDays: 45, decisionMaker: true } },
  { leadId: 'B03', externalId: 'msg-B03-1', day: 6, hour: 2, text: "Got your note between client deadlines. I'm the managing partner, and we set aside about $20k for close automation this year. Our reviewers spend too long chasing missing documents.", expect: { budgetUsd: 20000, timelineDays: null, decisionMaker: true } },
  { leadId: 'B04', externalId: 'msg-B04-1', day: 7, hour: 5, text: "Apologies, it has been a crush of client work. I own the practice, we'd budget $12k, and we need it working within 8 weeks. Our month-end close is mostly spreadsheets.", expect: { budgetUsd: 12000, timelineDays: 56, decisionMaker: true } },
  { leadId: 'B05', externalId: 'msg-B05-1', day: 8, hour: 6, text: 'Busy stretch here. We have about $15k for this, and we need the close fixed within 30 days. Manual reconciliations are our bottleneck.', expect: { budgetUsd: 15000, timelineDays: 30, decisionMaker: null } },
  { leadId: 'B06', externalId: 'msg-B06-1', day: 12, hour: 3, text: "Budget is there, about $22k, and I'm the managing partner, but we can't take on a new project for 6 months.", expect: { budgetUsd: 22000, timelineDays: 180, decisionMaker: true } },
  { leadId: 'B07', externalId: 'msg-B07-1', day: 12, hour: 6, text: "I'm the managing partner. We can commit $30k and want it in place within 60 days. Our close drags on and staff burn out.", expect: { budgetUsd: 30000, timelineDays: 60, decisionMaker: true } },
];

/** One B reply arrives twice from the webhook on day 6 (same externalId, retry delivery). */
export const DUPLICATE_DELIVERIES: { externalId: string; day: number; hour: number }[] = [{ externalId: 'msg-B03-1', day: 6, hour: 3 }];

export interface ScenarioOutcome {
  leadId: string;
  externalId: string;
  stage: OutcomeStage;
  day: number;
  hour: number;
  learnedDay: number;
  learnedHour: number;
  valueUsd?: number;
  note: string;
}

export const OUTCOMES: ScenarioOutcome[] = [
  // Late CRM sync: calls booked on day 5 and day 7, delivered on day 11.
  { leadId: 'B03', externalId: 'crm-call-B03', stage: 'CALL_BOOKED', day: 5, hour: 4, learnedDay: 11, learnedHour: 2, note: 'Discovery call booked. Rosa wants the close automation live within 45 days, before the October extension deadline.' },
  { leadId: 'B05', externalId: 'crm-call-B05', stage: 'CALL_BOOKED', day: 7, hour: 3, learnedDay: 11, learnedHour: 2, note: 'Call booked with Hiroshi, the founding partner, who makes the final call on vendors.' },
  { leadId: 'A01', externalId: 'crm-call-A01', stage: 'CALL_BOOKED', day: 10, hour: 2, learnedDay: 10, learnedHour: 2, note: 'Audit call booked.' },
  { leadId: 'B02', externalId: 'crm-call-B02', stage: 'CALL_BOOKED', day: 12, hour: 1, learnedDay: 12, learnedHour: 1, note: 'Scoping call booked.' },
  { leadId: 'B03', externalId: 'crm-proposal-B03', stage: 'PROPOSAL', day: 14, hour: 2, learnedDay: 14, learnedHour: 2, valueUsd: 18000, note: 'Proposal sent for the close automation pilot.' },
  { leadId: 'B05', externalId: 'crm-proposal-B05', stage: 'PROPOSAL', day: 14, hour: 4, learnedDay: 14, learnedHour: 4, valueUsd: 15000, note: 'Proposal sent for the reconciliation pilot.' },
  { leadId: 'A01', externalId: 'crm-ghost-A01', stage: 'GHOSTED', day: 16, hour: 2, learnedDay: 16, learnedHour: 2, note: 'No show for the audit call and no reply since.' },
  { leadId: 'B03', externalId: 'crm-won-B03', stage: 'WON', day: 21, hour: 3, learnedDay: 21, learnedHour: 3, valueUsd: 18000, note: 'Signed: close automation pilot.' },
];

export interface ScenarioDelivery {
  deliveryId: string;
  event: {
    id: string;
    type: EventType;
    occurredAt: string;
    learnedAt: string;
    source: string;
    payload: Record<string, unknown>;
  };
}

/** Every scheduled delivery in the scenario, with deterministic ids. Materialized by the ingest step when due. */
export function scenarioDeliveries(): ScenarioDelivery[] {
  const out: ScenarioDelivery[] = [];
  const add = (event: ScenarioDelivery['event'], deliveryId = `dlv:${event.id}`) => {
    out.push({ deliveryId, event: { ...event, payload: { ...event.payload, deliveryId } } });
  };

  for (const c of CAMPAIGNS) {
    add({
      id: `sc:campaign:${c.id}`,
      type: 'campaign.launched',
      occurredAt: dayToIso(0, 0),
      learnedAt: dayToIso(0, 0),
      source: 'scenario',
      payload: {
        campaignId: c.id,
        key: c.key,
        name: c.name,
        angle: c.angle,
        audience: c.audience,
        offer: c.offer,
        creative: c.creative,
        dailySpendUsd: c.dailySpendUsd,
        testDays: c.testDays,
        marketQuery: c.marketQuery,
        adjacentSegment: c.adjacentSegment,
        simulatedSpend: true,
      },
    });
    for (let d = 0; d < c.testDays; d++) {
      add({
        id: `sc:spend:${c.id}:${d}`,
        type: 'spend.recorded',
        occurredAt: dayToIso(d, 0),
        learnedAt: dayToIso(d, 0),
        source: 'scenario',
        payload: { campaignId: c.id, amountUsd: c.dailySpendUsd, day: d, simulated: true },
      });
    }
  }

  for (const l of LEADS) {
    const externalId = `lead-${l.id}`;
    add({
      id: externalEventId('webhook', externalId),
      type: 'lead.captured',
      occurredAt: dayToIso(l.day, l.hour),
      learnedAt: dayToIso(l.day, l.hour),
      source: 'webhook',
      payload: { leadId: l.id, name: l.name, company: l.company, role: l.role, campaignId: l.campaignId, utm: l.utm, externalId },
    });
  }

  for (const r of REPLIES) {
    add({
      id: externalEventId('webhook', r.externalId),
      type: 'lead.replied',
      occurredAt: dayToIso(r.day, r.hour),
      learnedAt: dayToIso(r.day, r.hour),
      source: 'webhook',
      payload: { leadId: r.leadId, externalId: r.externalId, text: r.text },
    });
  }

  for (const dup of DUPLICATE_DELIVERIES) {
    const r = REPLIES.find((x) => x.externalId === dup.externalId);
    if (!r) continue;
    add(
      {
        id: externalEventId('webhook', r.externalId),
        type: 'lead.replied',
        occurredAt: dayToIso(r.day, r.hour),
        learnedAt: dayToIso(dup.day, dup.hour),
        source: 'webhook',
        payload: { leadId: r.leadId, externalId: r.externalId, text: r.text },
      },
      `dlv:${externalEventId('webhook', r.externalId)}:retry`,
    );
  }

  for (const o of OUTCOMES) {
    add({
      id: externalEventId('crm', o.externalId),
      type: 'outcome.recorded',
      occurredAt: dayToIso(o.day, o.hour),
      learnedAt: dayToIso(o.learnedDay, o.learnedHour),
      source: 'crm',
      payload: { leadId: o.leadId, externalId: o.externalId, stage: o.stage, valueUsd: o.valueUsd ?? null, note: o.note },
    });
  }

  return out.sort((a, b) => Date.parse(a.event.learnedAt) - Date.parse(b.event.learnedAt));
}
