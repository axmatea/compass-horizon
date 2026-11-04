# Core frontend

Only three HTML inputs ship: `index.html` (existing landing design and its used
media), `app.html` (real private workspace), and `login.html` (minimal auth).
`routes.ts` maps `/`, `/app`, `/office`, and `/login` in Vite dev/preview without
SPA fallback for unknown routes. Production routing belongs to the server.

`entry.tsx` loads only `workspace/App`. Workspace CRUD, source import, invitations,
membership acceptance, SSE, and version conflicts retain their real API paths.
No fictional data or browser-only mutation path is available. Missing storage
or identity blocks the office rather than pretending to save.

`auth/` uses the existing Better Auth cookie/session endpoints, the new core
readiness endpoint, and the invitation-registration compatibility alias. Only
the bounded redirect helper lives in `auth/login-return.ts`.
The Manrope font, its OFL notice, and workspace favicon keep their existing
neutral `/brand` asset URLs. The MIT facing-helper notice is retained for the real team table.

Presentation, voice, security game, Horizon, studio, mission, acquisition product,
and REMaster entries and their exclusive source/assets have been retired.
The landing's labeled concept film and cinematic styling remain without
provider calls. The embedded builder/pricing and scripted overture are removed.
Its product navigation leads only to `/app` or `/login`.

Validate with `npm run typecheck`, `npm run build`, and
`node --experimental-strip-types --test src/core.test.mjs src/auth/*.test.mjs src/workspace/*.test.mjs`.
