# Homepage frontend

Only index.html is built. src/site/ contains the existing cinematic homepage
CSS, browser-only menu/motion code and Sora font. Font terms ship in
public/licenses/sora-OFL.txt. Navigation stays on the same page.

No React, workspace, auth, API, demo or presentation modules remain. No forms,
provider calls or stored browser state are used. Unknown routes do not fall
back to the homepage. Verify with npm run check, npm test and npm run build.
