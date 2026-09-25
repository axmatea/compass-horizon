# Acquisition frontend

React 19 workspace, intentionally separate from the legacy frontend. The root
entry is `acquisition.html` -> `src/acquisition/main.tsx`.

## Boundaries

- `/acquisition` uses only synthetic AI Media Global scenario fixtures. No research,
  extraction, analytics, messaging, ad buying, or voice call is made by the demo.
- The public status check reads `/api/acquisition/status`. The early-access form
  is explicitly real and requires a successful durable-save response before
  showing confirmation. The planned $299/month price is not a checkout.
- `/acquisition/app` and `/login` use invited-session auth and canonical LIVE state. They
  never fall back to fixtures when auth, database, or API access is unavailable.
- The seven-step tour starts at `/acquisition?tour=1` or legacy hashes, uses the same screens,
  and labels synthetic data and accelerated time. Starting the tour resets only
  local demo state. Server route redirects belong to the integrator.
- Extraction is a proposal. Each non-null field requires explicit review and
  selection before a `manual.review` event is sent. The server owns qualification
  and stale-field reconciliation. No changed fields is not shown as an update.
- Voice is not connected in this UI. No microphone permission is requested.

## Owned files

- `acquisition.html`
- `public/manifest.webmanifest`
- `public/acquisition/favicon.svg`
- `public/acquisition/fonts/manrope-variable.ttf`, `OFL.txt`, `README.md`
- `src/acquisition/App.tsx`, `main.tsx`, `styles.css`
- `src/acquisition/types.ts`, `api.ts`, `demo.ts`, `datetime.ts`
- `src/acquisition/ui.tsx`, `forms.tsx`, `screens.tsx`, `ProposalReview.tsx`
- `src/acquisition/demo.test.mjs`, `README.md`

No runtime dependency, package manifest, server, routing, or deployment change
is required by this frontend. Manrope and its SIL OFL license are served locally.

## Verification

```sh
npm run typecheck
npm run build
node --experimental-strip-types --test src/acquisition/demo.test.mjs
node scripts/acquisition-browser-qa.mjs
```

The browser QA script is integrator-owned. It checks four tabs at 390, 768, and
1440 pixels, seven tour steps per viewport, reduced motion, no horizontal
overflow, no page errors, no third-party browser requests, legacy tour redirect,
keyboard focus, and unauthenticated fixture isolation.

Model tests cover unknown values, late qualification, duplicate replay, rule
version changes, retained evidence, stale answers, ID conflicts, manual leads,
and sub-second occurrence-time preservation. Provider execution, production
credentials, billing, deployment, and live voice are not verified by these UI
tests and must not be represented as completed operations.
