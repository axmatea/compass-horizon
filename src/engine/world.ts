/** Pure derivations shared by the projection and the run engine. Everything is computed "as known" from a filtered ledger. */
import type { FieldKey, FieldValue, LeadStatus, OutcomeStage } from '@/contract';
import { byLearned, isoToDay, learnedDay, num, occurredDay, str, type LedgerEvent } from './events';
import { POLICY_V1, type DecisionPolicy } from './policy';
import { qualify, RULES_V1, type LeadFieldsKnown, type Qualification, type QualificationRules } from './rules';

export function visibleAt(events: LedgerEvent[], day: number): LedgerEvent[] {
  return events.filter((e) => learnedDay(e) <= day);
}

export function rulesFrom(events: LedgerEvent[]): QualificationRules {
  let r: QualificationRules | null = null;
  for (const e of byLearned(events)) {
    if (e.type !== 'rules.versioned') continue;
    const p = e.payload;
    r = {
      version: num(p.version) ?? 1,
      minBudgetUsd: num(p.minBudgetUsd) ?? RULES_V1.minBudgetUsd,
      maxTimelineDays: num(p.maxTimelineDays) ?? RULES_V1.maxTimelineDays,
      requireDecisionMaker: typeof p.requireDecisionMaker === 'boolean' ? p.requireDecisionMaker : true,
    };
  }
  return r ?? RULES_V1;
}

export function hasRules(events: LedgerEvent[]): boolean {
  return events.some((e) => e.type === 'rules.versioned');
}

export function policyFrom(events: LedgerEvent[]): DecisionPolicy {
  let pol: DecisionPolicy | null = null;
  for (const e of byLearned(events)) {
    if (e.type !== 'policy.versioned') continue;
    const p = e.payload;
    pol = {
      version: num(p.version) ?? 1,
      minResolvedPerArmToLean: num(p.minResolvedPerArmToLean) ?? POLICY_V1.minResolvedPerArmToLean,
      minResolvedPerArmToSupport: num(p.minResolvedPerArmToSupport) ?? POLICY_V1.minResolvedPerArmToSupport,
      leanAt: num(p.leanAt) ?? POLICY_V1.leanAt,
      supportAt: num(p.supportAt) ?? POLICY_V1.supportAt,
    };
  }
  return pol ?? POLICY_V1;
}

export interface CampaignDef {
  id: string;
  key: 'A' | 'B';
  name: string;
  angle: string;
  audience: string;
  offer: string;
  creative: { headline: string; body: string; cta: string };
  marketQuery: string;
  adjacentSegment: { name: string; query: string } | null;
  launchedEventId: string;
}

export function campaignsFrom(events: LedgerEvent[]): CampaignDef[] {
  const out: CampaignDef[] = [];
  for (const e of events) {
    if (e.type !== 'campaign.launched') continue;
    const p = e.payload;
    const id = str(p.campaignId);
    if (!id || out.some((c) => c.id === id)) continue;
    const cr = (p.creative ?? {}) as Record<string, unknown>;
    const adj = p.adjacentSegment as Record<string, unknown> | undefined;
    out.push({
      id,
      key: (str(p.key) === 'B' ? 'B' : 'A') as 'A' | 'B',
      name: str(p.name) ?? id,
      angle: str(p.angle) ?? '',
      audience: str(p.audience) ?? '',
      offer: str(p.offer) ?? '',
      creative: { headline: str(cr.headline) ?? '', body: str(cr.body) ?? '', cta: str(cr.cta) ?? '' },
      marketQuery: str(p.marketQuery) ?? '',
      adjacentSegment: adj && str(adj.name) && str(adj.query) ? { name: str(adj.name)!, query: str(adj.query)! } : null,
      launchedEventId: e.id,
    });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

export interface DerivedLead {
  id: string;
  name: string;
  company: string;
  role: string;
  campaignId: string | null;
  capturedDay: number;
  capturedEventId: string;
  fields: {
    budgetUsd: FieldValue<number>;
    timelineDays: FieldValue<number>;
    decisionMaker: FieldValue<boolean>;
    problem: FieldValue<string>;
  };
  known: LeadFieldsKnown;
  qual: Qualification;
  outcomes: { stage: OutcomeStage; day: number; learnedDay: number; valueUsd?: number; eventId: string }[];
  replies: { day: number; learnedDay: number; text: string; eventId: string }[];
  firstReplyDay: number | null;
  /** the latest learned day among this lead's field evidence */
  resolvedLearnedDay: number | null;
}

type AnyField = { value: unknown; quote?: string } | null | undefined;

const FIELD_KEYS: FieldKey[] = ['budgetUsd', 'timelineDays', 'decisionMaker', 'problem'];

export function deriveLeads(events: LedgerEvent[], rules: QualificationRules): DerivedLead[] {
  const ordered = byLearned(events);
  const leads = new Map<string, DerivedLead>();
  for (const e of ordered) {
    if (e.type !== 'lead.captured') continue;
    const p = e.payload;
    const id = str(p.leadId);
    if (!id || leads.has(id)) continue;
    const unknown = <T,>(): FieldValue<T> => ({ value: null, status: 'UNKNOWN' });
    leads.set(id, {
      id,
      name: str(p.name) ?? 'Unknown',
      company: str(p.company) ?? '',
      role: str(p.role) ?? '',
      campaignId: str(p.campaignId) ?? null,
      capturedDay: occurredDay(e),
      capturedEventId: e.id,
      fields: { budgetUsd: unknown(), timelineDays: unknown(), decisionMaker: unknown(), problem: unknown() },
      known: { budgetUsd: null, timelineDays: null, decisionMaker: null, problem: null },
      qual: { status: 'UNRESOLVED', reasons: [], missing: [] },
      outcomes: [],
      replies: [],
      firstReplyDay: null,
      resolvedLearnedDay: null,
    });
  }

  // Field merge by occurredAt: a value with an older occurredAt never overrides a newer one.
  const best = new Map<string, { at: number; learned: number; idx: number; v: FieldValue<unknown> }>();
  ordered.forEach((e, idx) => {
    if (e.type === 'lead.replied') {
      const lead = leads.get(str(e.payload.leadId) ?? '');
      if (!lead) return;
      if (lead.replies.some((r) => r.eventId === e.id)) return;
      lead.replies.push({ day: occurredDay(e), learnedDay: learnedDay(e), text: str(e.payload.text) ?? '', eventId: e.id });
      return;
    }
    if (e.type === 'outcome.recorded') {
      const lead = leads.get(str(e.payload.leadId) ?? '');
      if (!lead) return;
      const stage = str(e.payload.stage) as OutcomeStage | undefined;
      if (!stage) return;
      const valueUsd = num(e.payload.valueUsd);
      lead.outcomes.push({ stage, day: occurredDay(e), learnedDay: learnedDay(e), ...(valueUsd !== undefined ? { valueUsd } : {}), eventId: e.id });
      return;
    }
    if (e.type !== 'lead.fields.extracted') return;
    const leadId = str(e.payload.leadId) ?? '';
    if (!leads.has(leadId)) return;
    const fields = (e.payload.fields ?? {}) as Record<string, AnyField>;
    const provider = (str(e.payload.provider) ?? 'rules') as 'liquid' | 'rules' | 'user';
    const sourceEventId = str(e.payload.sourceEventId) ?? e.id;
    for (const k of FIELD_KEYS) {
      const f = fields[k];
      if (!f || f.value === null || f.value === undefined) continue;
      const key = `${leadId}|${k}`;
      const at = Date.parse(e.occurredAt);
      const learned = Date.parse(e.learnedAt);
      const prev = best.get(key);
      const newer = !prev || at > prev.at || (at === prev.at && (learned > prev.learned || (learned === prev.learned && idx > prev.idx)));
      if (!newer) continue;
      best.set(key, {
        at,
        learned,
        idx,
        v: {
          value: f.value,
          status: 'CONFIRMED',
          source: { eventId: sourceEventId, day: isoToDay(e.occurredAt), ...(f.quote ? { quote: f.quote } : {}), provider },
        },
      });
    }
  });

  for (const lead of leads.values()) {
    let latestLearned: number | null = null;
    for (const k of FIELD_KEYS) {
      const b = best.get(`${lead.id}|${k}`);
      if (!b) continue;
      (lead.fields as Record<FieldKey, FieldValue<unknown>>)[k] = b.v;
      (lead.known as unknown as Record<FieldKey, unknown>)[k] = b.v.value;
      const ld = isoToDay(new Date(b.learned).toISOString());
      latestLearned = latestLearned === null ? ld : Math.max(latestLearned, ld);
    }
    lead.qual = qualify(lead.known, rules);
    lead.resolvedLearnedDay = lead.qual.status === 'UNRESOLVED' ? null : latestLearned;
    lead.replies.sort((a, b) => a.day - b.day);
    lead.firstReplyDay = lead.replies.length ? lead.replies[0].day : null;
    lead.outcomes.sort((a, b) => a.day - b.day);
  }
  return [...leads.values()];
}

export interface ArmMetrics {
  campaignId: string;
  spendUsd: number;
  leads: number;
  cplUsd: number | null;
  qualified: number;
  unresolved: number;
  notAFit: number;
  resolved: number;
  costPerQualifiedUsd: number | null;
  callsBooked: number;
  pipelineUsd: number;
  wonUsd: number;
}

export function latestStage(lead: DerivedLead): OutcomeStage | null {
  return lead.outcomes.length ? lead.outcomes[lead.outcomes.length - 1].stage : null;
}

export function armMetrics(events: LedgerEvent[], campaignId: string, leads: DerivedLead[]): ArmMetrics {
  let spend = 0;
  for (const e of events) {
    if (e.type === 'spend.recorded' && str(e.payload.campaignId) === campaignId) spend += num(e.payload.amountUsd) ?? 0;
  }
  const mine = leads.filter((l) => l.campaignId === campaignId);
  const count = (s: LeadStatus) => mine.filter((l) => l.qual.status === s).length;
  const qualified = count('QUALIFIED');
  const notAFit = count('NOT_A_FIT');
  let pipeline = 0;
  let won = 0;
  let calls = 0;
  for (const l of mine) {
    if (l.outcomes.some((o) => o.stage === 'CALL_BOOKED')) calls++;
    for (const o of l.outcomes) if (o.stage === 'WON') won += o.valueUsd ?? 0;
    const last = l.outcomes[l.outcomes.length - 1];
    if (last && last.stage === 'PROPOSAL') pipeline += last.valueUsd ?? 0;
  }
  return {
    campaignId,
    spendUsd: spend,
    leads: mine.length,
    cplUsd: mine.length ? spend / mine.length : null,
    qualified,
    unresolved: count('UNRESOLVED'),
    notAFit,
    resolved: qualified + notAFit,
    costPerQualifiedUsd: qualified ? spend / qualified : null,
    callsBooked: calls,
    pipelineUsd: pipeline,
    wonUsd: won,
  };
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function usd(n: number | null | undefined): string {
  if (n === null || n === undefined) return 'Unknown';
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

export function firstName(name: string): string {
  return name.split(' ')[0] ?? name;
}
