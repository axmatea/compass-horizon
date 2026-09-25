import { describe, expect, it } from 'vitest';
import { gate, nextPolicy, POLICY_V1, POLICY_V2 } from '@/engine/policy';
import { probABetterPerDollar } from '@/engine/stats';

describe('decision policy gate', () => {
  it('v1 leans at 1 resolved per arm, v2 requires 3', () => {
    const thin = { minResolved: 1, pFavored: 0.88 };
    expect(gate(POLICY_V1, thin)).toBe('LEANING');
    expect(gate(POLICY_V2, thin)).toBe('INSUFFICIENT');
    expect(gate(POLICY_V2, { minResolved: 3, pFavored: 0.88 })).toBe('LEANING');
  });

  it('support needs 5 resolved per arm and P >= 0.9 under both versions', () => {
    for (const p of [POLICY_V1, POLICY_V2]) {
      expect(gate(p, { minResolved: 4, pFavored: 0.99 })).toBe('LEANING');
      expect(gate(p, { minResolved: 5, pFavored: 0.89 })).toBe('LEANING');
      expect(gate(p, { minResolved: 5, pFavored: 0.9 })).toBe('SUPPORTED');
      expect(gate(p, { minResolved: 5, pFavored: 0.7 })).toBe('INSUFFICIENT');
      expect(gate(p, { minResolved: 5, pFavored: null })).toBe('INSUFFICIENT');
    }
  });

  it('raises the policy only once', () => {
    const v2 = nextPolicy(POLICY_V1)!;
    expect(v2).toMatchObject({ version: 2, minResolvedPerArmToLean: 3, minResolvedPerArmToSupport: 5 });
    expect(nextPolicy(v2)).toBeNull();
  });

  it('Monte Carlo is deterministic and cost adjusted', () => {
    const a = { qualified: 2, resolved: 6, cplUsd: 50 };
    const b = { qualified: 1, resolved: 1, cplUsd: 200 };
    const p1 = probABetterPerDollar(a, b);
    expect(probABetterPerDollar(a, b)).toBe(p1);
    expect(p1).toBeGreaterThan(0.75);
    // same rates, equal CPL: close to a coin flip
    const even = probABetterPerDollar({ qualified: 3, resolved: 6, cplUsd: 100 }, { qualified: 3, resolved: 6, cplUsd: 100 });
    expect(even).toBeGreaterThan(0.4);
    expect(even).toBeLessThan(0.6);
  });
});
