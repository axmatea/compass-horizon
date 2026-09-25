import { describe, expect, it } from 'vitest';
import { loadSimulation } from '@/lib/sim';

describe('client-side simulation', () => {
  it('serves the arc day by day through frameAt', async () => {
    const sim = await loadSimulation();
    expect(sim.lastDay).toBe(21);
    expect(sim.keyDays.map((k) => k.day)).toEqual([0, 3, 6, 9, 11, 14, 21]);
    for (const k of sim.keyDays) expect(k.caption.split(/\s+/).length).toBeLessThanOrEqual(8);

    const summary = [0, 3, 6, 9, 11, 14, 21].map((d) => {
      const b = sim.frameAt(d).currentBelief;
      return `D${d} v${b?.version} ${b?.status} ${b?.favors} ${b?.probability}`;
    });
    console.log(summary.join('\n'));

    const d3 = sim.frameAt(3).currentBelief!;
    expect(d3).toMatchObject({ status: 'LEANING', favors: 'A', policyVersion: 1 });
    expect(Math.round(d3.probability! * 100)).toBeGreaterThanOrEqual(85);

    expect(sim.frameAt(6).currentBelief).toMatchObject({ status: 'INSUFFICIENT', favors: null });

    const f9 = sim.frameAt(9);
    expect(f9.currentBelief).toMatchObject({ status: 'LEANING', favors: 'B', policyVersion: 2 });
    expect(f9.currentBelief?.revisedFrom).toMatchObject({ status: 'LEANING', favors: 'A' });
    expect(f9.lessons).toHaveLength(1);
    expect(f9.policy.version).toBe(2);

    const f11 = sim.frameAt(11);
    expect(f11.currentBelief).toMatchObject({ status: 'SUPPORTED', favors: 'B' });
    const late = f11.ledger.filter((e) => e.late && e.type === 'outcome.recorded');
    expect(late.map((e) => [e.occurredDay, e.learnedDay])).toEqual([
      [5, 11],
      [7, 11],
    ]);
    expect(f11.ledger.filter((e) => e.type === 'outcome.recorded' && e.late).every((e) => e.label.startsWith('CALL_BOOKED'))).toBe(true);

    const f21 = sim.frameAt(21);
    expect(f21.currentBelief).toMatchObject({ status: 'SUPPORTED', favors: 'B', version: 6 });
    expect(f21.campaigns.find((c) => c.key === 'B')?.wonUsd).toBe(18000);
    expect(f21.campaigns.find((c) => c.key === 'A')?.wonUsd).toBe(0);

    // memoized, and the past never sees the future
    expect(sim.frameAt(9)).toBe(f9);
    expect(sim.frameAt(3).ledger.every((e) => e.learnedDay <= 3)).toBe(true);
    expect(sim.frameAt(3).lessons).toEqual([]);
  });
});
