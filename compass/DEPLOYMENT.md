# Homepage deployment

Canonical repo: axmatea/compass-horizon. Existing Railway service:
the COMPASS Railway project (compass-web service), serving mycompass.world.
Verified source binding: main, root directory /compass, healthcheck /healthz.
Use the existing Dockerfile. No database or auth setup. Optional environment
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

Run check, tests, build and audit before merge. After deployment, require the
expected Git revision, mode=public-demo, and demoMode=live in /healthz, successful homepage
and /demo assets, /demo returning 200, other retired office/login URLs
returning 410, and unknown APIs returning 404.
Inspect the published page in-browser. Never claim a merge is itself a deploy.

Keep current domains, resource limits, variable values and data unchanged.
Old runtime variables may be unused but are not credentials to disclose or
rotate as part of source cleanup. Do not pay bills, upgrade plans or grant
broader access automatically. Rollback redeploys an existing image, not a DB reset.
