# Landing and demo rebuild

Branch: `codex/compass-landing-demo-rebuild`. This branch has not been deployed.

## Changes

- Replaces concept copy with early-access intent-to-software positioning,
  demo/video CTAs, three examples, how it works, company links and a sourced
  comparison. Keeps unconfirmed team/client proof as source TODOs.
- Adds `/demo`: intent, three clarifying questions, prepared screens/data/
  integration plan, interactive desktop and phone previews. Three examples:
  barbershop bookings, client approvals and project tasks.
- Labels every flow as prebuilt. Custom ideas select an appropriate prepared
  flow or ask the visitor to choose one; they never claim custom AI output.
  Intent and answers stay in the tab. Actions do not contact external services
  or persist data. Limits: 500-character intent, 80-character tasks, 12 tasks.
- Adds optional runtime video/contact configuration. With no founder video,
  Request access remains visible. Without an approved inbox, access requests
  open soon is shown. A configured email form opens a mail composer; no false
  signup/save/sent result is shown. No AI keys or settings are changed.
- Adds canonical/OG/Twitter metadata and a 1200x630 share image, removes hero
  autoplay/download, preserves font licence and unrelated retired routes.
- Adds HTTP/config/example tests plus isolated CI mobile/desktop flows,
  screenshots, and three-run mobile Lighthouse checks with 90+ performance/
  accessibility gates. Browser tests only target the runner's loopback build.

## Verified locally

Node 22.23.4: syntax checks, production build, 11 Node test cases and npm audit
pass (zero vulnerabilities). Playwright discovery lists 14 cases. Safari
confirms landing -> demo -> questions -> plan/preview, synchronized booking
selection/confirmation, preference editing, portal approval, task add/complete
and literal rendering of script-like input. No provider calls were made.

The initial restricted build runtime could not load Rollup's native module;
verification used a checksum-verified official Node 22 runtime under /tmp.
No system runtime or security settings were changed.

## Concurrent changes reconciled

During development, an external Cursor PR #11 merged into main at `d303bc2`
and auto-deployed to Railway. A separate preview service was also created by
that external workflow. This run made neither change and did not roll either
back or repoint the preview service. The branch incorporates that main commit
and retains its provider/catalog source for review, while keeping those
modules and API endpoints disconnected from the prebuilt-only public runtime.
Main's older model-endpoint tests are updated to verify that boundary; pure
catalog and mocked adapter coverage is retained. Intent stays in the browser.

## Review evidence and release

CI stores full desktop/mobile screenshots and Lighthouse JSON/HTML plus
scores in the `compass-browser-qa` artifact. Record actual CI scores in the PR
after completion; local Safari inspection is not a Lighthouse measurement.

No Railway environment/service/settings, DNS, billing, secret, production
branch or production deployment was changed by this rebuild. No hosted
preview was created or modified by this rebuild.
The local review build is http://localhost:8770 and /demo while its server
is running. A staging configuration and its actual preview URL require the
founder's approval before any later production promotion.

Remaining founder inputs: approved demo video/poster, public access inbox or
waitlist sink, exact team/client proof/bios, and approved AI provider/model
and budget before enabling live AI. A phone preview is not a native export.
