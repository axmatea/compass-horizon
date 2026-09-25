/** Belief evaluation: Beta posterior per arm, cost adjusted by CPL, gated by the decision policy. Pure. */
import type { BeliefStatus } from '@/contract';
import { gate, type DecisionPolicy } from './policy';
import { probABetterPerDollar } from './stats';
import { armMetrics, campaignsFrom, deriveLeads, median, rulesFrom, type ArmMetrics, type CampaignDef, type DerivedLead } from './world';
import type { LedgerEvent } from './events';

export interface ArmSnapshot extends ArmMetrics {
  key: 'A' | 'B';
  name: string;
  medianReplyDays: number | null;
}

export interface Evaluation {
  status: BeliefStatus;
  favors: string | null;
  /** P(favored arm yields more qualified per dollar); null when no arm is favored */
  probability: number | null;
  /** P(arm A better per dollar) when computable */
  pA: number | null;
  arms: ArmSnapshot[];
  minResolved: number;
  policy: DecisionPolicy;
  leads: DerivedLead[];
  campaigns: CampaignDef[];
}

export function evaluate(visible: LedgerEvent[], policy: DecisionPolicy): Evaluation {
  const rules = rulesFrom(visible);
  const leads = deriveLeads(visible, rules);
  const campaigns = campaignsFrom(visible);
  const arms: ArmSnapshot[] = campaigns.map((c) => {
    const m = armMetrics(visible, c.id, leads);
    const delays = leads
      .filter((l) => l.campaignId === c.id && l.qual.status !== 'UNRESOLVED' && l.firstReplyDay !== null)
      .map((l) => (l.firstReplyDay as number) - l.capturedDay);
    return { ...m, key: c.key, name: c.name, medianReplyDays: median(delays) };
  });
  const a = arms.find((x) => x.key === 'A');
  const b = arms.find((x) => x.key === 'B');
  const base = { arms, policy, leads, campaigns };
  if (!a || !b || a.cplUsd === null || b.cplUsd === null) {
    return { ...base, status: 'INSUFFICIENT', favors: null, probability: null, pA: null, minResolved: 0 };
  }
  const minResolved = Math.min(a.resolved, b.resolved);
  if (minResolved === 0) {
    return { ...base, status: 'INSUFFICIENT', favors: null, probability: null, pA: null, minResolved };
  }
  const pA = probABetterPerDollar(
    { qualified: a.qualified, resolved: a.resolved, cplUsd: a.cplUsd },
    { qualified: b.qualified, resolved: b.resolved, cplUsd: b.cplUsd },
  );
  const leader = pA >= 0.5 ? a : b;
  const pLeader = pA >= 0.5 ? pA : 1 - pA;
  const status = gate(policy, { minResolved, pFavored: pLeader });
  return {
    ...base,
    status,
    favors: status === 'INSUFFICIENT' ? null : leader.campaignId,
    probability: status === 'INSUFFICIENT' ? null : round3(pLeader),
    pA: round3(pA),
    minResolved,
  };
}

export function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
