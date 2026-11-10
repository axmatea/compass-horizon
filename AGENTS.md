# COMPASS Agent Guide

Read README.md, then compass/README.md. Canonical repo: axmatea/compass-horizon.

The public homepage and the interactive /demo are maintained. Do not restore
office, auth, databases, invite tools, research, voice, games or presentations.
Pages are compass/index.html and compass/demo.html, with src/site and src/demo
assets. Vite builds both. A dependency-free Node server serves dist, /healthz,
/api/config and /api/demo. /demo returns 200. Other retired sections return
410. Unknown /api routes return 404. Never silently serve index.html for
unknown app routes. The demo must keep working when no model key is set.

Root commands forward to compass/. Use product:install, check, test, build,
start and dev. No TypeScript/React checking or database fixture is required.
Keep each actual asset and its license only while referenced by the homepage.

Preserve concurrent user changes. Delete files only after checking imports,
build entries, scripts, styles, routes and asset references. Do not rewrite Git
history, force-push, drop production data, or create archive directories.
User-requested cleanup can retire source code, not erase an existing database.
Never read/print secrets or load old .env files to build this static homepage.
Do not fake live-agent status or working-account claims. The only outbound
call is the optional server-side model request when a key is configured.
If that call is missing or fails, serve a prepared example. Never claim
metrics, customers, prices or team members the founder has not confirmed.

Production belongs to existing Railway compass-web, mycompass.world, main with
root directory /compass and /healthz healthcheck. /healthz reports
mode=public-demo. Deploy only with current user approval and verify exact
public revision plus assets in the browser. Optional runtime settings are
DEMO_VIDEO_URL and the model key names in compass/.env.example.
Website deploy success is not a Mac factory-reset authorization: local recovery
requires its own verified backup and restore evidence. Never initiate reset.
