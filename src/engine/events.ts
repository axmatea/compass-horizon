import type { Mode } from '@/contract';

/** Internal ledger event. Append-only, bitemporal: occurredAt = when it happened, learnedAt = when Longview learned it. */
export type EventType =
  | 'campaign.launched'
  | 'spend.recorded'
  | 'lead.captured'
  | 'lead.replied'
  | 'lead.fields.extracted'
  | 'lead.qualified'
  | 'outcome.recorded'
  | 'market.scanned'
  | 'rules.versioned'
  | 'policy.versioned'
  | 'lesson.recorded'
  | 'commitment.created'
  | 'commitment.kept'
  | 'commitment.cancelled'
  | 'effect.performed'
  | 'belief.recorded'
  | 'run.started'
  | 'run.step'
  | 'run.resumed'
  | 'run.completed'
  | 'receipt'
  | 'webhook.duplicate_ignored'
  | 'chaos.armed'
  | 'chaos.fired'
  | 'stage.beat';

export interface LedgerEvent {
  id: string;
  workspaceId: string;
  type: EventType;
  occurredAt: string;
  learnedAt: string;
  source: string;
  mode: Mode;
  payload: Record<string, unknown>;
  /** Assigned by the store (append order). Absent on events not yet stored. */
  seq?: number;
  /** Real wall clock time of the write. Assigned by the store. */
  wallAt?: string;
}

/** Day 0 of the simulated world: 2026-09-01 15:00 UTC (8:00 in California). */
export const DAY0_MS = Date.parse('2026-09-01T15:00:00Z');
export const DAY_MS = 86_400_000;
export const HORIZON_DAYS = 30;

/** ISO timestamp for a world day plus an hour offset within that day (0..23.99). */
export function dayToIso(day: number, hour = 0): string {
  return new Date(DAY0_MS + day * DAY_MS + Math.round(hour * 3_600_000)).toISOString();
}

/** World day index for an ISO timestamp (floor). */
export function isoToDay(iso: string): number {
  return Math.floor((Date.parse(iso) - DAY0_MS) / DAY_MS);
}

export function learnedDay(e: Pick<LedgerEvent, 'learnedAt'>): number {
  return isoToDay(e.learnedAt);
}

export function occurredDay(e: Pick<LedgerEvent, 'occurredAt'>): number {
  return isoToDay(e.occurredAt);
}

/** Hour of the day at which the agent wakes (after the day's deliveries). */
export const WAKE_HOUR = 20;

/** Deterministic id for an externally delivered event (webhook, CRM). Replays map to the same id. */
export function externalEventId(source: string, externalId: string): string {
  return `ext:${source}:${externalId}`;
}

export function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Stable sort by learnedAt; ties keep append order (stores list in sequence order). */
export function byLearned(events: LedgerEvent[]): LedgerEvent[] {
  return events
    .map((e, i) => ({ e, i, t: Date.parse(e.learnedAt) }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.e);
}
