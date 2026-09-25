import { describe, expect, it, vi } from 'vitest';
import type { LedgerEvent } from '@/engine/events';
import { liquidEndpoint, liquidExtract } from '@/server/providers/liquid';
import { nimbleSearch, NIMBLE_SEARCH_URL } from '@/server/providers/nimble';
import { metricsAsOfSql, tinybirdMirror } from '@/server/providers/tinybird';
import { providerConfig } from '@/server/providers';

const SECRET = 'sk-test-secret-123';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const noSecret = (x: unknown) => expect(JSON.stringify(x)).not.toContain(SECRET);

describe('provider status', () => {
  it('BLOCKED without credentials, READY with them, detail explains the public demo fallback', () => {
    const none = providerConfig({ liveProviders: false }, {} as NodeJS.ProcessEnv);
    expect(Object.values(none).map((p) => p.status)).toEqual(['BLOCKED', 'BLOCKED', 'BLOCKED']);
    const env = { NIMBLE_API_KEY: SECRET, LIQUID_API_KEY: SECRET, LIQUID_BASE_URL: 'https://example.test/v1', LIQUID_MODEL: 'lfm-7b', TINYBIRD_TOKEN: SECRET } as unknown as NodeJS.ProcessEnv;
    const pub = providerConfig({ liveProviders: false }, env);
    expect(pub.liquid).toMatchObject({ status: 'READY' });
    expect(pub.liquid.detail).toMatch(/public demo uses the rules fallback/);
    noSecret(pub);
    const stage = providerConfig({ liveProviders: true }, env);
    expect(stage.nimble.status).toBe('READY');
  });

  it('routes liquid/* models through OpenRouter when OPENROUTER_API_KEY is set', () => {
    const ep = liquidEndpoint({ OPENROUTER_API_KEY: SECRET, LIQUID_MODEL: 'liquid/lfm-7b' } as unknown as NodeJS.ProcessEnv);
    expect(ep).toMatchObject({ baseUrl: 'https://openrouter.ai/api/v1', via: 'openrouter', model: 'liquid/lfm-7b' });
    expect(liquidEndpoint({ OPENROUTER_API_KEY: SECRET, LIQUID_MODEL: 'other/model' } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe('Nimble adapter', () => {
  it('BLOCKED without a key and makes no call', async () => {
    const f = vi.fn();
    const r = await nimbleSearch('q', { apiKey: '', fetchImpl: f as unknown as typeof fetch });
    expect(r.sources).toBeNull();
    expect(r.receipt.status).toBe('BLOCKED');
    expect(f).not.toHaveBeenCalled();
  });

  it('LIVE on success: keeps title, url, fetchedAt and one fact, scrubs contact data', async () => {
    const f = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe(NIMBLE_SEARCH_URL);
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
      expect(JSON.parse(String(init.body))).toMatchObject({ query: 'close automation', search_depth: 'lite' });
      return json({ results: [{ title: 'Close automation for firms', url: 'https://vendor.example/close', description: 'Automates reconciliations for accounting firms. Call +1 (555) 123-4567 or mail sales@vendor.example today.' }] });
    });
    const r = await nimbleSearch('close automation', { apiKey: SECRET, fetchImpl: f as unknown as typeof fetch, now: () => '2026-09-25T00:00:00.000Z' });
    expect(r.receipt.status).toBe('LIVE');
    expect(r.sources).toEqual([{ title: 'Close automation for firms', url: 'https://vendor.example/close', fetchedAt: '2026-09-25T00:00:00.000Z', fact: 'Automates reconciliations for accounting firms.' }]);
    noSecret(r);
  });

  it('ERROR on HTTP failure, never invents sources', async () => {
    const r = await nimbleSearch('q', { apiKey: SECRET, fetchImpl: (async () => json({ error: 'nope' }, 401)) as unknown as typeof fetch });
    expect(r.sources).toBeNull();
    expect(r.receipt).toMatchObject({ status: 'ERROR', note: 'HTTP 401' });
    noSecret(r);
  });
});

describe('Liquid adapter', () => {
  const ep = { baseUrl: 'https://liquid.example/v1', apiKey: SECRET, model: 'lfm-7b', via: 'liquid' as const };
  const text = "I'm the managing partner. We have about $20k for this and want it live within 60 days.";

  it('LIVE: validates JSON with zod and keeps only exact-substring quotes', async () => {
    const f = vi.fn(async (url: string) => {
      expect(url).toBe('https://liquid.example/v1/chat/completions');
      return json({
        choices: [{ message: { content: JSON.stringify({ budgetUsd: 20000, timelineDays: 60, decisionMaker: true, problem: 'invented', quotes: { budgetUsd: '$20k', timelineDays: 'within 60 days', decisionMaker: "I'm the managing partner", problem: 'not in the text' } }) } }],
        usage: { cost: 0.00012 },
      });
    });
    const r = await liquidExtract(text, { endpoint: ep, fetchImpl: f as unknown as typeof fetch });
    expect(r.receipt).toMatchObject({ status: 'LIVE', model: 'lfm-7b', costUsd: 0.00012 });
    expect(r.extraction).toEqual({
      budgetUsd: { value: 20000, quote: '$20k' },
      timelineDays: { value: 60, quote: 'within 60 days' },
      decisionMaker: { value: true, quote: "I'm the managing partner" },
      problem: null,
    });
    noSecret(r.receipt);
    expect(JSON.stringify(r.receipt)).not.toContain('managing partner');
  });

  it('ERROR on invalid output: extraction null so the engine falls back to rules', async () => {
    const f = async () => json({ choices: [{ message: { content: 'sorry, I cannot help' } }] });
    const r = await liquidExtract(text, { endpoint: ep, fetchImpl: f as unknown as typeof fetch });
    expect(r.extraction).toBeNull();
    expect(r.receipt.status).toBe('ERROR');
    const bad = async () => json({ choices: [{ message: { content: '{"budgetUsd":"lots"}' } }] });
    const r2 = await liquidExtract(text, { endpoint: ep, fetchImpl: bad as unknown as typeof fetch });
    expect(r2.receipt).toMatchObject({ status: 'ERROR' });
    expect(r2.receipt.note).toMatch(/schema/);
  });

  it('BLOCKED without an endpoint', async () => {
    const r = await liquidExtract(text, { endpoint: null });
    expect(r.receipt.status).toBe('BLOCKED');
  });
});

describe('Tinybird adapter', () => {
  const events: LedgerEvent[] = [
    { id: 'e1', workspaceId: 'test-tb', type: 'lead.captured', occurredAt: '2026-09-01T16:00:00.000Z', learnedAt: '2026-09-01T16:00:00.000Z', source: 'webhook', mode: 'DEMO', payload: { leadId: 'A01', name: 'Maya Okafor', campaignId: 'A' } },
  ];

  it('mirrors NDJSON without free text and queries as-of metrics with dedupe', async () => {
    const calls: { url: string; body?: string }[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? String(init.body) : undefined });
      if (url.includes('/v0/events')) return json({ successful_rows: 1 });
      return json({ data: [{ campaign_id: 'A', leads: 1, spend_usd: 150 }] });
    });
    const r = await tinybirdMirror(events, '2026-09-04T11:00:00.000Z', 'test-tb', { token: SECRET, host: 'https://api.tinybird.co', fetchImpl: f as unknown as typeof fetch });
    expect(r.status).toBe('LIVE');
    expect(calls[0].url).toBe('https://api.tinybird.co/v0/events?name=longview_events');
    expect(calls[0].body).toContain('"lead_id":"A01"');
    expect(calls[0].body).not.toContain('Maya');
    expect(decodeURIComponent(calls[1].url)).toContain('LIMIT 1 BY id');
    expect(decodeURIComponent(calls[1].url)).toContain("learned_at <= toDateTime64('2026-09-04 11:00:00.000', 3)");
    noSecret(r);
  });

  it('BLOCKED without a token, ERROR on failure', async () => {
    expect((await tinybirdMirror(events, '2026-09-04T11:00:00.000Z', 'test-tb', { token: '' })).status).toBe('BLOCKED');
    const r = await tinybirdMirror(events, '2026-09-04T11:00:00.000Z', 'test-tb', { token: SECRET, fetchImpl: (async () => json({}, 403)) as unknown as typeof fetch });
    expect(r).toMatchObject({ status: 'ERROR', note: 'events API HTTP 403' });
  });

  it('sanitizes the workspace id in SQL', () => {
    expect(metricsAsOfSql("x'; drop table", '2026-09-04T11:00:00.000Z')).toContain("workspace_id = 'xdroptable'");
  });
});
