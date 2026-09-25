# COMPASS: unified public demo and final presentation

## Scope

The user's current request authorizes integrating origin/main `005592b` with
`codex/human-workspace`, committing and publishing to the existing Railway site.
It does not approve a paid database, new model calls or fictional AI integration.
This release is a public demo and presentation, not a claim of production SaaS.

The previously rejected beige/cartoon design is retained in Git, not the primary
experience. Main surfaces share near-black, cream, muted gold and local Manrope,
with restrained serif display type. Horizon's deterministic engine is preserved.

## Claims boundary

- Team tasks, source storage, roles, invitations, optimistic concurrency and SSE
  have real PostgreSQL/Better Auth code and local integration tests.
- The public workspace intentionally uses local synthetic data. Clicking Reset
  or reloading resets it. No real login is bypassed.
- Machines and proposals are explicitly scripted; no team AI runtime is wired.
- Horizon is a separate simulated campaign experiment with an accelerated clock.
  Its percentages and $18k are not actual revenue, customer results or accuracy.
- The existing voice-to-site prototype remains on /demo and /voice-demo.
  Existing provider configuration is not evidence of sponsor calls in this run.
- No image/video generation, paid service provisioning or new credential creation.

## Route preservation

Root: populated team cockpit. /presentation: final deck. /horizon: original
2D/3D/Phone. /presentation/legacy: old cinematic deck with scene 12. /demo and
/voice-demo: old voice prototype. /demo/table, /demo/remaster and /acquisition:
compatible older examples. /app remains protected and unavailable without DB/auth.

## Publish gates

Build, backend regressions, workspace tests and browser checks must pass before
merge. Verify latest origin/main to avoid overwriting concurrent work. Preserve
005592b as an ancestor; do not force push. Merge reviewed release via GitHub and
verify Railway deployment revision and live routes. If deployment fails, inspect
build logs and fix; do not declare success from an HTTP 200 on the old revision.

No database migration runs without an explicitly configured database. Existing
schema changes are additive. A private production account still requires the
separate WORKSPACE_RELEASE.md database/auth/security gates. The public-demo
authorization does not waive them.

## Stage preparation

Use the final presentation's speaker notes and src/finale/SPEAKER_SCRIPT.md.
Prefer live interaction with the
workspace and Horizon over old promo footage that depicts a different product.
No new video is implied by this package. Use the legacy deck only as reference.

## Verified locally, September 25

- Production build and TypeScript pass. Horizon 3D remains a lazy-loaded 965 kB
  uncompressed chunk; this is a build warning, not a failure.
- 273 backend tests, 29 workspace tests, 66 REMaster tests and five mission
  reducer tests pass. Some suites overlap; these are not additive counts.
- Mission, all eight presentation scenes and Horizon pass Chromium checks at
  390/768/1440 px: no horizontal overflow or page errors, no public-demo API calls,
  keyboard navigation, speaker notes, source inspection, approval, task movement,
  reset, reduced-motion fallback, graph playback and a real WebGL canvas.
- Private browser QA uses two local synthetic accounts: invitation, shared SSE
  updates, replay deduplication, actual server restart, membership removal and
  logout pass. This is local evidence, not production database verification.
- A clean production-mode process without database credentials serves public
  routes and returns 503 for private workspace API; no silent in-memory fallback.
- Horizon engine days 3/9/11/21 retain temporal ledger boundaries and declare
  `liveProviders: false`.

Run public checks with `QA_ORIGIN=https://mycompass.world npm run qa:mission`,
`qa:finale` and `qa:horizon`. Reports and screenshots go to ignored
`delivery/final/<hostname>/`. Deployment verification is recorded separately
after Railway has served the new revision.
