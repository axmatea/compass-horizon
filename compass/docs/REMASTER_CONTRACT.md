# REMaster UI / Vincent runtime contract v1

The frontend is not an agent implementation. Vincent owns Strategist, Doer,
Cleaner, Shadow, persistence, model calls and evidence. The shared DTOs live in
`src/remaster/types.ts`; no acquisition data is repurposed as team data.

## Modes and authorization

Public `/` uses FixtureTransport: deterministic synthetic data, no API calls.
Private `/app` uses LiveTransport and same-origin `/api/remaster/*`. There is no
fallback from live to fixtures. Both modes use a simulated six-person team.
"Live AI" describes runtime execution, never a real team or real quarter.
No $299 price, checkout, outbound communication or microphone in this release.

The bridge requires the existing invited session and an explicit server gate.
Missing Vincent URL/token or authorization returns BLOCKED before any upstream
request. Tenant/user identity comes from the verified session, not client input.
Vincent must enforce ownership using the server-to-server identity. Tokens and
upstream URLs never enter browser configuration. No provider spending is enabled
by installing the adapter.

## Endpoints

- GET `/api/remaster/status`: `{status:'BLOCKED'|'CONFIGURED', reason:string}`.
  CONFIGURED is presence validation, not proof of a working runtime.
- POST `/api/remaster/runs`: `{seed:number,stressTest:boolean}` -> `{snapshot}`.
  Live uses `stressTest:false`; only the fixture deliberately corrupts memory.
- GET `/api/remaster/runs/:id`: `{snapshot}`.
- POST `/api/remaster/runs/:id/commands`: the Command DTO -> `{snapshot}`.
  The same commandId must not cause another action. Never automatically retry
  an ambiguous POST; refetch state and report uncertainty.
- GET `/api/remaster/runs/:id/events?after=N`: SSE `event: state` with a JSON
  RuntimeEvent. SSE ids correspond to monotonically increasing `seq` per run.

RuntimeEvent includes the complete authoritative snapshot, allowing recovery
without reconstructing decisions in the UI. Duplicate/older sequences are
ignored. A sequence gap triggers GET snapshot; reconnect also resynchronizes.
Reject another run ID, invalid DTO or fixture-labelled response in live mode.
No state change is invented after network failure.

## Simulation and rendering

12 weeks x 5 working days = 60 days, six sprints. Day zero is the initial board.
The fixture advances one day per 2 seconds while running. Pause freezes it.
The public stress test explicitly archives Sarah's availability before a future
assignment; its Shadow recovery is scripted. No-stress mode retains the fact
and prevents the invalid assignment without claiming a restore. Deadline and
dependency changes must affect the result; completion is not always victory.

Metrics come from the snapshot. Unavailable tokens/cost/benchmarks are omitted,
not filled with attractive numbers. Receipts are empty for fixtures. Frontend
memory drawers render fact IDs, source, cleanup reasons and actual checks.

## Ownership

- UI worker: `src/remaster/App.tsx`, `components.tsx`, `styles.css`, `main.tsx`.
- Fixture worker: `src/remaster/fixture.ts`, fixture tests only.
- Live worker: `src/remaster/live.ts`, `server/remaster-bridge.mjs`, live/bridge tests.
- Integrator: DTOs, entrypoints, routing, docs, scripts, QA, commits and PR.

No worker merges main, deploys, calls providers or changes the acquisition DB.
