# Local homepage QA

September 17, 2026, Pacific time. Branch: `codex/compass-homepage`.
Test target: production build served by `server.mjs` at http://127.0.0.1:8780/.
No deployment or remote push performed for this revision.

## Completed

- Read README, DEPLOYMENT, repository state; fetched origin. Branch created from
  `2a345e9`, matching origin/main at the start. Existing untracked Vercel files
  were preserved and excluded from this work.
- Inspected anonymous production in browser: root opened presentation directly.
- Inspected installed `/Applications/Zoey OS.app` visually without changing its
  settings. Used compact controls and panel hierarchy as a reference.
- `npm run build`: TypeScript check and Vite production build passed. Both
  `index.html` and `present.html` emitted with local CSS/JavaScript assets.
- `git diff --check`: passed.
- Browser visual review: desktop 1440×900 and 1280×720, mobile 390×844 and 320×740.
  DOM scroll width matched viewport at 1280, 390 and 320 pixels.
- Desktop first thought → correction → next step: confirmed Friday survives,
  concern changes to payment, terms become 50/50, draft is marked NOT SENT.
- Keyboard Tab + Enter advanced the interaction; editable textarea received
  focus visibly. Draft could be edited; Restart restored the initial state.
- Skip link bypassed header and moved keyboard flow to the first main CTA.
- Mobile next-step panel and closing actions reviewed visually. Essential
  disclosure/context text increased to 12px; draft textarea increased to 16px.
- Motion pause toggled the orb's computed animation-play-state to paused and
  persisted across route navigation. Re-enabled it after testing.
- `/present.html` opens presentation. Existing `/#present` redirects there.
  Website link returns to the scrollable homepage.
- Presentation ArrowRight and End navigation and speaker notes passed locally.
- `/present.html`, `/film.html`, `/demo.html?deck=0`, heroine, captions and health
  endpoint returned 200. `/server.mjs` returned 404.
- NYC film byte-range request returned 206 and the requested 32 bytes.
- Browser error log during the exercised local routes was empty.

## Scope and limits

Reduced-motion CSS and JS branches were inspected in source; the operating
system reduced-motion setting was not toggled. The explicit motion pause was
browser-tested. Physical iOS/Android devices and screen-reader audio were not
used. Browser speech quality and the film's full 60-second playback were not
retested; their media/engine code is unchanged. Docker input was updated for
both HTML entries; a container image was not built in this pass.

All conversation content is prepared locally. No live AI, microphone, backend,
external send, persistent memory, provider latency or real-world usefulness is
being verified or claimed. The existing video is reused unchanged.

## Release gate

Await the user's deployment request. Then review and publish the intended
commit through the existing repository/service, verify the deployed commit in
Railway and inspect the public homepage and presentation. Current production
has not changed as part of this revision.
