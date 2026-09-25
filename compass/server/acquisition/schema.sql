CREATE TABLE IF NOT EXISTS acq_projects (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL UNIQUE, name text NOT NULL, goal text NOT NULL,
 rules jsonb NOT NULL, rules_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS acq_rules (
 tenant_id uuid NOT NULL, version integer NOT NULL, rules jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id, version)
);
CREATE TABLE IF NOT EXISTS acq_experiments (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, name text NOT NULL, hypothesis text NOT NULL,
 audience text NOT NULL, message text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS acq_leads (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, name text NOT NULL, experiment_id uuid,
 fields jsonb NOT NULL, clocks jsonb NOT NULL DEFAULT '{}', qualification jsonb NOT NULL,
 version bigint NOT NULL DEFAULT 1, mode text NOT NULL DEFAULT 'LIVE' CHECK(mode IN ('DEMO','LIVE')),
 updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id),
 FOREIGN KEY (tenant_id, experiment_id) REFERENCES acq_experiments(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS acq_events (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, source text NOT NULL, external_id text NOT NULL,
 lead_id uuid NOT NULL, fields jsonb NOT NULL, occurred_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(), mode text NOT NULL CHECK(mode IN ('DEMO','LIVE')),
 UNIQUE(tenant_id,source,external_id), FOREIGN KEY(tenant_id,lead_id) REFERENCES acq_leads(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS acq_decisions (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, recommendation text NOT NULL, status text NOT NULL,
 evidence_ids jsonb NOT NULL, rules_version integer NOT NULL, metrics jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS acq_runs (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, operation text NOT NULL,
 status text NOT NULL DEFAULT 'queued', checkpoint text NOT NULL DEFAULT 'queued',
 input jsonb NOT NULL, result jsonb, receipt jsonb, reason text,
 lease_until timestamptz, lease_token uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS acq_runs_queue_idx ON acq_runs(status,created_at);
CREATE INDEX IF NOT EXISTS acq_leads_tenant_idx ON acq_leads(tenant_id,updated_at);
CREATE INDEX IF NOT EXISTS acq_events_tenant_idx ON acq_events(tenant_id,received_at);
CREATE INDEX IF NOT EXISTS acq_decisions_tenant_idx ON acq_decisions(tenant_id,created_at);
CREATE TABLE IF NOT EXISTS acq_early_access (
 id uuid PRIMARY KEY, email text NOT NULL UNIQUE, name text, business text,
 consent boolean NOT NULL CHECK(consent), created_at timestamptz NOT NULL DEFAULT now()
);
