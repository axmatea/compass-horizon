# REMaster verification / 2026-09-25

Local release on `codex/remaster-experience`, based on `5264a9e`. Production is
not changed. This is a playable, explicitly labelled simulation and a tested
integration boundary, not a verified autonomous agent runtime.

## Executed checks

- `npm run build`: TypeScript and Vite production build pass.
- Final full backend suite, including the bridge: 254 pass, zero skips.
- Baseline `npm test` with loopback PostgreSQL: 232 pass, zero skips. Existing
  acquisition data isolation, durable queues and invited auth remain intact.
- `npm run test:acquisition-ui`: seven fixture tests pass.
- `npm run test:remaster`: 66 tests pass, zero skips. Thirty fixture tests plus
  36 client/bridge tests using fake upstreams, not paid or live provider calls.
- `npm run qa:remaster`: 390/768/1440px, touch configuration at 390, reduced
  motion, keyboard focus/Escape, person/task details, source expansion, start,
  pause/resume, reset confirmation and all three intervention presets pass.
- Stress path: day 30 archive, day 31 divergence, day 32 restore; no-stress path:
  retained fact, invalid assignment prevented, zero restores. Shorter deadline
  and dependency delay produce unfinished work, not a hard-coded victory.
- Public game makes zero API or third-party requests. All three sizes have zero
  page errors and no horizontal overflow; the primary action is in the initial
  viewport. This is an automated visibility check, not a ten-second user study.
- The installed develop-web-game Playwright client ran against the built game
  using deterministic `advanceTime` and `render_game_to_text`. Final screenshots
  were visually inspected, including mobile, divergence and Memory X-ray.
- Client tests cover sequence deduplication, gaps, reconnect snapshot reads,
  bounded retries, cancellation, uncertain writes and no fixture fallback.
  Bridge tests cover verified identity, allowed paths, same-origin writes,
  bounded/validated SSE, sign-out revalidation and credential redaction.
- Existing public Acquisition tour and private invited-account browser QA pass:
  save business, create experiment, add incomplete lead, correct qualification,
  reload persisted state, blocked provider call and sign out.

Found and fixed during QA: accepting an Acquisition invite previously rewrote
the URL to `/app`. It now stays on `/acquisition/app`, or preserves the explicit
REMaster login return path. A reload no longer opens the wrong application.

## Reproduction and artifacts

The local preview is `http://localhost:8770`. No provider keys are needed for
the public game. Use the loopback test database procedure in
`ACQUISITION_VERIFICATION.md` for private QA. Do not run destructive test fixtures
against production. Stop preview workers using that database for backend tests.

Reports/screenshots are in ignored `delivery/remaster/qa` and
`delivery/remaster/game-client-final`; preserved Acquisition QA is in
`delivery/qa`. The reproducible screen capture is `npm run record:remaster`.
The stage script is `docs/REMASTER_PITCH.md`.

## Rendered first cut

`delivery/remaster/COMPASS_REMaster_Walkthrough_180s_1080p.mp4` exists: H.264,
1920x1080, 30 fps, 179.967 seconds, 6,810,695 bytes. It is silent for live
narration, with no music, synthetic voice or audio synchronization claim.
FFmpeg decoded the complete export without errors; sampled archive, disagreement,
recovery and outcome frames were inspected. Trimmed the first 0.5 seconds of
browser navigation from the raw capture. The initial frame now shows the game.

Raw WebM and `video-manifest.json` retain source and action timecodes. The
simulation's actual outcome appears around 02:40. The footage was captured before
the final Week 1/12 header-label addition; game behavior is unchanged. This is
not generated footage or evidence of a live runtime. Playwright/FFmpeg were used
programmatically; no Higgsfield or DaVinci MCP call was made.

## Live release gates

Vincent's endpoint, contract compatibility, durable run state and tenant
ownership are **not verified**. Live is BLOCKED without runtime URL/token,
invited-session infrastructure and explicit server enablement. The bridge
does not implement Strategist, Doer, Cleaner, Shadow or model execution.
No real SSE stream, provider receipt, memory-quality benchmark, multi-week run,
token savings, Rawtree integration or production sponsor success is claimed.

No production database, paid resources, deployment, subscription, generated
film or main merge was performed. The draft release must remain gated. The
old Acquisition schema and records were not deleted or migrated away.
