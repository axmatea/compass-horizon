import { afterAll, describe, expect, it } from 'vitest';
import { dayToIso, type LedgerEvent } from '@/engine/events';

try {
  process.loadEnvFile('.env.local');
} catch {
  // no local env file: the suite is skipped below
}

const hasDb = Boolean(process.env.DATABASE_URL);
const WS = `test-neon-${Date.now()}`;

describe.skipIf(!hasDb)('Neon ledger (real table)', () => {
  afterAll(async () => {
    const { NeonStore } = await import('@/server/db');
    await new NeonStore().deleteWorkspace(WS);
  });

  it('insert on conflict do nothing makes appends idempotent', async () => {
    const { NeonStore } = await import('@/server/db');
    const store = new NeonStore();
    const e = (id: string, payload: Record<string, unknown> = {}): LedgerEvent => ({
      id,
      workspaceId: WS,
      type: 'lead.replied',
      occurredAt: dayToIso(2, 1),
      learnedAt: dayToIso(6, 3),
      source: 'webhook',
      mode: 'DEMO',
      payload: { text: `quote "test" \\ ${id}`, ...payload },
    });
    const first = await store.append([e('ext:webhook:m1'), e('ext:webhook:m2')]);
    expect(first.inserted.sort()).toEqual(['ext:webhook:m1', 'ext:webhook:m2']);
    const again = await store.append([e('ext:webhook:m1', { deliveryId: 'retry' }), e('ext:webhook:m3')]);
    expect(again.inserted).toEqual(['ext:webhook:m3']);
    expect(again.duplicates).toEqual(['ext:webhook:m1']);
    const rows = await store.list(WS);
    expect(rows.map((r) => r.id)).toEqual(['ext:webhook:m1', 'ext:webhook:m2', 'ext:webhook:m3']);
    expect(rows[0].payload).toEqual({ text: 'quote "test" \\ ext:webhook:m1' });
    expect(rows[0].occurredAt).toBe(dayToIso(2, 1));
    expect(rows[0].learnedAt).toBe(dayToIso(6, 3));
  });
});
