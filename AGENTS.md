# COMPASS Agent Guide

Read README.md, then compass/README.md. Canonical repo: axmatea/compass-horizon.

Only the public homepage is maintained. Do not restore office, auth, React,
databases, invite tools, research, voice, games, presentations or demos.
The single source page is compass/index.html with src/site assets. Vite builds
it; a dependency-free Node server serves dist and /healthz. All retired sections
return 410, APIs 404. Never silently serve index.html for unknown app routes.

Root commands forward to compass/. Use product:install, check, test, build,
start and dev. No TypeScript/React checking or database fixture is required.
Keep each actual asset and its license only while referenced by the homepage.

Preserve concurrent user changes. Delete files only after checking imports,
build entries, scripts, styles, routes and asset references. Do not rewrite Git
history, force-push, drop production data, or create archive directories.
User-requested cleanup can retire source code, not erase an existing database.
Never read/print secrets or load old .env files to build this static homepage.
No external calls, fake live-agent status or working-account claims in the page.

Production belongs to existing Railway compass-web, mycompass.world, main with
root directory /compass and /healthz healthcheck. Deploy only with current user
approval and verify exact public revision plus assets in the browser.
Website deploy success is not a Mac factory-reset authorization: local recovery
requires its own verified backup and restore evidence. Never initiate reset.
