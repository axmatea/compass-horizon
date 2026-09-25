import { neon } from '@neondatabase/serverless';
import type { LedgerEvent } from '@/engine/events';
import type { AppendResult, Store } from '@/engine/wake';
import type { WorkspaceMeta } from '@/engine/project';
import type { Mode } from '@/contract';

type Sql = ReturnType<typeof neon>;
let client: Sql | null = null;
let migrated: Promise<void> | null = null;

export class DbBlockedError extends Error {
  constructor() {
    super('DATABASE_URL is not set');
    this.name = 'DbBlockedError';
  }
}

export function dbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function sql(): Sql {
  if (!process.env.DATABASE_URL) throw new DbBlockedError();
  if (!client) client = neon(process.env.DATABASE_URL);
  return client;
}

const MIGRATIONS = [
  `create table if not exists workspaces (
     id text primary key,
     mode text not null default 'DEMO',
     label text not null default 'Demo',
     scenario text,
     live_providers boolean not null default false,
     created_at timestamptz not null default now()
   )`,
  `create table if not exists ledger (
     workspace_id text not null,
     id text not null,
     seq bigserial,
     type text not null,
     occurred_at timestamptz not null,
     learned_at timestamptz not null,
     wall_at timestamptz not null default now(),
     source text not null,
     mode text not null,
     payload jsonb not null default '{}'::jsonb,
     primary key (workspace_id, id)
   )`,
  `create index if not exists ledger_workspace_seq on ledger (workspace_id, seq)`,
  `create table if not exists early_access (
     id bigserial primary key,
     email text not null unique,
     name text,
     company text,
     workspace_id text,
     created_at timestamptz not null default now()
   )`,
];

/** Additive migrations, run once per cold start. */
export function migrate(): Promise<void> {
  if (!migrated) {
    const q = sql();
    migrated = q
      .transaction(MIGRATIONS.map((m) => q.query(m)))
      .then(() => undefined)
      .catch((err) => {
        migrated = null;
        throw err;
      });
  }
  return migrated;
}

function iso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return new Date(String(v)).toISOString();
}

type Row = Record<string, unknown>;

export class NeonStore implements Store {
  async append(events: LedgerEvent[]): Promise<AppendResult> {
    if (!events.length) return { inserted: [], duplicates: [] };
    await migrate();
    const seen = new Set<string>();
    const uniq = events.filter((e) => (seen.has(`${e.workspaceId}|${e.id}`) ? false : (seen.add(`${e.workspaceId}|${e.id}`), true)));
    const rows = (await sql().query(
      `insert into ledger (workspace_id, id, type, occurred_at, learned_at, source, mode, payload)
       select w, i, t, o::timestamptz, l::timestamptz, s, m, p::jsonb
       from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[]) with ordinality as u(w, i, t, o, l, s, m, p, ord)
       order by ord
       on conflict (workspace_id, id) do nothing
       returning id`,
      [
        uniq.map((e) => e.workspaceId),
        uniq.map((e) => e.id),
        uniq.map((e) => e.type),
        uniq.map((e) => e.occurredAt),
        uniq.map((e) => e.learnedAt),
        uniq.map((e) => e.source),
        uniq.map((e) => e.mode),
        uniq.map((e) => JSON.stringify(e.payload ?? {})),
      ],
    )) as Row[];
    const inserted = new Set(rows.map((r) => String(r.id)));
    return { inserted: [...inserted], duplicates: events.map((e) => e.id).filter((id) => !inserted.has(id)) };
  }

  async list(workspaceId: string): Promise<LedgerEvent[]> {
    await migrate();
    const rows = (await sql().query(
      `select id, type, occurred_at, learned_at, source, mode, payload, seq, wall_at from ledger where workspace_id = $1 order by seq`,
      [workspaceId],
    )) as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      workspaceId,
      type: r.type as LedgerEvent['type'],
      occurredAt: iso(r.occurred_at),
      learnedAt: iso(r.learned_at),
      source: String(r.source),
      mode: r.mode as Mode,
      payload: (typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload) as Record<string, unknown>,
      seq: Number(r.seq),
      wallAt: iso(r.wall_at),
    }));
  }

  async deleteWorkspace(workspaceId: string, opts: { keepRow?: boolean } = {}): Promise<void> {
    await migrate();
    await sql().query(`delete from ledger where workspace_id = $1`, [workspaceId]);
    if (!opts.keepRow) await sql().query(`delete from workspaces where id = $1`, [workspaceId]);
  }
}

export async function getWorkspaceRow(id: string): Promise<WorkspaceMeta | null> {
  await migrate();
  const rows = (await sql().query(`select id, mode, label, scenario, live_providers from workspaces where id = $1`, [id])) as Row[];
  const r = rows[0];
  if (!r) return null;
  return { id: String(r.id), mode: r.mode as Mode, label: String(r.label), scenario: (r.scenario as string | null) ?? null, liveProviders: Boolean(r.live_providers) };
}

export async function insertWorkspace(ws: WorkspaceMeta): Promise<void> {
  await migrate();
  await sql().query(
    `insert into workspaces (id, mode, label, scenario, live_providers) values ($1, $2, $3, $4, $5)
     on conflict (id) do update set live_providers = excluded.live_providers`,
    [ws.id, ws.mode, ws.label, ws.scenario, ws.liveProviders],
  );
}

export async function listLiveWorkspaces(): Promise<WorkspaceMeta[]> {
  await migrate();
  const rows = (await sql().query(`select id, mode, label, scenario, live_providers from workspaces where mode = 'LIVE'`)) as Row[];
  return rows.map((r) => ({ id: String(r.id), mode: 'LIVE' as Mode, label: String(r.label), scenario: (r.scenario as string | null) ?? null, liveProviders: Boolean(r.live_providers) }));
}

export async function insertEarlyAccess(input: { email: string; name: string | null; company: string | null; workspaceId: string | null }): Promise<void> {
  await migrate();
  const rows = (await sql().query(
    `insert into early_access (email, name, company, workspace_id) values ($1, $2, $3, $4)
     on conflict (email) do update set name = coalesce(excluded.name, early_access.name), company = coalesce(excluded.company, early_access.company)
     returning id`,
    [input.email, input.name, input.company, input.workspaceId],
  )) as Row[];
  if (!rows.length) throw new Error('early access write not confirmed');
}

export async function pingDb(): Promise<boolean> {
  if (!dbConfigured()) return false;
  try {
    await migrate();
    await sql().query('select 1');
    return true;
  } catch {
    return false;
  }
}
