import { describe, expect, it } from 'vitest';
import { MemoryStore } from '@/engine/memory-store';
import { beat, demoWorkspace, world } from './helpers';

describe('story arc (brief section 4) emerges from computation', () => {
  it('runs every beat and produces the arc', async () => {
    const store = new MemoryStore();
    const ws = demoWorkspace('test-arc');
    const seen: Record<number, Awaited<ReturnType<typeof world>>> = {};
    for (let n = 0; n <= 7; n++) {
      await beat(store, ws, n);
      seen[n] = await world(store, ws);
    }
    const summary = Object.entries(seen).map(([n, w]) => ({
      beat: Number(n),
      day: w.clock.day,
      belief: w.currentBelief && `${w.currentBelief.version}:${w.currentBelief.status}:${w.currentBelief.favors}:${w.currentBelief.probability}`,
      policy: w.policy.version,
      cpl: w.campaigns.map((c) => `${c.key}=${c.cplUsd?.toFixed(1)}/${c.costPerQualifiedUsd?.toFixed(0)}/${c.qualified}q/${c.leads}l`).join(' '),
      flip: w.curves.flipDay,
    }));
    console.log(JSON.stringify(summary, null, 1));

    // CPL(A) < CPL(B) every day on the final curves
    const w21 = seen[6];
    const a = w21.curves.byCampaign['A'];
    const b = w21.curves.byCampaign['B'];
    expect(a.length).toBe(22);
    for (let d = 0; d <= 21; d++) {
      expect(a[d].cplUsd).not.toBeNull();
      expect(b[d].cplUsd).not.toBeNull();
      expect(a[d].cplUsd!).toBeLessThan(b[d].cplUsd!);
    }
    expect(w21.curves.flipDay).toBeGreaterThanOrEqual(6);
    expect(w21.curves.flipDay).toBeLessThanOrEqual(9);

    // Day 0
    expect(seen[0].clock.day).toBe(0);
    expect(seen[0].currentBelief?.status).toBe('INSUFFICIENT');
    expect(seen[0].currentBelief?.version).toBe(1);
    expect(seen[0].market.every((m) => m.status === 'BLOCKED' && m.sources.length === 0)).toBe(true);
    expect(seen[0].market.length).toBe(2);
    // Day 3: LEANING A under policy v1
    expect(seen[1].clock.day).toBe(3);
    expect(seen[1].currentBelief).toMatchObject({ status: 'LEANING', favors: 'A', policyVersion: 1 });
    expect(seen[1].policy.version).toBe(1);
    expect(seen[1].commitments.filter((c) => c.kind === 'ASK_MISSING').length).toBeGreaterThan(0);
    const c3 = Object.fromEntries(seen[1].campaigns.map((c) => [c.key, c]));
    expect(c3.A.leads).toBe(12);
    expect(c3.B.leads).toBe(3);
    // Day 6: INSUFFICIENT, duplicate ignored
    expect(seen[2].currentBelief).toMatchObject({ status: 'INSUFFICIENT', favors: null });
    expect(seen[2].stats.duplicatesIgnored).toBe(1);
    // Day 9: LEANING B revised from LEANING A, lesson, policy v2
    expect(seen[3].currentBelief).toMatchObject({ status: 'LEANING', favors: 'B', policyVersion: 2 });
    expect(seen[3].currentBelief?.revisedFrom).toMatchObject({ status: 'LEANING', favors: 'A' });
    expect(seen[3].lessons).toHaveLength(1);
    expect(seen[3].lessons[0]).toMatchObject({ policyFrom: 1, policyTo: 2 });
    expect(seen[3].lessons[0].text).toMatch(/fast responders/);
    expect(seen[3].policy).toMatchObject({ version: 2, minResolvedPerArmToLean: 3 });
    // Day 11: SUPPORTED B, late events
    expect(seen[4].currentBelief).toMatchObject({ status: 'SUPPORTED', favors: 'B' });
    const late = seen[4].ledger.filter((e) => e.late && e.type === 'outcome.recorded');
    expect(late.map((e) => [e.occurredDay, e.learnedDay])).toEqual([
      [5, 11],
      [7, 11],
    ]);
    // Day 14: no change in belief
    expect(seen[5].currentBelief).toMatchObject({ status: 'SUPPORTED', favors: 'B' });
    // Day 21: SUPPORTED B with won revenue and counterfactual
    const b21 = seen[6].currentBelief!;
    expect(b21).toMatchObject({ status: 'SUPPORTED', favors: 'B' });
    expect(b21.version).toBe(6);
    expect(b21.statement).toMatch(/\$18,000/);
    expect(b21.recommendation).toMatch(/Counterfactual/);
    const c21 = Object.fromEntries(seen[6].campaigns.map((c) => [c.key, c]));
    expect(c21.B.wonUsd).toBe(18000);
    expect(c21.A.wonUsd).toBe(0);
    expect(c21.B.pipelineUsd).toBeGreaterThan(c21.A.pipelineUsd);
    // Beat 7: time machine, no new run
    expect(seen[7].stage).toMatchObject({ beat: 7, nextLabel: null });
    expect(seen[7].runs.length).toBe(seen[6].runs.length);
    // Unknown attribution never in A or B
    expect(seen[6].unknownAttribution).toEqual({ leads: 1, qualified: 1 });
    expect(c21.A.leads + c21.B.leads).toBe(28);
    // belief versions ascend 1..6
    expect(seen[6].beliefs.map((b) => b.version)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
