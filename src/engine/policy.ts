import type { BeliefStatus } from '@/contract';

export interface DecisionPolicy {
  version: number;
  minResolvedPerArmToLean: number;
  minResolvedPerArmToSupport: number;
  leanAt: number;
  supportAt: number;
}

export const POLICY_V1: DecisionPolicy = {
  version: 1,
  minResolvedPerArmToLean: 1,
  minResolvedPerArmToSupport: 5,
  leanAt: 0.75,
  supportAt: 0.9,
};

/** v2 is what the agent adopts after learning its early read was fooled by fast responders. */
export const POLICY_V2: DecisionPolicy = { ...POLICY_V1, version: 2, minResolvedPerArmToLean: 3 };

export function nextPolicy(p: DecisionPolicy): DecisionPolicy | null {
  if (p.minResolvedPerArmToLean < POLICY_V2.minResolvedPerArmToLean) {
    return { ...POLICY_V2, version: p.version + 1 };
  }
  return null;
}

export interface GateInput {
  minResolved: number;
  /** probability that the favored arm yields more qualified leads per dollar */
  pFavored: number | null;
}

export function gate(policy: DecisionPolicy, g: GateInput): BeliefStatus {
  if (g.pFavored === null) return 'INSUFFICIENT';
  if (g.minResolved >= policy.minResolvedPerArmToSupport && g.pFavored >= policy.supportAt) return 'SUPPORTED';
  if (g.minResolved >= policy.minResolvedPerArmToLean && g.pFavored >= policy.leanAt) return 'LEANING';
  return 'INSUFFICIENT';
}
