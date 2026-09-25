# Tinybird setup for Longview

Files for a dedicated Tinybird workspace (never an existing one):

- `longview_events.datasource`: the ledger mirror. The engine appends NDJSON through the Events API (`POST /v0/events?name=longview_events`).
- `experiment_metrics_as_of.pipe`: experiment metrics as known on a day, deduped by id, `learned_at <= as_of`.

The adapter (`src/server/providers/tinybird.ts`) reads `TINYBIRD_TOKEN` and `TINYBIRD_HOST` (default `https://api.tinybird.co`). Without a token the provider is BLOCKED and metrics come from Postgres, labeled LOCAL. Deploying these files is a manual, approved step; the app never deploys them.
