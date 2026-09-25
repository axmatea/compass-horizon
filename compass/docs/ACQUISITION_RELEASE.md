# Release gates and operator handoff

One integrator owns main and Railway. Workers may not publish. AI Media files
were context, not a wholesale import. No private customer data is used.

## Access verified on 2026-09-25

GitHub push and existing Railway CLI login work. Railway project
`compass-nayl-vincent` has only `compass-web`, no database/volume. Its variables
contain existing voice keys, but no acquisition sponsor keys or DATABASE_URL.
Only variable names were inspected. This does not authorize new expenses.

## Before merging main

1. Obtain owner-approved ceiling for database resources and sponsor test calls.
2. Connect persistent PostgreSQL and backups; set DATABASE_URL. Never substitute
   Map, local JSON or ephemeral Railway filesystem for persistent SaaS storage.
3. Set a strong BETTER_AUTH_SECRET and BETTER_AUTH_URL=https://mycompass.world.
   Use verified provider TLS. Never disable certificate validation as a fix.
4. Configure providers using ACQUISITION_PROVIDERS.md; deploy Tinybird datasource.
   Validate with real redacted receipts before claiming live sponsor integration.
5. Keep ACQUISITION_SPONSOR_CALLS_ENABLED and ACQUISITION_VOICE_ENABLED false until
   approved. These are on/off gates, not monetary caps; provider quotas matter.
6. Run build, full tests, explicit PostgreSQL suite and 390/768/1440px QA. Verify
   two tenants, logout, delayed answers, duplicates, blocked providers and restart.
7. Confirm origin/main did not move. Merge only reviewed release changes; main
   triggers the existing Railway Dockerfile. Compare Railway commit SHA with
   /healthz and verify the actual mycompass.world scenario, not just HTTP 200.
8. Issue a real invitation only to an explicitly approved recipient. The CLI
   prints a bearer token: keep it out of public logs. Nothing is issued at boot.

## Rollback

Schema changes are additive under acq_ names and guarded by advisory locks.
There are no destructive down migrations. Tests clean only their fixtures.
For failure, redeploy the previous known-good Railway deployment/commit; do not
drop tables or reset someone else's changes. Preserve events and jobs for a
forward fix. Rollback cannot undo an already completed external provider action.

## First-cut limits

- No billing, ad buying, outbound messages, Meta writes or contact scraping.
- One workspace per invited account, no multi-member administration.
- Manual attribution; no CRM import. Unknown sources remain unknown.
- 5,000 leads / 100 experiments per workspace. Five queued/running jobs at once.
- Six-minute job leases; uncertain dispatch is blocked pending inspection.
- SSE reads durable state and rechecks sessions; voice checks authorization on
  each turn and closes revoked connections on a five-second check.
- No automatic password-reset or invitation email delivery.
- Provider claims require real receipts. A configured key is not proof of success.

## Claude frontend handoff

"Work only on the frontend worktree for COMPASS Acquisition. Read the current
API contract. Improve Mission, Experiments, Pipeline and Memory on 390/768/1440px.
Keep fixture data explicit; never replace private data with it. Do not change
backend contracts, main or deployment. Coordinate file ownership. Return your
commit SHA, screenshots, tests and unfinished items."

Vincent can validate sponsor adapters in a separate branch using redacted
receipts. He should not publish or run paid retries independently. This is a
handoff prompt, not a claim that Claude or Vincent already performed that work.
