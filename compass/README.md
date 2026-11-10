# COMPASS homepage

Public pages: index.html and demo.html, in the existing cinematic visual style.
No workspace, login, voice, presentation or database is supported.
/demo is the early-access preview. Other old pages return 410.
/api/config and /api/demo are the only application APIs. Other API URLs return 404.

Node 22.12+. npm ci, npm run build, npm start. Open localhost:8770.
npm run dev serves frontend development; npm run preview serves static output.
Verify with npm run check, npm test and npm run build.

Vite is the only development dependency. The production image contains dist,
the Node server, and the prepared demo catalog. No database or auth credentials
are read. A model key is optional. With no key, or if the model call fails,
/demo still completes from the prepared examples. The waitlist form does not
store email. DEMO_VIDEO_URL is optional and read at request time.

Keep font attribution with retained assets. See DEPLOYMENT.md for the existing
Railway target and release gates. Earlier product code remains in Git history.
