# Homepage frontend

index.html, demo.html, plan.html and studio.html are built. src/site/ is the homepage and studio page.
src/builder/ is the /demo site builder. src/demo/ is the /plan preview and its
prepared examples. Shared neutral design tokens and Inter are in
src/site/tokens.css; retained Inter and Sora terms ship in public/licenses/.

The homepage hero shares the /demo builder API: landing.js posts to
/api/site/turn and reads the stream with the rules in studio.mjs, then shows
the brief, the build log and the page in a web frame and a phone frame.
home.css styles it. Shared preview-tools.mjs provides device views, brief copying
and HTML download; the full builder adds its own project and revision controls.
Homepage starter previews open editable prompts in /demo without generating
anything until the user submits.
A reply is labelled "Live model" only when the server reports a model-backed
turn without fallback copy. Prepared and saved local previews remain distinct.

studio-page.js renders confirmed people from team.mjs and approved sourced
statements from testimonials.mjs. Both collections are currently empty;
testimonial content stays hidden. Film and generated art provenance are in
docs/RELEASE.md at the repository root.

No React, workspace, auth, or presentation modules remain. The microphones
use the browser Speech Recognition API, which may use the browser's speech
service. Interim/final text is editable; pause and manual Stop do not submit.
Only native onstart marks the UI Listening. The builder posts submitted text to
/api/site/turn. The plan preview posts to /api/demo.
The early-access form posts to
/api/early-access. Email is delivered to WAITLIST_WEBHOOK_URL when that https
URL is set. Otherwise the visitor sends it from their email app, and the page
does not claim it was stored. In live mode a model writes the page, and the
demo falls back to a prepared build if that call fails. Unknown routes do not
fall back to the homepage. Verify
with npm run check, npm test and npm run build.

src/builder/project-store.mjs stores bounded explicit saves in localStorage.
Restoration displays the validated local snapshot without fetching; the next
user submission sends only a bounded resumeIntent brief for a fresh session.
No authentication, cloud backup or project publishing is implied.
