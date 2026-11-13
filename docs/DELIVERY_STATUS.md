# COMPASS complete-product delivery boundaries

13 November 2026. The public product and default-off account preview share one
reviewed Vite/Node codebase. The account preview is a functional, bounded data-app
builder. It is not an arbitrary application execution service or a commercially
activated platform. No live charges, new paid resources or production identity
migration were performed.

| Definition of done | Verified implementation | External dependency or limit |
| --- | --- | --- |
| Register and sign in | Actual Better Auth email/password, sessions, expiry, logout and owner continuity; Google/GitHub/Apple adapters and callback tests | Live social login needs owned provider apps, registered redirects, credentials and consent. Preview without email delivery accepts `.test` addresses only. |
| Onboarding | Two short optional choices plus optional experience/use/workspace preferences; editable settings | No external dependency. |
| Preserve the idea | Bounded 30-minute tab-local draft, exact-claim clearing, authenticated owner binding across redirects | A changed account must explicitly review/start the retained idea. |
| Working generation | Real tracker, CRM, booking-record and inventory CRUD apps; frontend, authenticated APIs, SQLite, live opaque preview | These are record managers, not payment processing, calendar reservations or arbitrary SaaS behavior. Arbitrary code needs an authorized external execution service. |
| Refinement | Validated model manifests, deterministic design/schema edits, honest unsupported-change feedback | Model failures use prepared specifications. No invented integration behavior. |
| Persistence | Owner-scoped apps/records, metadata, prompt/design history, reopen, deletion, HTML migration by explicit save; source and records exports | Existing Railway preview has no persistent volume. Cross-container durability requires an approved volume/database, fixed secret and backup retention policy. |
| Isolation | DB-session authorization on each API, owner predicates, CSRF and continuity guards; opaque frame bridge | Production accounts remain off until durable identity/storage rollout is verified. |
| Credits | Atomic immutable ledger, actual provider receipts, idempotent holds/settlement/reversal; unknown usage stays in review | Approved measured provider/infrastructure cost policy is absent. No balances or prices are invented. |
| Billing | Official Stripe SDK, test checkout/portal/cancel, signed raw-body webhooks, refunds and paid entitlements | Real test E2E needs test keys, signing secret, approved prices/products/portal and commercial policy. Live mode is refused. |
| Work tools | Official OAuth/API adapters for GitHub, Drive, Sheets, Gmail metadata, Calendar, Notion and Slack; encrypted owner tokens, scope review, refresh/disconnect | Real connections need provider apps, exact callbacks, dedicated encryption key, provider capability settings and owner consent. Codex connector credentials are never reused. |
| Preview/export | Functional isolated CRUD preview, responsive controls, code view, 14-file standalone source ZIP with pinned auth/runtime/tests, private JSON record export | Arbitrary generated source never runs on the main server. Optional external VM adapter remains off/unverified without credentials, approved image and budget. |
| Publishing | Explicit saved scriptless-page publication to a revocable preview link; reviewed public GitHub feature-branch export with head lease | Preview links are temporary. Full application hosting needs an approved isolated deployment target and durable storage. GitHub publishing needs the explicit public export grant. |
| Public presentation | White minimal pages, approved Fold identity, prompt-first homepage, existing Studio and approved film | No new customers, traction, testimonials or capabilities invented. Film remains labelled as an earlier vision. |
| Quality | 264 automated tests passed; syntax checks and five-page build passed; actual browser CRM creation/edit/clear/design/restore/source download verified | Automated speech tests do not prove a physical microphone. OAuth/payment/sandbox fixture tests do not prove external live services. |
| Deployment | Existing Railway preview first, reviewed GitHub PR, then reversible release of verified public changes | Exact release revision and post-deploy evidence are recorded separately; no production account/billing configuration change is implicit. |
| Recovery | Verified private SQLite backup/restore helper, versioned source, no destructive migration, documented rollback | Real cloud backup scheduling/retention needs approved durable storage. |

## Recovery and operation

- Public rollback: redeploy the previous verified Git revision on the existing
  `compass-web` service. Keep `/compass`, `/healthz` and existing model settings.
  A rollback must be verified by `/healthz` revision plus actual asset hashes.
- Preview state is disposable. Export source/HTML and business records before
  redeployment. Its in-memory auth secret expires sessions on restart.
- Every account mode refuses a database in the public static root, including
  symlink aliases. Static serving independently blocks database artifacts and
  sidecars.
- Persistent SQLite requires an actual verified mount, a fixed Better Auth secret,
  private DB path and explicit storage mode. An ordinary container directory
  cannot pass the durable-readiness check.
- `backupAccountDatabase` is operator-only, uses SQLite online backup and
  `quick_check`, and writes an exclusive private snapshot in the approved backup
  directory. It has no public endpoint and never automatically restores data.
- Restore into an isolated stopped staging target, keep the fixed secret where
  session continuity is required, run DB/session/owner checks, then approve the
  separate production migration. No live data is overwritten by this release.
- Billing is disabled without exact policy. Outstanding unknown-cost reservations
  require reconciliation against provider receipts; never assume an interrupted
  paid call was free. Refund/provider expenses remain separately accounted.
- Admin access is default-deny by verified user-ID allowlist. Operational output
  includes actual process/SQLite health, aggregate activity, measured model usage,
  ledger totals and error codes; no private prompts, records, tokens or emails.

See AUTH_COMPLETE.md, GENERATION_COMPLETE.md, BILLING_COMPLETE.md and
INTEGRATIONS_COMPLETE.md for contracts, test evidence and exact configuration.
