import type { FieldKey, LeadStatus } from '../contract';

export interface QualificationRules {
  version: number;
  minBudgetUsd: number;
  maxTimelineDays: number;
  requireDecisionMaker: boolean;
}

export const RULES_V1: QualificationRules = {
  version: 1,
  minBudgetUsd: 5000,
  maxTimelineDays: 90,
  requireDecisionMaker: true,
};

export interface LeadFieldsKnown {
  budgetUsd: number | null;
  timelineDays: number | null;
  decisionMaker: boolean | null;
  problem: string | null;
}

export interface Qualification {
  status: LeadStatus;
  reasons: string[];
  missing: FieldKey[];
}

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/** Rules, not a model: QUALIFIED if every rule passes, NOT_A_FIT if any known field fails, else UNRESOLVED. */
export function qualify(f: LeadFieldsKnown, rules: QualificationRules): Qualification {
  const reasons: string[] = [];
  const missing: FieldKey[] = [];
  let failed = false;

  if (f.budgetUsd === null) missing.push('budgetUsd');
  else if (f.budgetUsd < rules.minBudgetUsd) {
    failed = true;
    reasons.push(f.budgetUsd === 0 ? 'No budget' : `Budget ${usd(f.budgetUsd)} is below ${usd(rules.minBudgetUsd)}`);
  } else reasons.push(`Budget ${usd(f.budgetUsd)} meets ${usd(rules.minBudgetUsd)}`);

  if (f.timelineDays === null) missing.push('timelineDays');
  else if (f.timelineDays > rules.maxTimelineDays) {
    failed = true;
    reasons.push(`Timeline ${f.timelineDays} days exceeds ${rules.maxTimelineDays}`);
  } else reasons.push(`Timeline ${f.timelineDays} days is within ${rules.maxTimelineDays}`);

  if (rules.requireDecisionMaker) {
    if (f.decisionMaker === null) missing.push('decisionMaker');
    else if (!f.decisionMaker) {
      failed = true;
      reasons.push('Not the decision maker');
    } else reasons.push('Decision maker');
  }

  if (failed) return { status: 'NOT_A_FIT', reasons: reasons.filter((r) => !/meets|within|^Decision maker$/.test(r)), missing: [] };
  if (missing.length > 0) {
    return { status: 'UNRESOLVED', reasons: [...reasons, ...missing.map((m) => `${FIELD_LABEL[m]} unknown`)], missing };
  }
  return { status: 'QUALIFIED', reasons, missing: [] };
}

export const FIELD_LABEL: Record<FieldKey, string> = {
  budgetUsd: 'Budget',
  timelineDays: 'Timeline',
  decisionMaker: 'Decision maker',
  problem: 'Problem',
};

/** Drafted question for a missing field. Drafted only, never sent. */
export function questionFor(field: FieldKey, firstName: string): string {
  switch (field) {
    case 'budgetUsd':
      return `Hi ${firstName}, quick one so we respect your time: is there a budget range set aside for this, even a rough one?`;
    case 'timelineDays':
      return `Hi ${firstName}, when would you want this live, and is there a deadline driving it?`;
    case 'decisionMaker':
      return `Hi ${firstName}, who else would be involved in deciding on this, and who signs off?`;
    case 'problem':
      return `Hi ${firstName}, what is the one process you most want off your plate?`;
  }
}
