# Homepage frontend

index.html, demo.html, and plan.html are built. src/site/ is the cinematic homepage.
src/builder/ is the /demo site builder. src/demo/ is the /plan preview and its
prepared examples. Font terms ship in public/licenses/sora-OFL.txt.

No React, workspace, auth, or presentation modules remain. The microphones
use the browser Speech Recognition API. Audio is not uploaded. The builder
posts the transcript to /api/site/turn. The plan preview posts to /api/demo.
The early-access form posts to
/api/early-access. Email is delivered to WAITLIST_WEBHOOK_URL when that https
URL is set. Otherwise the visitor sends it from their email app, and the page
does not claim it was stored. The demo falls back to the prepared examples if
the model call fails. Unknown routes do not fall back to the homepage. Verify
with npm run check, npm test and npm run build.
