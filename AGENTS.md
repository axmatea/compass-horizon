<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# COMPASS repo guide for agents

Canonical repository: axmatea/compass-horizon. The maintained product imported
from axmatea/compass lives in compass/. Do not use the legacy repository as a
source for new changes. Read README.md first.

## Structure
- `compass/`: Vite + Node product with its own README, package and lockfile.
  It includes a PostgreSQL/auth workspace server, scripted public demos and
  Protect the Office. The AI team runtime is not automatically connected.
- `remaster/`: separate Python simulation/research runtime, not an office backend.
- The paths below belong to the separate root Next.js office concept:
- `src/engine`: pure deterministic engine (scenario `ai-media-q4`, wake runs, in-memory ledger, `project()` returns `WorldView` from `src/contract.ts`).
- `src/lib/sim.ts`: client-side simulation, `frameAt(day)` memoized. Replace it with a fetch of `WorldView` frames to feed real data.
- `src/components/horizon`: `Compass.tsx` (screen), `Horizon.tsx` (graph), `story.ts` (labels), `horizon.css`.
- `src/office`: interactive synthetic office, source history, shared plan and walkthrough.
- `/` and `/app`: public office, no login gate. `/presentation`: office walkthrough.
- `/horizon`: original graph. `/demo` redirects to `/` in `next.config.ts`.

## Commands
- Product: `npm run product:install`, `npm run product:dev`,
  `npm run product:typecheck`, `npm run product:test`, `npm run product:build`.
- Next.js: `npm run dev`, `npm test`, `npm run test:office`,
  `npm run typecheck`, `npm run lint`, `npm run build`.

## Rules
- No em dashes anywhere in copy, code or comments.
- Honest labels: demo data and the simulated clock stay labeled. Unknown stays unknown, never $0.
- Preserve the root Next.js deployment and the product's compass/ Docker/Railway
  paths. Cleanup is not permission to merge main, deploy, change DNS or run
  paid provider probes. Keep dependency versions and lockfiles independent.
- Do not import the product server into Next.js or pretend fixtures are live.
- Delete files only after checking build entries, routes, dynamic imports,
  assets, tests and supported scripts. Preserve attribution and unique modules.
