import type { LedgerEvent } from './events';
import type { AppendResult, Store } from './wake';

/** In-memory ledger with the same idempotency contract as Postgres: primary key (workspace_id, id), insert on conflict do nothing. */
export class MemoryStore implements Store {
  private rows = new Map<string, LedgerEvent[]>();
  private seq = 0;

  async append(events: LedgerEvent[]): Promise<AppendResult> {
    const inserted: string[] = [];
    const duplicates: string[] = [];
    for (const e of events) {
      const list = this.rows.get(e.workspaceId) ?? [];
      if (list.some((x) => x.id === e.id)) {
        duplicates.push(e.id);
        continue;
      }
      list.push({ ...e, payload: structuredClone(e.payload), seq: ++this.seq, wallAt: new Date().toISOString() });
      this.rows.set(e.workspaceId, list);
      inserted.push(e.id);
    }
    return { inserted, duplicates };
  }

  async list(workspaceId: string): Promise<LedgerEvent[]> {
    return (this.rows.get(workspaceId) ?? []).map((e) => ({ ...e }));
  }

  async reset(workspaceId: string): Promise<void> {
    this.rows.delete(workspaceId);
  }

  /** Raw row count, for asserting zero duplicate rows. */
  count(workspaceId: string, predicate: (e: LedgerEvent) => boolean = () => true): number {
    return (this.rows.get(workspaceId) ?? []).filter(predicate).length;
  }
}
