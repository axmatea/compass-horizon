# COMPASS

One application: homepage, private team office and sign-in. Canonical repository:
axmatea/compass-horizon. Node 22.12 or newer.

## Run

npm ci
npm run build
npm start

Open http://localhost:8770. npm run dev starts frontend-only development; use
the Node server to verify the full same-origin API/auth flow.

## Routes and reality

- /: current homepage.
- /app: real private workspace; /office redirects here, retaining invite parameters.
- /login: invite-only sign-in/registration.
- /healthz: process health, release revision and separate readiness fields.

All presentations, demos, Protect, Horizon, studio and voice prototypes are
retired and return 410. Their source is preserved in Git history only.
With configured PostgreSQL/auth, people can create workspaces, import text/CSV
with preview, manage tasks, invite teammates and see saved changes/audit events.
Missing database/auth explicitly blocks persistence and sign-in. There are no
fixture accounts or successful-save simulations. The team AI runtime is BLOCKED.

## Server configuration

DATABASE_URL, BETTER_AUTH_SECRET (32+ high-entropy characters), BETTER_AUTH_URL
(exact origin; https://mycompass.world in production), NODE_ENV=production, PORT.
Keep values server-side, never VITE_*. COMPASS_REVISION records CLI releases;
Railway's Git SHA has priority. Existing acq_auth_* tables, tenants, invitations
and cookie names stay compatible. No old acquisition queues/provider calls run.
Cleanup does not drop data, reset credentials or send invitations.

## Verify

npm test
npm run typecheck
npm run build

DB suites need an explicit expendable ACQUISITION_TEST_DATABASE_URL. npm run
db:test starts loopback PostgreSQL on 55438. Test-only DSN:
postgresql://compass_test:local-test-only@127.0.0.1:55438/compass_test
Never use production databases for tests.

See docs/WORKSPACE_API.md, docs/ACQUISITION_AUTH.md and DEPLOYMENT.md.
Preserve attribution notices accompanying retained assets and adapted code.
