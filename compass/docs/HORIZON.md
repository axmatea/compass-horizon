# Horizon (long-horizon view)

The agent learning day by day: ledger, compaction, late data, revised beliefs. Demo data, simulated clock. It runs fully in the browser, with no backend and no keys.

## Routes
- `/horizon`: the 2D Horizon (Play, Back, Next, scrub; `?day=N`).
- `/horizon?view=3d`: the WebGL scene (three.js loads only here). Falls back to 2D when WebGL is missing or reduced motion is on.
- `/horizon?view=phone`: the iOS-style app screen (a CSS device frame on desktop, full screen on a phone).
- `/horizon?embed=1`: chrome-free mode used by the "Long horizon" scene in `/presentation`.

## Files
- `src/horizon/engine/**`, `contract.ts`, `sim.ts`: pure deterministic engine, ported from axmatea/compass-horizon.
- `src/horizon/ui/**`: the 2D view and playback. `three/`: 3D. `phone/`: phone view. `scene.css`: presentation scene.
- `horizon.html` is a Vite entry. `server.mjs` maps `/horizon` to `horizon.html`.

## Merging with other branches
This change is additive. The only edits to shared files are one input line in `vite.config.ts`, one route in `server.mjs`, one scene in `story.html` (with its orb position and autoplay delay in `src/cinematic/app.js`), plus the new deps in `package.json`.
