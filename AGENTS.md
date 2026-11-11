# COMPASS Agent Guide

Read README.md, then compass/README.md. Canonical repo: axmatea/compass-horizon.

The public homepage, the site builder at /demo, and the secondary plan preview
at /plan are maintained. Do not restore office, auth, databases, invite tools,
research, games, or presentations. Browser speech on the demo is in scope.
Boson, Gradium, and other server voice bridges are not.
Pages are compass/index.html, compass/demo.html, and compass/plan.html.
Vite builds all three. A dependency-free Node server serves dist, /healthz,
/api/config, /api/demo, /api/site/turn, /api/site/session/:id/page, and
/api/early-access. /demo and /voice-demo return 200 and serve the builder.
/plan returns 200. Other retired sections return 410. Unknown /api routes
return 404. Never silently serve index.html for unknown app routes. The
builder must keep working when no model key is set: it shows a prepared build.
Public demos default to COMPASS_DEMO_MODE=examples even with configured keys.
Only an explicitly approved COMPASS_DEMO_MODE=live setting enables model calls.
Model order in live mode is Anthropic, then General Compute, then Nebius, and only for
providers whose keys are set. ANTHROPIC_MODEL defaults to claude-haiku-5-5.

Root commands forward to compass/. Use product:install, check, test, build,
start and dev. No TypeScript/React checking or database fixture is required.
Keep each actual asset and its license only while referenced by the homepage.

Preserve concurrent user changes. Delete files only after checking imports,
build entries, scripts, styles, routes and asset references. Do not rewrite Git
history, force-push, drop production data, or create archive directories.
User-requested cleanup can retire source code, not erase an existing database.
Never read/print secrets or load old .env files to build this static homepage.
Do not fake live-agent status or working-account claims. Outbound calls are
limited to the optional server-side model request when a key is configured,
and the optional WAITLIST_WEBHOOK_URL post of an early-access email. If the
model call is missing or fails, serve a prepared example. If the webhook is
unset or fails, do not claim the email was stored. Never claim metrics,
customers, prices or team members the founder has not confirmed.

Production belongs to existing Railway compass-web, mycompass.world, main with
root directory /compass and /healthz healthcheck. /healthz reports
mode=public-demo. Deploy only with current user approval and verify exact
public revision plus assets in the browser. Optional runtime settings are
DEMO_VIDEO_URL, WAITLIST_WEBHOOK_URL and the model key names in
compass/.env.example, including ANTHROPIC_API_KEY and ANTHROPIC_MODEL.
Website deploy success is not a Mac factory-reset authorization: local recovery
requires its own verified backup and restore evidence. Never initiate reset.
