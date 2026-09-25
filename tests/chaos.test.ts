import { describe, expect, it } from 'vitest';
import { dayToIso, WAKE_HOUR } from '@/engine/events';
import { offlineProviders, SimulatedCrash, wake } from '@/engine/wake';
import { MemoryStore } from '@/engine/memory-store';
import { beat, crashFor, demoWorkspace, world } from './helpers';

describe('crash-safe runs', () => {
  it('chaos afterStep 3 at day 14, then resume: skipped steps, duplicate effects skipped, zero duplicate rows', async () => {
    const store = new MemoryStore();
    const ws = demoWorkspace('test-chaos');
    for (let n = 0; n <= 4; n++) await beat(store, ws, n);
    await store.append([
      { id: 'chaos:armed:1', workspaceId: ws.id, type: 'chaos.armed', occurredAt: dayToIso(11, WAKE_HOUR), learnedAt: dayToIso(11, WAKE_HOUR), source: 'presenter', mode: 'DEMO', payload: { afterStep: 3 } },
    ]);
    await expect(beat(store, ws, 5)).rejects.toBeInstanceOf(SimulatedCrash);

    const crashed = await world(store, ws);
    const run = crashed.runs[0];
    expect(run.day).toBe(14);
    expect(run.state).toBe('INTERRUPTED');
    expect(run.steps.map((s) => s.state)).toEqual(['DONE', 'DONE', 'DONE', 'PENDING', 'PENDING', 'PENDING', 'PENDING']);
    const performed = run.effects.filter((e) => e.state === 'PERFORMED');
    expect(performed.length).toBeGreaterThan(0);
    expect(crashed.ledger.some((e) => e.type === 'chaos.fired')).toBe(true);
    const effectRowsBefore = store.count(ws.id, (e) => e.type === 'effect.performed');

    const resumed = await wake({ store, workspace: ws, providers: offlineProviders(), day: 14, trigger: 'RESUME', crash: crashFor(store) });
    expect(resumed.run.id).toBe(run.id);
    expect(resumed.run.state).toBe('COMPLETED');
    expect(resumed.run.trigger).toBe('RESUME');
    expect(resumed.run.resumedFromStep).toBe(4);
    expect(resumed.run.steps.slice(0, 3).map((s) => s.state)).toEqual(['SKIPPED_ALREADY_DONE', 'SKIPPED_ALREADY_DONE', 'SKIPPED_ALREADY_DONE']);
    expect(resumed.run.steps.slice(3).map((s) => s.state)).toEqual(['DONE', 'DONE', 'DONE', 'DONE']);
    const step4 = resumed.run.effects;
    expect(step4.length).toBe(performed.length);
    expect(step4.every((e) => e.state === 'SKIPPED_DUPLICATE')).toBe(true);
    expect(new Set(step4.map((e) => e.key))).toEqual(new Set(performed.map((e) => e.key)));

    // zero duplicate effect rows
    expect(store.count(ws.id, (e) => e.type === 'effect.performed')).toBe(effectRowsBefore);
    const keys = (await store.list(ws.id)).filter((e) => e.type === 'effect.performed').map((e) => e.id);
    expect(new Set(keys).size).toBe(keys.length);

    const after = await world(store, ws);
    expect(after.stats.effectsSkipped).toBe(performed.length);
    expect(after.runs[0]).toMatchObject({ id: run.id, state: 'COMPLETED', resumedFromStep: 4 });
    expect(after.commitments.filter((c) => c.kind === 'MARKET_RESCAN')[0].state).toBe('KEPT');
    // the story continues after the crash
    await beat(store, ws, 6);
    expect((await world(store, ws)).currentBelief).toMatchObject({ status: 'SUPPORTED', favors: 'B' });
  });
});
