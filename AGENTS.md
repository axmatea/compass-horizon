# COMPASS Agent Guide

Read README.md, then compass/README.md. Canonical repo: axmatea/compass-horizon.

The public homepage, the site builder at /demo, the plan preview at /plan,
and the studio page at /studio are maintained. Do not restore office, auth, databases, invite tools,
research, games, or presentations. Browser speech on the demo is in scope.
Boson, Gradium, and other server voice bridges are not.
Pages are compass/index.html, compass/demo.html, compass/plan.html and compass/studio.html.
Vite builds all four. A dependency-free Node server serves dist, /healthz,
/api/config, /api/demo, /api/site/turn, /api/site/session/:id/page, and
/api/early-access. /demo and /voice-demo return 200 and serve the builder.
/plan and the exact /studio route return 200. /studio/legacy and other retired sections return 410. Unknown /api routes
return 404. Never silently serve index.html for unknown app routes. The
builder must keep working when no model key is set: it shows a prepared build.
When COMPASS_DEMO_MODE is unset, demos stay on examples even with configured keys.
Only COMPASS_DEMO_MODE=live enables model calls. Production sets live mode.
Model order in live mode is Anthropic, then General Compute, then Nebius, and only for
providers whose keys are set. ANTHROPIC_MODEL defaults to claude-haiku-5-5.

Root commands forward to compass/. Use product:install, check, test, build,
start and dev. No TypeScript/React checking or database fixture is required.
Keep each actual asset and its license while referenced by a maintained page.

The builder produces a scriptless HTML website preview, not a deployed full-stack
or native mobile application. Explicit Save stores bounded projects and revision
snapshots in this browser on this device; no account, cloud backup or autosave is
implied. Restoring a local project makes no model request. On the user's next
submission, resumeIntent may seed only validated brief fields in a fresh server
session; never import stored HTML, actions, source labels, history or versions.
Dictation is editable and never auto-submits by default. Show Waiting for
microphone until the browser's native onstart event, then Listening. Browsers
may use a speech service; COMPASS receives submitted text. Automated speech
tests do not prove physical microphone capture.

Keep rendering fields (including density and mobile) bounded and compatible with
the saved-project allowlist. The homepage starts with one prompt; do not restore
decorative starter preview cards or mock app modes. A failed/incomplete request
must retain the last complete HTML and the user's retry instruction. A new
interim render must not inherit the previous result's live-model badge. Hide
server-preview links while busy or after a rollback until a complete result
matches again. Keep all page actions anchored to sections that actually exist.

Studio team entries and testimonials render only from confirmed source data.
Testimonials require founder approval, attribution and an https source URL.
Do not fill empty configuration with invented quotes. See docs/RELEASE.md for
the approved film and generated artwork provenance; do not replace the film
with overlapping PR assets without coordination.

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
