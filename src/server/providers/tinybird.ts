/**
 * Tinybird adapter: mirror ledger events through the Events API (NDJSON) into longview_events,
 * then read experiment metrics as of a day with dedupe by id and learned_at <= asOf.
 * Setup files live in /tinybird. This adapter never deploys anything.
 */
import type { LedgerEvent } from '@/engine/events';
import type { ReceiptInput } from '@/engine/wake';

export function tinybirdHost(env: NodeJS.ProcessEnv = process.env): string {
  return (env.TINYBIRD_HOST || 'https://api.tinybird.co').replace(/\/+$/, '');
}

export function tinybirdConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.TINYBIRD_TOKEN);
}

function dt(iso: string): string {
  // Tinybird DateTime64(3) accepts 'YYYY-MM-DD hh:mm:ss.sss'
  return iso.replace('T', ' ').replace('Z', '');
}

export function toRow(e: LedgerEvent): Record<string, unknown> {
  const p = e.payload ?? {};
  const s = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : '');
  const n = (k: string) => (typeof p[k] === 'number' ? (p[k] as number) : 0);
  // No free text (names, replies) is mirrored: ids, types, times and numbers only.
  return {
    id: e.id,
    workspace_id: e.workspaceId,
    type: e.type,
    occurred_at: dt(e.occurredAt),
    learned_at: dt(e.learnedAt),
    source: e.source,
    mode: e.mode,
    campaign_id: s('campaignId'),
    lead_id: s('leadId'),
    status: s('status'),
    stage: s('stage'),
    amount_usd: n('amountUsd'),
    value_usd: n('valueUsd'),
  };
}

export function metricsAsOfSql(workspaceId: string, asOfIso: string): string {
  const ws = workspaceId.replace(/[^A-Za-z0-9_-]/g, '');
  return [
    'SELECT campaign_id,',
    "  countIf(type = 'lead.captured') AS leads,",
    "  sumIf(amount_usd, type = 'spend.recorded') AS spend_usd",
    'FROM (',
    '  SELECT * FROM longview_events',
    `  WHERE workspace_id = '${ws}' AND learned_at <= toDateTime64('${dt(asOfIso)}', 3)`,
    '  ORDER BY id LIMIT 1 BY id',
    ')',
    "WHERE campaign_id != ''",
    'GROUP BY campaign_id ORDER BY campaign_id',
    'FORMAT JSON',
  ].join('\n');
}

export async function tinybirdMirror(
  events: LedgerEvent[],
  asOfIso: string,
  workspaceId: string,
  opts: { fetchImpl?: typeof fetch; token?: string; host?: string; timeoutMs?: number } = {},
): Promise<ReceiptInput> {
  const token = opts.token ?? process.env.TINYBIRD_TOKEN;
  const host = opts.host ?? tinybirdHost();
  const f = opts.fetchImpl ?? fetch;
  if (!token) return { provider: 'tinybird', operation: 'mirror', status: 'BLOCKED', note: 'TINYBIRD_TOKEN not set, metrics computed locally (LOCAL)' };
  const started = Date.now();
  try {
    if (events.length) {
      const body = events.map((e) => JSON.stringify(toRow(e))).join('\n');
      const res = await f(`${host}/v0/events?name=longview_events`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-ndjson' },
        body,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
      if (!res.ok) return { provider: 'tinybird', operation: 'mirror', status: 'ERROR', latencyMs: Date.now() - started, note: `events API HTTP ${res.status}` };
    }
    const q = await f(`${host}/v0/sql?q=${encodeURIComponent(metricsAsOfSql(workspaceId, asOfIso))}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
    const latencyMs = Date.now() - started;
    if (!q.ok) return { provider: 'tinybird', operation: 'mirror+asof', status: 'ERROR', latencyMs, note: `mirrored ${events.length}; as-of query HTTP ${q.status}` };
    const data = (await q.json()) as { data?: { campaign_id: string; leads: number; spend_usd: number }[] };
    const rows = (data.data ?? []).map((r) => `${r.campaign_id} ${r.leads} leads $${Math.round(Number(r.spend_usd))}`).join(', ');
    return { provider: 'tinybird', operation: 'mirror+asof', status: 'LIVE', latencyMs, note: `mirrored ${events.length} events; as-of metrics: ${rows || 'none yet'}` };
  } catch (err) {
    const name = (err as Error).name;
    return { provider: 'tinybird', operation: 'mirror', status: 'ERROR', latencyMs: Date.now() - started, note: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : `network error: ${name}` };
  }
}
