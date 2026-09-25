# COMPASS

Canonical repository: [axmatea/compass-horizon](https://github.com/axmatea/compass-horizon).

## Virtual office

`/` and `/app` open a populated six-seat studio without sign-in. Select a person,
introduce a supplier delay, review the revision and approve the local plan.
Shared memory keeps original notes alongside the decision. `/presentation`
walks through the same scenario in six scenes.

This is a labeled frontend concept. No live AI, authentication, database,
invitations or multi-user persistence is connected. Reload clears local edits.
Vincent's Python backend is preserved in `remaster/` but not connected to this UI.

See [migration boundaries](docs/OFFICE_DESIGN_MIGRATION.md) and
[speaker script](src/office/story/SPEAKER_SCRIPT.md).

## COMPASS product (compass/)

The full COMPASS product lives in `compass/`: the cinematic website (Six people. One shared memory. One team.), the office workspace (`/office`, `/app`), the presentation (`/presentation`), the voice proof (`/demo`) and the Horizon (`/horizon`). Narrative source of truth: `compass/docs/NARRATIVE.md`.
It has its own toolchain (Vite + Node): `cd compass && npm ci && npm run build && node server.mjs`. Live at https://mycompass.world (Railway). The root Next.js app ignores this folder (tsconfig, eslint, .vercelignore).

## Preserved Horizon example

COMPASS shows an acquisition agent learning, day by day. Two campaigns run for 21 days: A (Free AI Audit) brings cheap, fast leads and B (CPA Autopilot) brings slow, busy buyers. The Horizon graph puts every event on a lane by the day the agent learned it. The agent leans A on Day 3, goes back to unsure on Day 6 when busy buyers answer, changes its mind on Day 9 and tightens its own rule, is confirmed on Day 11 when late CRM data arrives, and B closes $18,000 on Day 21. Drag the handle to see exactly what the agent knew on any day.

## Simulated vs real
- Simulated, and labeled on screen: the campaign data (scenario `ai-media-q4`, fictional people and firms) and the clock.
- Real: the deterministic engine that turns those events into beliefs. A bitemporal ledger (when it happened, when the agent learned it), idempotent appends, a belief gate (INSUFFICIENT, LEANING, SUPPORTED), lessons that raise the decision policy version, and a time machine that re-projects the world as known on any day. All covered by tests.

The page is static and works offline: no API routes, no database, no env vars, no network.

## Run
```
npm install
npm run dev      # http://localhost:3000
npm test
```
Open `/horizon?day=9` to start on a given day. Keys: Left and Right jump between key days, Space plays or pauses.

## Structure
- `src/engine`: the pure engine. Scenario, wake runs, in-memory ledger, `project(events, { asOfDay })` returns a `WorldView` (`src/contract.ts`).
- `src/lib/sim.ts`: runs the scenario through Day 21 in the browser and serves `frameAt(day)`.
- `src/components/horizon`: the screen. `Compass.tsx` (header, readout, controls), `Horizon.tsx` (the graph), `story.ts` (labels).
- `src/app`: office, app alias, presentation and Horizon routes. `/demo` redirects to `/`.
- `src/office`: office model, scene, shared styles and narrative.
- `tests`: ledger and idempotency, late events, policy gate, story arc, time machine, extraction, crash-safe runs, the simulation.

## Feeding real data
Replace `src/lib/sim.ts` with a fetch that returns `WorldView` frames (one per day, as the agent knew it). The screen only reads `WorldView`.

This contract belongs to Horizon, not the upcoming team workspace backend.

## Office checks

```
node --experimental-strip-types --test src/office/model.test.mjs src/office/scene/layout.test.mjs
npm run lint
npm run typecheck
npm run build
```
