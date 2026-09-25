# Public mission workspace

Default React export: `src/mission/App.tsx`. The integrator should mount this at
`/` and the chosen public-demo alias. This module does not own routes, entry HTML,
dependencies, or backend. Keep `/app` pointing at the real workspace.

The frontend imports only React, the existing `createDemo` seed and domain types,
plus its own model and scoped CSS. Manrope is loaded from the existing local
`/acquisition/fonts/manrope-variable.ttf`. No new dependencies or remote assets.

## Local behavior

- Immediately populated with Sunday studio, Maya, Leo, four tasks and two sources.
- Status selects move tasks between columns; the person filter is functional.
- Source dialogs use native modal focus containment, Escape and focus return.
- Machines requires inspect, then scripted proposal, then demo-owner confirmation.
  A stable task ID and reducer gate ensure repeated approval adds only one task.
- Pipeline and Memory derive their decision state from the same reducer.
- Reset restores the original seed, machine gates, source selection and filter.
- State exists only in React memory. No fetch, storage, AI, or server persistence.
- Horizon is an explicit link to a separate simulated A/B experiment, not an
  automatically mounted iframe. Percentages and $18k are labeled illustrative.
- Header links: `/presentation`, `/horizon`, `/app`, `/voice-demo`.

## Verification

`node --experimental-strip-types --test src/mission/model.test.mjs`

For integrator browser QA: inspect 390/768/1440 widths; switch all five sections;
change task status and assignee filter; open/close a source with keyboard; perform
inspect/propose/confirm; verify exactly five tasks and the linked source; confirm
Reset and refresh return to four. Check reduced motion and no API requests.

## Accessible labels for browser QA

- Navigation landmark: `Workspace sections`. Buttons: `Workspace`, `Pipeline`,
  `Memory`, `Machines`, `Horizon`. Selected button has `aria-current="page"`.
- Header navigation landmark: `Product links`. Links: `Presentation`, `Horizon`,
  `Voice demo`, `Real account`. Distinguish the Horizon link from its nav button.
- Person filter combobox: `Filter tasks by person`.
- Task combobox: `Status for <exact task title>`. Values: `todo`, `doing`, `done`.
- Machine sequence: `Inspect source`, then `Close` (or Escape), then
  `Create scripted proposal`, `Confirm as demo owner`, `View updated plan`.
- Reinspection label becomes `Inspect source again`. Confirmed task title:
  `Check step-free access and restroom details`.
- Reset button: `Reset demo`. Native source dialog name: its document title,
  usually `Venue conversation`. Feedback uses a polite, atomic status region.

## First-cut checks

- Five model tests pass, including approval idempotency and immutable reset.
- Full merged `npm run build` passes. Existing Horizon3D chunk-size warning remains.
- Chromium production-preview smoke passes at widths 390, 768 and 1440 with no
  horizontal overflow. Verified source modal/Escape, inspect/propose/confirm,
  five-task result, status movement, four-task reset, and all section navigation.
- No browser page errors observed in that smoke run. Full visual, screen-reader,
  reduced-motion, and deployed-route QA remain with the integrator.
