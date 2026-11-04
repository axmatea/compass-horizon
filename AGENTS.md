# COMPASS Agent Guide

Read `README.md` first, then relevant guidance inside `compass/`.
Canonical repository: `axmatea/compass-horizon`. Do not develop in the legacy
`axmatea/compass` repository or restore retired projects as incidental cleanup.

## Single-App Architecture

- `compass/` is the only application: Vite/React frontend, Node server,
  PostgreSQL workspace records and Better Auth.
- Supported UI: public homepage `/`, private working office `/app`, and login
  `/login?returnTo=/app`. There are no supported demo or presentation routes.
- Root `package.json` only forwards commands with `npm --prefix compass`.
  Application dependencies and their lockfile belong to `compass/`, not root.
- The root Next.js office/simulation concept, disconnected Python research,
  historical presentations and roadmap documents are retired. Git history is
  the recovery source. Do not create archive directories or rewrite history.
- The AI runtime is **BLOCKED** pending an implemented and verified
  human-workspace contract. Real manual collaboration is not autonomous AI.
- Publication does not authorize a new database. The private office remains
  unavailable until DB/auth configuration is separately authorized and verified.

## Commands

```sh
npm run product:install
npm run dev
npm run typecheck
npm test
npm run test:workspaces
npm run build
npm start
```

`npm run dev` runs the frontend; run the Node server separately for the API.
Existing `product:*` aliases remain supported. Root `npm ci` installs no app
dependencies. After changing root scripts, regenerate its dependency-free
lockfile with `npm install --package-lock-only`.

## Safety And Ownership

- Work with dirty state and other workers. Respect assigned write boundaries,
  do not revert others' changes, and never stage unrelated files.
- Check imports, dynamic loads, build entries, routes, scripts and assets
  before deletion. Communicate cross-owner dependencies before removing them.
- Keep private office data, auth and membership checks, persistence, invitation
  handling, required attribution and licenses. No production-data cleanup.
- Do not fabricate presence, results, model confidence or successful provider
  integration. Unknown is unknown. Do not silently substitute fixture data.
- Tests must use local fixtures or an explicitly approved local test database.
  Do not load live secrets, invoke paid probes or run tests against production.
- Provider/backend/product-package changes and frontend changes may have
  separate owners. Coordinate instead of editing another worker's files.
- The parent owns hosting and the pending post-merge rebind to canonical main.
  Planned Railway root directory is `/compass`, using its existing Dockerfile
  and Railway configuration. Do not add root infra,
  edit `.vercel` settings, deploy, rebind services or change DNS without current
  explicit approval. A local build or HTTP 200 is not deployment verification.
- No em dashes in copy, code or comments. No commit, push or history rewriting
  unless specifically requested.
