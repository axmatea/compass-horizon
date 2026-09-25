import { describe, expect, it } from 'vitest';
import { dayToIso, externalEventId, type LedgerEvent } from '@/engine/events';
import { project } from '@/engine/project';
import { OFFLINE_CONFIG } from '@/engine/wake';
import { MemoryStore } from '@/server/memory-store';
import { beat, demoWorkspace, world } from './helpers';

const ws = demoWorkspace('test-ledger');
const LIVE_WS = { ...ws, id: 'test-ledger-live', mode: 'LIVE' as const, scenario: null };

function ev(partial: Partial<LedgerEvent> & Pick<LedgerEvent, 'id' | 'type' | 'payload'>, day = 0, learned = day): LedgerEvent {
  return { workspaceId: ws.id, occurredAt: dayToIso(day, 1), learnedAt: dayToIso(learned, 1), source: 'test', mode: 'DEMO', ...partial };
}

const captured = (leadId: string, campaignId: string | null, day = 0) =>
  ev({ id: `cap:${leadId}`, type: 'lead.captured', payload: { leadId, name: `Lead ${leadId}`, company: 'Co', role: 'Owner', campaignId } }, day);

const extracted = (id: string, leadId: string, fields: Record<string, unknown>, occurred: number, learned: number) =>
  ev({ id, type: 'lead.fields.extracted', payload: { leadId, sourceEventId: `src:${id}`, provider: 'rules', fields } }, occurred, learned);

describe('ledger semantics', () => {
  it('ignores a duplicate event by id (idempotent append)', async () => {
    const store = new MemoryStore();
    const e = ev({ id: externalEventId('webhook', 'msg-1'), type: 'lead.replied', payload: { leadId: 'L1', text: 'hi' } });
    expect(await store.append([e])).toEqual({ inserted: [e.id], duplicates: [] });
    expect(await store.append([e])).toEqual({ inserted: [], duplicates: [e.id] });
    expect(store.count(ws.id)).toBe(1);
  });

  it('records the scenario duplicate webhook once and never double counts the reply', async () => {
    const store = new MemoryStore();
    for (let n = 0; n <= 2; n++) await beat(store, ws, n);
    const w = await world(store, ws);
    expect(w.stats.duplicatesIgnored).toBe(1);
    const replyId = externalEventId('webhook', 'msg-B03-1');
    expect(store.count(ws.id, (e) => e.id === replyId)).toBe(1);
    const b03 = w.leads.find((l) => l.id === 'B03')!;
    expect(b03.messages.filter((m) => m.from === 'lead')).toHaveLength(1);
    // ingest again at a later wake: no new duplicate records
    await beat(store, ws, 3);
    expect((await world(store, ws)).stats.duplicatesIgnored).toBe(1);
  });

  it('a late event never overrides a newer field value', () => {
    const events = [
      captured('L1', 'A'),
      extracted('x-new', 'L1', { budgetUsd: { value: 20000, quote: '$20k' } }, 5, 5),
      // learned later (day 11) but occurred earlier (day 2): must not win
      extracted('x-late', 'L1', { budgetUsd: { value: 3000, quote: '$3k' }, timelineDays: { value: 30, quote: 'within 30 days' } }, 2, 11),
    ];
    const w = project(events, { workspace: LIVE_WS, providers: OFFLINE_CONFIG, liveDay: 12 });
    const lead = w.leads[0];
    expect(lead.fields.budgetUsd.value).toBe(20000);
    expect(lead.fields.budgetUsd.source?.eventId).toBe('src:x-new');
    // but it does fill a field that was unknown
    expect(lead.fields.timelineDays.value).toBe(30);
    // and the time machine before day 11 does not know the late field
    const w5 = project(events, { workspace: LIVE_WS, providers: OFFLINE_CONFIG, liveDay: 12, asOfDay: 6 });
    expect(w5.leads[0].fields.timelineDays).toEqual({ value: null, status: 'UNKNOWN' });
  });

  it('unknown budget stays null and the lead stays UNRESOLVED', () => {
    const events = [captured('L1', 'A'), extracted('x1', 'L1', { budgetUsd: null, timelineDays: { value: 30, quote: 'within 30 days' }, decisionMaker: { value: true, quote: "I'm the owner" } }, 1, 1)];
    const w = project(events, { workspace: LIVE_WS, providers: OFFLINE_CONFIG, liveDay: 2 });
    const lead = w.leads[0];
    expect(lead.fields.budgetUsd).toEqual({ value: null, status: 'UNKNOWN' });
    expect(lead.status).toBe('UNRESOLVED');
    expect(lead.missing).toEqual(['budgetUsd']);
    expect(lead.nextQuestion).toMatch(/budget/);
    expect(w.campaigns).toHaveLength(0);
  });

  it('UNKNOWN attribution is never counted in A or B', async () => {
    const store = new MemoryStore();
    const w0 = demoWorkspace('test-unknown');
    for (let n = 0; n <= 6; n++) await beat(store, w0, n);
    const w = await world(store, w0);
    const u = w.leads.find((l) => l.id === 'U01')!;
    expect(u.campaignId).toBeNull();
    expect(u.status).toBe('QUALIFIED');
    expect(w.unknownAttribution).toEqual({ leads: 1, qualified: 1 });
    const total = w.campaigns.reduce((a, c) => a + c.leads, 0);
    expect(total).toBe(w.leads.length - 1);
    const qualifiedInArms = w.campaigns.reduce((a, c) => a + c.qualified, 0);
    expect(qualifiedInArms).toBe(w.leads.filter((l) => l.status === 'QUALIFIED' && l.campaignId !== null).length);
    expect(w.ledger.filter((e) => e.lane === 'unknown').length).toBeGreaterThan(0);
  });
});
