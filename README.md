# COMPASS

**Keep the reason. Move the work.**

Canonical repository: [axmatea/compass-horizon](https://github.com/axmatea/compass-horizon).
The single maintained application lives in `compass/`: a Vite/React frontend
and Node server with a PostgreSQL-backed private workspace and Better Auth.
The root package is only a command launcher, with no application dependencies.

## Run

Use Node 22.12 or newer. From the repository root:

```sh
npm run product:install
npm run build
npm start
```

Open http://localhost:8770. For frontend development, use `npm run dev`;
API requests are proxied to the Node server on port 8770, which must also be
running. `npm run preview` previews static build output, not the private API.
Root `npm ci` only installs the empty launcher package; install the application
dependencies with `npm run product:install`.

## Product Boundary

| Route | Purpose |
| --- | --- |
| `/` | Public homepage |
| `/app` | Actual private working office, requiring a team account |
| `/login?returnTo=/app` | Sign-in for the private office |

There are no supported demos, presentations, games, simulations or research
projects. The retired root Next.js concept and disconnected Python research
are recoverable from Git history, not an archive directory.

The current publication scope does not provision a new database. The private
office remains unavailable until DB/auth configuration is separately authorized
and verified. Public homepage publication is not private-workspace availability.

Private collaboration requires PostgreSQL, `DATABASE_URL`, `BETTER_AUTH_SECRET`
and `BETTER_AUTH_URL`, with HTTPS in production. Use the application's existing
invitation and authentication flows; keep invitation tokens private. Sources,
task updates, membership and approvals are human-workspace records, not proof
of autonomous agents. The AI runtime is **BLOCKED** until a compatible
human-workspace contract is implemented and verified. Starting the app or
configuring a provider does not verify AI integration, learning or performance.

## Verify

```sh
npm run typecheck
npm test
npm run test:workspaces
npm run build
```

All application commands forward to `npm --prefix compass`; existing
`product:*` aliases remain for compatibility. Private database integration and
browser QA require an explicitly configured local test database. Never run
cleanup tests against production, load production credentials or invoke paid
provider probes as ordinary verification. See [the product guide](compass/README.md)
and [workspace contract](compass/docs/WORKSPACE_API.md) for application details.

## Deployment And Attribution

Railway service `compass-web` owns `mycompass.world`.
Its source still points to the deleted legacy `axmatea/compass` repository and
its root directory is unset. The pending post-merge publication step
is to bind canonical `axmatea/compass-horizon` main with root directory `/compass`,
using the existing `compass/Dockerfile` and `compass/railway.json`.
No root Dockerfile, provider settings, DNS, service binding or deployment changes
are part of this cleanup. Do not claim the new version is deployed before the
release operator verifies that publication.

Keep the product's required third-party notices and bundled font licenses with
their assets. The root copies were duplicates, not replacement license sources.
