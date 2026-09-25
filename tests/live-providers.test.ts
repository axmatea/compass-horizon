import { describe, expect, it } from 'vitest';
import { BEATS } from '@/engine/beats';
import { dayToIso, WAKE_HOUR } from '@/engine/events';
import { extractRules } from '@/engine/extract-rules';
import { project, type ProviderConfig } from '@/engine/project';
import { wake, type Providers } from '@/engine/wake';
import { MemoryStore } from '@/server/memory-store';
import { crashFor, demoWorkspace } from './helpers';

const READY: ProviderConfig = {
  nimble: { status: 'READY', detail: 'key present' },
  liquid: { status: 'READY', detail: 'key present' },
  tinybird: { status: 'READY', detail: 'token present' },
};

function fakeProviders(opts: { liquidFails?: boolean }): Providers {
  let calls = 0;
  return {
    config: READY,
    canCall: () => true,
    liquidExtract: async (text) => {
      calls++;
      if (opts.liquidFails && calls % 2 === 0) return { extraction: null, receipt: { provider: 'liquid', operation: 'extract', status: 'ERROR', note: 'HTTP 500; rules fallback used' } };
      return { extraction: extractRules(text), receipt: { provider: 'liquid', operation: 'extract', status: 'LIVE', model: 'lfm-test', latencyMs: 12, costUsd: 0.0001 } };
    },
    nimbleSearch: async (query) => ({
      sources: [{ title: `Offer for ${query}`, url: 'https://example.com/offer', fetchedAt: '2026-09-25T00:00:00.000Z', fact: 'A competitor sells a similar pilot.' }],
      receipt: { provider: 'nimble', operation: 'search', status: 'LIVE', latencyMs: 30 },
    }),
    tinybirdMirror: async (events) => ({ provider: 'tinybird', operation: 'mirror+asof', status: 'LIVE', latencyMs: 20, note: `mirrored ${events.length} events` }),
  };
}

async function runAll(store: MemoryStore, providers: Providers) {
  const ws = { ...demoWorkspace('test-live'), liveProviders: true };
  for (const def of BEATS) {
    await store.append([{ id: `stage:beat:${def.beat}`, workspaceId: ws.id, type: 'stage.beat', occurredAt: dayToIso(def.day, WAKE_HOUR), learnedAt: dayToIso(def.day, WAKE_HOUR), source: 'presenter', mode: 'DEMO', payload: { beat: def.beat } }]);
    if (def.wakes) await wake({ store, workspace: ws, providers, day: def.day, trigger: 'BEAT', beat: def.beat, crash: crashFor(store) });
  }
  return project(await store.list(ws.id), { workspace: ws, providers: READY });
}

describe('live providers in the run engine', () => {
  it('LIVE after real successful calls, sources flow into the next test, cost is summed', async () => {
    const w = await runAll(new MemoryStore(), fakeProviders({}));
    expect(w.providers.nimble.status).toBe('LIVE');
    expect(w.providers.liquid.status).toBe('LIVE');
    expect(w.providers.tinybird.status).toBe('LIVE');
    expect(w.market.every((m) => m.status === 'LIVE' && m.sources.length === 1)).toBe(true);
    expect(w.currentBelief?.nextTest).toMatch(/Surfaced by the market scan/);
    expect(w.stats.cognitionCostUsd).toBeGreaterThan(0);
    expect(w.leads.find((l) => l.id === 'B01')?.fields.budgetUsd.source?.provider).toBe('liquid');
    // same arc with live cognition
    expect(w.beliefs.map((b) => `${b.status}:${b.favors}`)).toEqual(['INSUFFICIENT:null', 'LEANING:A', 'INSUFFICIENT:null', 'LEANING:B', 'SUPPORTED:B', 'SUPPORTED:B']);
  });

  it('a failing Liquid call falls back to rules with an ERROR receipt, the arc still holds', async () => {
    const w = await runAll(new MemoryStore(), fakeProviders({ liquidFails: true }));
    const errors = w.receipts.filter((r) => r.provider === 'liquid' && r.status === 'ERROR');
    expect(errors.length).toBeGreaterThan(0);
    expect(w.leads.some((l) => l.fields.budgetUsd.source?.provider === 'rules')).toBe(true);
    expect(w.currentBelief).toMatchObject({ status: 'SUPPORTED', favors: 'B' });
    for (const r of w.receipts) expect(JSON.stringify(r)).not.toMatch(/Bearer|sk-|@/);
  });
});
