# Human workspace release

## Baseline and ownership

Branch: `codex/human-workspace`, from `e291648`. The previous studio artwork and
REMaster remain in Git and at the compatible demo route. The production main
checked on 2026-09-25 was `f72c306f0691366d96bb4f5fa3a4b507b0a224be`.
Only one integrator pushes the release. Old PRs are not automatically merged.

## Production gates

Update: a later explicit user request authorizes publishing the public demo and
presentation (FINAL_RELEASE.md) without a production database. The private SaaS
gates below remain mandatory; do not present public-demo publication as completion
of production authentication, persistence or AI-runtime integration.

Railway CLI access and GitHub repository access were verified. Project
`compass-nayl-vincent`, service `compass-web`, currently serves mycompass.world.
Only the web service exists. On inspection, `DATABASE_URL`, `BETTER_AUTH_SECRET`,
`BETTER_AUTH_URL` and a workspace runtime were absent. No values were printed.

Do not merge main until a persistent production database and secure auth have
been configured and verified. No new resource spend is authorized by this file.
The live AI gate stays BLOCKED, irrespective of old voice API credentials.

1. Confirm the approved database/resource budget or provide an existing database.
2. Set DB connection with verified TLS and HTTPS auth origin; generate server
   auth secret without printing it. Apply only additive workspace migrations.
3. Verify invited accounts, two-user collaboration, isolation, conflict handling,
   revocation, reconnect and restart against a non-production fixture dataset.
4. Run the complete regression suite, workspace tests and browser QA.
5. Review release diff and confirm main has not changed; merge only this reviewed
   release after gates pass. Existing GitHub-to-Railway integration deploys it.
6. Confirm deployed SHA via health and Railway, verify mycompass.world in-browser.
   Never issue real account invitations without an intended recipient.

Rollback is a redeploy of the prior known-good revision, never a database reset.
Backups must be configured before storing real team materials. Old acquisition
records and authentication tables must not be removed or repurposed.

## Local verification

`npm run db:test` starts test-only PostgreSQL on loopback port 55438.
Set `ACQUISITION_TEST_DATABASE_URL` to
`postgresql://compass_test:local-test-only@127.0.0.1:55438/compass_test` for tests.
This is a synthetic local credential, not a production credential.
Stop the local preview worker before running the old acquisition queue tests.
Test logs/screenshots belong in ignored `delivery/workspace/`.

### Verified first version, 2026-09-25

- `npm run build`: TypeScript and production Vite build pass.
- `npm test`: 273 passed, zero failed or skipped, using local PostgreSQL.
- `npm run test:workspaces`: 29 passed, zero skipped (overlaps the full suite).
- `npm run test:remaster`: 66 passed; legacy browser and studio QA pass.
- `npm run qa:workspace`: 390/768/1440 px, keyboard, reduced motion, literal
  source rendering, CSV preview/original retention, task changes and old routes
  pass. Public demo makes no private or model API requests.
- `npm run qa:workspace-private`: two real local auth sessions, new-account
  invitation, shared edits/SSE, command replay, actual Node process restart,
  membership revocation and sign-out pass with no browser errors.
- The game-skill Playwright client also exercised the public scene; its old
  external browser install was unavailable, so it used the repository's
  installed Playwright launcher without installing another browser.

Screenshots and reports: `delivery/workspace/qa/`, `private-qa/`, `game-client/`.
They contain synthetic test data and are not published. No production database,
auth credentials, AI runtime, paid generation or deployment was created.
These results establish local readiness, not production readiness. Resource
approval or an existing production database is still required.

## Stage script (about 60 seconds)

0:00-0:15, open the table: "This is COMPASS. It's a shared workspace for people.
Your team's plan stays beside the context that explains it. This public example
uses fictional team data."

0:15-0:35, add a project update and open its source: "A teammate adds an update.
We keep the original, who added it, and the tasks it relates to. Everyone works
from the same saved state, rather than another isolated conversation."

0:35-0:50, update a task from a second signed-in session: "The change reaches the
other person. Conflicting edits are flagged instead of silently overwriting
their work."

0:50-1:00, show AI state: "Agent proposals are the next integration. This build
does not claim that an unconnected agent is learning. Today we can demonstrate
the shared workspace and its evidence trail."

Use the scripted proposal only in the labelled public demo. Do not describe it
as a real recommendation. Do not use the two-session script unless that flow
has passed against the running deployment.
