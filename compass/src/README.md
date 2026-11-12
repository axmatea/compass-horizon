# Homepage frontend

index.html, demo.html, and plan.html are built. src/site/ is the homepage.
src/builder/ is the /demo site builder. src/demo/ is the /plan preview and its
prepared examples. Font terms ship in public/licenses/ (Inter for the homepage,
Sora for /plan).

The homepage hero is the same builder as /demo: landing.js posts to
/api/site/turn and reads the stream with the rules in studio.mjs, then shows
the brief, the build log and the page in a web frame and a phone frame.
home.css styles it. modes.mjs holds the four picker modes and frames.mjs
renders their example layouts. index.html carries that output for the default
mode and the product cards, and test/home.test.mjs fails when they drift.
A reply is labelled "Live model" only when the model wrote the copy.

Founder slots stay hidden until confirmed content exists. Search index.html
for "FOUNDER SLOT": video (bundled walkthrough, or DEMO_VIDEO_URL when set), traction, team (team.mjs) and
pricing.

No React, workspace, auth, or presentation modules remain. The microphones
use the browser Speech Recognition API. Audio is not uploaded. The builder
posts the transcript to /api/site/turn. The plan preview posts to /api/demo.
The early-access form posts to
/api/early-access. Email is delivered to WAITLIST_WEBHOOK_URL when that https
URL is set. Otherwise the visitor sends it from their email app, and the page
does not claim it was stored. In live mode a model writes the page, and the
demo falls back to a prepared build if that call fails. Unknown routes do not
fall back to the homepage. Verify
with npm run check, npm test and npm run build.
