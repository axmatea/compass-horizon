# COMPASS homepage

One public page, index.html, with the existing cinematic visual style.
No workspace, login, APIs, demo, presentation or live AI runtime is supported.
Old pages return 410 and are removed from source/build; APIs return 404.

Node 22.12+. npm ci, npm run build, npm start. Open localhost:8770.
npm run dev serves frontend development; npm run preview serves static output.
Verify with npm run check, npm test and npm run build.

Vite is the only development dependency. The production image contains just
dist plus the built-in Node static server. No DB/auth/provider credentials
are needed or read. No background workers, outgoing calls or forms run here.

Keep font attribution with retained assets. See DEPLOYMENT.md for the existing
Railway target and release gates. Earlier product code remains in Git history.
