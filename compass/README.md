# COMPASS homepage

Public pages: index.html, demo.html, and plan.html.
No workspace, login, presentation, or database is supported.
The homepage hero runs the site builder inline (voice or text, brief, build,
page preview on web and phone). /demo is the full-screen builder.
/voice-demo serves that same builder. /plan is the product-plan preview.
Other old pages return 410.
/api/config, /api/demo, /api/site/turn, and /api/early-access are the application APIs.
Other API URLs return 404.

Node 22.12+. npm ci, npm run build, npm start. Open localhost:8770.
npm run dev serves frontend development; npm run preview serves static output.
Verify with npm run check, npm test and npm run build.

Vite is the only development dependency. The production image contains dist,
the Node server, and the prepared demo catalog. No database or auth credentials
are read. A model key is optional. With no key, or if the model call fails,
/demo still completes from the prepared build when no key is set or the model
call fails. Anthropic is first when ANTHROPIC_API_KEY is set; otherwise General
Compute, then Nebius. Early access delivers an
email only when WAITLIST_WEBHOOK_URL is an https URL. Otherwise the form opens
mailto:info@aimedia.global and does not claim the email was stored.
DEMO_VIDEO_URL is optional, read at request time, and omitted from the page
when unset.

Keep font attribution with retained assets. See DEPLOYMENT.md for the existing
Railway target and release gates. Earlier product code remains in Git history.
