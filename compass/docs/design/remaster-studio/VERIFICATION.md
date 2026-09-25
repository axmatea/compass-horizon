# GPT Image studio implementation

Date: 2026-09-25. Local preview: http://localhost:8770/.

## What was produced

- One GPT Image UI concept and one derived clean studio plate. Both use the
  built-in image tool; no Higgsfield generation was called or billed.
- React scene with six accessible teammate hotspots, actual task statuses,
  selected sprint, source-backed memory preview and one latest decision.
- Responsive layout with reduced-motion behavior, state-driven highlights,
  and a visible simulation badge on mobile and desktop.
- A 281300-byte WebP is the only new image served. Original PNGs, prompts,
  generation source paths and SHA256 hashes are retained in manifest.json.

## Verified

- `npm run build`: TypeScript and production build pass.
- `npm run test:remaster`: 66 tests passed, none skipped.
- `npm run qa:remaster`: 390/768/1440px, interventions, pause, reset, details,
  source references, retained and restored facts, actual failure outcomes.
  No public API calls, third-party requests, overflow or browser exceptions.
- `npm run qa:remaster-studio`: six 44px+ hotspots, focus return, normal motion,
  simulation badge visibility, paused recovery and unavailable-image fallback.
- Browser-only live API mocks verify a different roster and one owner-transfer
  path. These tests are not proof of a live runtime connection.
- 1280x720 laptop: whole studio remains above the controls. Right-hand evidence
  rail scrolls independently; mobile uses document scrolling.
- Required web-game Playwright client passed two deterministic action bursts;
  resulting screenshots were visually inspected, including active work.

The extra browser test exposed a pre-existing timer binding bug in LiveTransport.
Binding the default browser timers to globalThis fixes Illegal invocation before
the first fetch. Injected test timers retain their existing behavior.

## Evidence and limits

Reports and screenshots: delivery/remaster/qa/, delivery/remaster/studio-qa/,
delivery/remaster/studio-game-client-final/. These outputs are ignored by Git.

The room is a static illustration, not animated 3D or a screenshot of live people.
Names, times, tasks, buttons and evidence are DOM content from existing state.
The concept image's sample text/numbers were not imported as product claims.

In the default fixture, day-32 recovery changes Sarah's dates, not her task owner.
No transfer animation is shown without an actual owner-ID change. A deliberate
fault is still disclosed and success is still not guaranteed.

Vincent's runtime is still BLOCKED. No provider calls, secrets, purchases,
Higgsfield credit use, production changes or replacement video occurred.
The existing three-minute MP4 shows the earlier interface, not this studio.
