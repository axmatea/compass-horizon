# COMPASS public product

Public pages: index.html, demo.html, plan.html and studio.html.
No account, cloud workspace, login, presentation, or database is supported.
The homepage hero runs the site builder inline (voice or text, brief, build,
page preview on web and phone). /demo is the full-screen builder.
/voice-demo serves that same builder. /plan is the product-plan preview.
/studio holds the studio, confirmed team information and approved statements.
Old Studio subroutes and other retired sections return 410.
/api/config, /api/demo, /api/site/turn, and /api/early-access are the application APIs.
Other API URLs return 404.

Both builders include desktop, phone and combined preview controls. A completed
render enables Copy brief and Download HTML. The download is a self-contained
website preview; it does not publish a site or create application services.
The full builder explicitly saves projects and revision snapshots in local
browser storage. It can reopen them on the same device without a model call.
The next submitted refinement restores a bounded brief if its server session
expired. Saved HTML and old action/history/version state are not sent as a seed.
Cmd/Ctrl+Enter submits the focused composer. Dictation remains editable until
submission; Escape or Stop ends it. Waiting for microphone changes to Listening
only after the native recognition start event. The browser may use a speech
service; COMPASS receives submitted text. Real microphone transcription must
still be checked manually on the live site.

Node 22.12+. npm ci, npm run build, npm start. Open localhost:8770.
npm run dev serves frontend development; npm run preview serves built output.
Both commands include the application APIs and session pages on the same URL,
so the homepage builder, /demo, and /plan work without a second server. Local
Vite runs always use prepared builds and mailto access requests: model and
webhook credentials are ignored and .env files are not loaded. An explicit
DEMO_VIDEO_URL can still preview a supplied https video. Unset plays the
bundled older prepared-example walkthrough, labelled as an earlier recording.
Verify with npm run check, npm test and npm run build.

Vite is the only development dependency. The production image contains dist,
the Node server, and the prepared demo catalog. No database or auth credentials
are read. When COMPASS_DEMO_MODE is unset, demos stay on prepared examples,
including when model keys exist. Only COMPASS_DEMO_MODE=live enables model
calls. Production sets that value, so the public builder calls the model.
With no key or a failed model call, the prepared build still completes. Live
provider order is
Anthropic, General Compute, then Nebius. Early access delivers an
email only when WAITLIST_WEBHOOK_URL is an https URL. Otherwise the form opens
mailto:info@aimedia.global and does not claim the email was stored.
DEMO_VIDEO_URL is optional and read at request time. Unset serves the bundled
walkthrough at /assets/demo/compass-walkthrough.mp4. A valid https value replaces it.

Keep font attribution with retained assets. See DEPLOYMENT.md for the existing
Railway target and release gates, and ../docs/RELEASE.md for media provenance.
Studio testimonials remain hidden until approved quotes, names and public sources
exist in src/site/testimonials.mjs. Earlier product code remains in Git history.
