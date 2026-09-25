import { describe, expect, it } from 'vitest';
import { MemoryStore } from '@/server/memory-store';
import { beat, demoWorkspace, world } from './helpers';

describe('time machine', () => {
  it('after running to day 21, asOf=3 reproduces the day 3 beliefs and curves', async () => {
    const store = new MemoryStore();
    const ws = demoWorkspace('test-tm');
    await beat(store, ws, 0);
    await beat(store, ws, 1);
    const day3 = await world(store, ws);
    for (let n = 2; n <= 7; n++) await beat(store, ws, n);
    const back = await world(store, ws, 3);
    expect(back.isTimeTravel).toBe(true);
    expect(back.asOfDay).toBe(3);
    expect(back.clock.day).toBe(21);
    expect(back.beliefs).toEqual(day3.beliefs);
    expect(back.currentBelief).toEqual(day3.currentBelief);
    expect(back.currentBelief).toMatchObject({ status: 'LEANING', favors: 'A' });
    expect(back.curves).toEqual(day3.curves);
    expect(back.campaigns).toEqual(day3.campaigns);
    expect(back.leads.map((l) => [l.id, l.status])).toEqual(day3.leads.map((l) => [l.id, l.status]));
    expect(back.policy.version).toBe(1);
    expect(back.lessons).toEqual([]);
    const forward = await world(store, ws, 21);
    expect(forward.isTimeTravel).toBe(false);
    expect(forward.currentBelief?.version).toBe(6);
  });
});
