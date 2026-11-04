# Workspace release gates

Only homepage, actual private office and sign-in remain. All public demos and
presentations are retired; AI runtime is BLOCKED.

The owner explicitly selected publishing without a new database. This allows
the cleaned public UI with honest unavailable auth/storage states, not a claim
of production-ready collaboration. Do not provision a paid database or generate
production credentials as incidental cleanup.

Before enabling collaboration: separately approve database/resource costs,
configure PostgreSQL and HTTPS auth privately, preserve existing acq_auth_*,
acq_tenants, acq_invites, ws_* data and cookies, and review additive migrations.
Verify two fixture users, shared saved edits, isolation, conflicts, invitation
replay, revocation, reconnect and process restart. Configure backups before
storing real materials. Real invitations require an approved recipient.

Run npm test, npm run typecheck and npm run build. DB suites use an explicit
expendable ACQUISITION_TEST_DATABASE_URL, never production DATABASE_URL. npm run
db:test starts the local test database. Record current observed results, not
historical counts. Rollback redeploys a known-good image without data reset.
