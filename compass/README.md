# COMPASS homepage

Public pages: index.html, demo.html, and plan.html.
No workspace, login, presentation, or database is supported.
The homepage hero runs the site builder inline (voice or text, brief, build,
page preview on web and phone). /demo is the full-screen builder.
/voice-demo serves that same builder. /plan is the product-plan preview.
Other old pages return 410.
/api/config, /api/demo, /api/site/turn, and /api/early-access are the application APIs.
Other API URLs return 404.

Both builders include desktop, phone and combined preview controls. A completed
render enables Copy brief and Download HTML. The download is a self-contained
preview file; it does not publish a site. Cmd/Ctrl+Enter submits the focused
composer, and Escape stops browser dictation and speech.

Node 22.12+. npm ci, npm run build, npm start. Open localhost:8770.
npm run dev serves frontend development; npm run preview serves built output.
Both commands include the application APIs and session pages on the same URL,
so the homepage builder, /demo, and /plan work without a second server. Local
Vite runs always use prepared builds and mailto access requests: model and
webhook credentials are ignored and .env files are not loaded. An explicit
DEMO_VIDEO_URL shell setting can still preview a supplied video; unset keeps
the Request access link and hides the video.
Verify with npm run check, npm test and npm run build.

Vite is the only development dependency. The production image contains dist,
the Node server, and the prepared demo catalog. No database or auth credentials
are read. Public demos default to prepared examples, including when model keys
exist in the service environment. Only an explicitly approved
COMPASS_DEMO_MODE=live setting enables model calls. With no key or a failed
model call, the prepared build still completes. Live provider order is
Anthropic, General Compute, then Nebius. Early access delivers an
email only when WAITLIST_WEBHOOK_URL is an https URL. Otherwise the form opens
mailto:info@aimedia.global and does not claim the email was stored.
DEMO_VIDEO_URL is optional, read at request time, and omitted from the page
when unset.

Keep font attribution with retained assets. See DEPLOYMENT.md for the existing
Railway target and release gates. Earlier product code remains in Git history.
