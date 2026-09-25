# COMPASS human workspace frontend

Owned scope: `src/workspace/**`. `App.tsx` is the default export and imports its
stylesheet. Routing, HTML, backend, login and package scripts belong to the
integrator. No commits or deployments are made by this frontend task.

## Modes and interaction

- `/app` is live, even with `?demo`. Other entry routes render a clearly labeled
  local session demo. Demo performs no fetch or EventSource calls.
- SVG/React table and original illustrated human avatars use existing local
  Manrope. No generated images or external visual assets. The integrator added
  a small MIT-licensed facing helper from agent-virtual-office at c238a30;
  acknowledgement movement occurs only for a confirmed action, never presence.
- Confirmed task events briefly highlight table cards. No random movement,
  timers simulating work, online indicators or productivity claims.
- Task, member and material drawers use native modal dialogs. All visible
  controls are keyboard accessible, with reduced-motion and mobile layouts.
- Demo approval is a prewritten, explicitly scripted example with inspectable
  source evidence. It adds one local task, not a model execution.

## Trust and imports

- Live snapshots are validated, bigint sequences reject older responses, and
  task PATCH/DELETE uses the version originally opened by the user. Task edits
  are not presented as authoritative until a verified snapshot arrives.
- SSE uses `state`. `workspace-error` clears private state and reloads membership.
  Ordinary reconnect fetches a fresh snapshot before reconnecting the stream.
- Sign-out uses the existing same-origin auth endpoint and navigates away after
  success. Access loss closes drawers and clears uploads/invitation results.
- Invitations are manual, signup-aware links. URL invitations require a click
  before acceptance; successful joining removes the token from the address.
- `.txt`, `.md`, `.csv`: 5 MiB limit. CSV is parsed before saving, validates UTF-8
  title bytes, controls, dates, status, members, row width and maximum 200 tasks.
  CSV source is retained as a material before task creation. Each preview owns
  stable source/row command IDs; confirmed rows are removed from retry batches.
  Neither Markdown/HTML nor spreadsheet formulas are executed.

## Verification

```sh
npm run typecheck
node --experimental-strip-types --test src/workspace/*.test.mjs
```

The integrator owns browser QA and build commands. `window.render_game_to_text()`
returns lightweight product state for automation, without invitation tokens or
material bodies. The legacy name is a QA hook, not a claim this product is a game.
