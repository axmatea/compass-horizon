<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# COMPASS repo guide for agents

Canonical repository: axmatea/compass-horizon. Public office concept plus the preserved Horizon simulation. No live office backend yet.

## Structure
- `src/engine`: pure deterministic engine (scenario `ai-media-q4`, wake runs, in-memory ledger, `project()` returns `WorldView` from `src/contract.ts`).
- `src/lib/sim.ts`: client-side simulation, `frameAt(day)` memoized. Replace it with a fetch of `WorldView` frames to feed real data.
- `src/components/horizon`: `Compass.tsx` (screen), `Horizon.tsx` (graph), `story.ts` (labels), `horizon.css`.
- `src/office`: interactive synthetic office, source history, shared plan and walkthrough.
- `/` and `/app`: public office, no login gate. `/presentation`: office walkthrough.
- `/horizon`: original graph. `/demo` redirects to `/` in `next.config.ts`.

## Commands
- `npm run dev`, `npm test`, `npm run typecheck`, `npx eslint src`, `npm run build`.

## Rules
- No em dashes anywhere in copy, code or comments.
- Honest labels: demo data and the simulated clock stay labeled. Unknown stays unknown, never $0.
- Deploys go through Vercel from `main`.
- Vincent owns the upcoming backend. Do not import the old compass server or pretend fixtures are live.
