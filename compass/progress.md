Original prompt: Implement COMPASS REMaster as one interactive game: launch an AI-managed quarter, introduce changes, inspect memory and recovery. Keep the existing warm Manrope/cobalt design; Vincent owns the runtime. Preserve Acquisition separately, no paid calls or production deployment before release gates.

## Human workspace implementation, 2026-09-25

- Demo table visual revision: full-width project room, original SVG desk,
  upholstered chairs, laptop, notebook, plant and consistent daylight shadows.
  Compact member portraits replace oversized characters; readable task cards
  live below the illustration. People/folder/tasks retain keyboard controls.
  Real workspace scene and authentication remain unchanged; no media spend.

- Removed the demo entry gate on request. Root and /demo/workspace now open
  directly into the populated fictional account; reset/reload never asks for
  login. Private /app authentication is unchanged.

- Added /demo/workspace after user requested a ready-to-show frontend account.
  One-click fictional identity, task pipeline, source-backed Memory, manually
  stepped Machines example and explicit proposal approval. No new credentials,
  API requests, models, billing, auth bypass or production publication.
  Browser QA covers entry, all sections, source, approval, move, reset and exit
  at 390/768/1440 with no overflow or JS errors.

- User approved a shared workspace for humans, not contact CRM or coding agents.
- Branch codex/human-workspace from e291648; backend and frontend have disjoint
  worker ownership. Main owns integration, auth redirects, QA and release.
- React/SVG scene replaces static artwork on the main route. Old simulation is
  retained at /demo/remaster; previous acquisition routes/data remain intact.
- Railway access verified, but no production database/auth/workspace runtime.
  Awaiting resource approval or an existing DB. No paid service provisioned.
- Final regression run: 273 tests passed, zero skipped, with local test PG.
- Workspace suite: 29 passed; legacy REMaster: 66 passed (overlapping suites).
- Team signup keeps a one-use membership token through safe fixed login routes.
- Completed worker integration, 390/768/1440 browser QA, two-account live local
  QA with actual process restart, revoked access and sign-out; no JS errors.
- Small upstream facing helper adapted at pinned c238a30 with full MIT notice;
  no coding-agent hooks, scanners, random productivity or presence animations.
- Release instructions and 60-second stage script: docs/WORKSPACE_RELEASE.md.
- Commit and push a draft release branch only. Production remains gated on a
  persistent database and secure auth. AI stays explicitly BLOCKED.

## 2026-09-25

- Created branch codex/remaster-experience from 5264a9e.
- Contract and shared DTOs established before parallel implementation.
- UI, fixture simulation and authenticated runtime bridge have disjoint owners.
- Public fixture is a labelled simulation. Live is BLOCKED without Vincent's
  endpoint, server authorization and session; there is no silent fallback.
- TODO: implement, run typecheck/tests/game client, inspect screenshots, record
  a real three-minute walkthrough, commit/push a draft PR without merging main.

### Integration checkpoint

- New primary entry and legacy presentation aliases point to the game.
- Acquisition entry preserved at /acquisition and /acquisition/app, including
  invited auth. /login?returnTo=/app returns invited users to the game runtime.
- Server bridge uses existing server-verified identity; no competing runtime.
- Added browser QA and a real-time UI recording script for a silent 180s MP4.
- Baseline regression: 232 backend tests passed with local PostgreSQL, none
  skipped; seven Acquisition fixture tests passed. Typecheck passed before CSS
  and final agent changes. New REMaster tests and visual QA are still pending.
- Preview stopped while PostgreSQL integration tests ran, avoiding queue races.

### First-cut verification

- Game and transport workers handed off; implementation frozen for recording.
- Build passes. 66 REMaster tests pass (30 fixture, 36 client/bridge).
- Game QA passes 390/768/1440, source/person/task drawers, pause/reset, both
  memory paths and two failure outcomes. Public game makes zero API calls.
- Inspected final mobile, desktop, memory and game-client screenshots.
- Fixed old invite form URL rewrite found by regression QA. Public/private
  Acquisition browser flows now pass, including persistence after reload.
- Three-minute actual UI capture is running; runtime URL still not supplied.

### Delivery checkpoint

- Final backend suite: 254 pass, zero skipped. Source diff/secret scan passes.
- Actual UI video rendered, 179.967s / 1080p / 30fps / H.264, silent. Full decode
  and sampled frames checked. Raw WebM + timecodes retained in delivery/remaster.
- Trimmed initial browser-navigation flash. Last Week/12 header tweak is not
  reflected in the first-cut video; behavior and disclosures are unchanged.
- BLOCKED: Vincent runtime URL/token/compatibility, live tenant ownership and
  resource authorization. Do not enable live, provision resources or merge main.

### GPT Image studio redesign

- User requested GPT Image design and implementation. Built-in GPT Image used
  for a design concept and text-free studio plate; no Higgsfield credits spent.
- Working in codex/remaster-gpt-studio from 1bc1c3d. Production unchanged.
- New illustrated game scene uses real DOM hotspots, snapshot-driven task states,
  transfer paths only on reported reassignments, and a compact evidence rail.
- Fixture/live transports and backend untouched. Different runtime rosters or
  failed artwork fall back to accessible roster controls, not fabricated state.
- Complete: build and 66 fixture/live/bridge tests pass. Existing browser QA
  passes 390/768/1440 with both memory paths, interventions and no public API calls.
- Studio-specific browser QA passes all six 44px+ hotspots, keyboard focus return,
  normal motion, paused recovery, missing artwork and an explicitly mocked live
  roster/owner transfer. At 1280x720 the entire studio fits above the controls.
- Found and fixed pre-existing browser Illegal invocation in LiveTransport:
  default setTimeout/clearTimeout now bind globalThis. Verified via browser-only
  mocked API; no actual Vincent runtime or provider access was exercised.
- Default day-32 recovery moves Sarah's work earlier, not to another person.
  The UI correctly draws no owner-transfer path for that date-only change.
- Built-in GPT Image concept and clean plate saved with prompts/SHA256 manifest.
  Web asset: 1536x1024, 281300-byte WebP. No text baked into interactive controls.
- Old 180-second video predates this redesign; handoff explicitly labels it old.
- Live remains BLOCKED; no spending, external publication or deployment.
