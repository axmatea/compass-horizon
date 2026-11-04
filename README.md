# COMPASS

Canonical repository: [axmatea/compass-horizon](https://github.com/axmatea/compass-horizon).

The application from the former `axmatea/compass` repository was consolidated
in `compass/` by commit `4f498d7`. Make changes here, not in the legacy
repository. Git history preserves the imported source and subsequent changes.

## Start the product

Use Node 22.12 or newer. Run these commands from the repository root:

```sh
npm run product:install
npm run product:build
npm run product:start
```

Open http://localhost:8770. For development, use `npm run product:dev`.
The public workspace demo, presentation, Horizon and security-training game
use synthetic data and do not require paid model calls.

Private collaboration requires explicitly configured PostgreSQL and auth.
The team AI runtime is not connected merely by starting this application.
See [the product guide](compass/README.md) for routes, environment requirements
and the boundary between real collaboration and scripted demonstrations.

## Repository layout

| Area | Purpose | Commands from the root |
| --- | --- | --- |
| `compass/` | Vite + Node product, workspace/auth server, voice prototype and training game | `product:dev`, `product:build`, `product:start`, `product:test`, `product:typecheck` |
| `src/`, `public/`, `tests/` | Separate Next.js public-office concept and deterministic Horizon engine | `dev`, `build`, `start`, `test`, `test:office`, `typecheck`, `lint` |
| `remaster/` | Vincent's Python simulation/research runtime | [Research guide](remaster/README.md) |

These are not interchangeable copies. The Next.js concept has no live auth,
database or multi-user persistence. Its edits reset on reload. The Python
runtime is not wired into either office frontend. Keep each component's
simulation disclosures, licenses and deployment boundary intact.

Both JavaScript applications retain independent lockfiles and React versions.
Do not combine their dependency trees or move `compass/` as incidental cleanup.

## Verify changes

For the product:

```sh
npm run product:typecheck
npm run product:test
npm run product:build
npm --prefix compass run test:protect
```

Database tests require an explicit local test DSN. Never run them against
production. Provider probes and `test:live` are not ordinary cleanup checks.

For the Next.js concept and Horizon engine:

```sh
npm ci
npm test
npm run test:office
npm run lint
npm run typecheck
npm run build
```

`/`, `/app` and `/presentation` expose the fictional public-office scenario.
`/horizon?day=9` opens the deterministic campaign simulation: events distinguish
when something happened from when it became known. Belief gates and policy
changes are tested; campaign revenue and confidence labels are illustrative,
not actual customer results or measured model confidence.

## Deployment boundaries

The existing root `build` and `start` commands remain Next.js commands for
the root deployment. The product keeps `compass/Dockerfile`,
`compass/railway.json`, its own server and the existing root-directory layout.
This consolidation does not change DNS, service bindings or production data.
Verify the provider's active source and obtain approval before deploying.

See [the consolidation verification](docs/REPOSITORY_CONSOLIDATION.md) for the
removed-file scope and local checks.

See [the historical Next.js migration](docs/OFFICE_DESIGN_MIGRATION.md),
[product release gates](compass/docs/WORKSPACE_RELEASE.md) and
[the office speaker script](src/office/story/SPEAKER_SCRIPT.md).
