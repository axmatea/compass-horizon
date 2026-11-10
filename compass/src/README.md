# Homepage frontend

index.html and demo.html are built. src/site/ is the cinematic homepage.
src/demo/ is the early-access preview and the prepared examples. Font terms
ship in public/licenses/sora-OFL.txt.

No React, workspace, auth, or presentation modules remain. The demo microphone
uses the browser Speech Recognition API. Audio is not uploaded. Only the final
transcript is posted to /api/demo. The waitlist form does not store email. The
demo falls back to the prepared examples if that call fails. Unknown routes do
not fall back to the homepage. Verify with npm run check, npm test and npm run build.
