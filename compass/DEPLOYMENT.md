# COMPASS deployment

Canonical repo: axmatea/compass-horizon. Existing Railway service:
the COMPASS Railway project (compass-web service), serving mycompass.world.
Verified source binding: main, root directory /compass, healthcheck /healthz.
Use the existing Dockerfile. Production accounts remain disabled. Optional environment
names, values never committed: COMPASS_DEMO_MODE, DEMO_VIDEO_URL, WAITLIST_WEBHOOK_URL, LLM_PROVIDER,
GENERAL_COMPUTE_API_KEY, GENERALCOMPUTE_API_KEY, GENERAL_COMPUTE_MODEL,
GENERALCOMPUTE_MODEL, GENERAL_COMPUTE_BASE_URL, GENERALCOMPUTE_BASE_URL,
GENERALCOMPUTE_TIMEOUT_MS, NEBIUS_API_KEY, NEBIUS_BASE_URL, NEBIUS_MODEL,
NEBIUS_THINKING, NEBIUS_TIMEOUT_MS, ANTHROPIC_API_KEY, ANTHROPIC_MODEL,
ANTHROPIC_BASE_URL, ANTHROPIC_TIMEOUT_MS, DEMO_RATE_LIMIT, DEMO_RATE_WINDOW_MS.
The public server defaults to examples mode when COMPASS_DEMO_MODE is unset,
even if keys are configured. Production sets COMPASS_DEMO_MODE=live. In live
mode, when ANTHROPIC_API_KEY is set it is tried first. The default model is
claude-haiku-5-5. The same 8 second cap applies, then General Compute, then
Nebius. A missing key or a failed call keeps the prepared build. /plan is the
secondary product-plan preview.

Run check, tests, build and audit before merge. Build all five HTML entries,
including studio.html and create.html in the Docker context. Automated HTTP tests cover Vite
development/preview, the Node delivery server, resumeIntent validation and
examples-mode generation without external calls.

After deployment, require the expected Git revision, mode=public-demo and the
preserved production demoMode=live in /healthz. Verify `/`, `/demo`, `/plan` and
`/studio`, their scripts/styles and film/poster/captions. `/studio/legacy`,
office and login stay 410; unknown APIs stay 404. In-browser smoke tests cover
describe/refine, device views, export, explicit device saving, reopen and a
subsequent refinement. Loading a saved project must make no model request.
Check mobile layout, console/network failures and video controls. The approved
promo is an earlier product vision, not a recording of this release. Verify its
H.264/AAC playback, seven caption cues and no autoplay; see the media audit.

Physical microphone capture/transcription is a founder-run live follow-up:
grant access in a supported browser, verify Waiting → Listening, dictate,
pause/stop, edit and explicitly submit. Also check denied permission and typing
fallback. Mocked recognition tests alone do not complete this check.
Never claim a merge is itself a deploy. Record the resulting revision and
deployment URL after verification; do not invent release evidence in advance.

Keep current domains, resource limits, variable values and data unchanged.
Old runtime variables may be unused but are not credentials to disclose or
rotate as part of source cleanup. Do not pay bills, upgrade plans or grant
broader access automatically. Rollback redeploys an existing image, not a DB reset.
