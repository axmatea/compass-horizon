# Final presentation

Default React export: `App.tsx`. Imports its own scoped `finale.css`; requires only
the existing React runtime. Mount on `/presentation` in the shared entry. This
folder does not own routes, dependencies, backend, deployment, or other UI.

Eight manually navigated scenes, visible Previous / Next, keyboard arrows,
progress, on-screen speaker notes, and `SPEAKER_SCRIPT.md` (about three minutes).
The illustrated Sunday studio workflow only changes React state. No persistence
or AI calls. Original materials and tasks are retained alongside one another;
there is no implemented per-task source link. Source-linked proposals are concept
illustrations, not a claim about the persisted task schema.

Horizon mounts only on scene 5 at `/horizon?embed=1` and unmounts when leaving.
The embed keeps its own keyboard controls; use the deck's buttons to leave it.
Its disclosure remains outside the iframe. 2D / 3D / Phone open separate tabs.
No media or voice activation is performed by the deck. Demo links are relative
to the host origin. The local Manrope asset is
`/acquisition/fonts/manrope-variable.ttf`; display text uses Georgia.

## Verification

After the integrator mounts the route and starts a local Vite server:

```sh
node src/finale/qa.mjs http://127.0.0.1:5197
```

The check covers all eight scenes at 390/768/1440px in both motion preferences,
local font loading, keyboard and button navigation, focus transfer, notes/Escape,
overflow, progress, final links, and active-only real Horizon embed mounting.
External requests and API calls are blocked and fail the check. Screenshots go
to an OS temporary directory, not the shared delivery tree. Voice is not opened.

For an isolated typecheck without changing the shared build configuration:

```sh
node_modules/.bin/tsc --noEmit --jsx react-jsx --target ES2022 --module ESNext --moduleResolution Bundler --lib ES2022,DOM,DOM.Iterable --strict --skipLibCheck src/finale/App.tsx
```

Product readiness claims follow `docs/WORKSPACE_RELEASE.md`: local DB/auth tests
are documented evidence, not tests performed by this presentation or proof of
production readiness. Production database/auth remain unconfigured; the team
AI runtime is NOT CONNECTED. Reconcile this copy only when those gates change.
