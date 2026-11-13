# COMPASS

Canonical source: [axmatea/compass-horizon](https://github.com/axmatea/compass-horizon).

COMPASS builds and refines websites, with functional data applications in an
explicit account preview. The predominantly white public pages are `/`, `/demo`,
`/plan`, `/studio` and `/create`; `/voice-demo` aliases `/demo`. The homepage
preserves one prompt through `/create` and optional onboarding. Its separate
**Try app preview** link opens the existing isolated account preview without
transferring the original prompt to another origin.

The public website builder includes desktop/tablet/mobile previews, adjustable
conversation panels, visual controls, safe HTML/CSS editing, conflict-aware code
refinement, undo/restore, HTML export and explicit device-local project saves. Loading
a saved project makes no model request. The next refinement resumes only its
validated brief. Failed requests keep the last complete page and retry text.
Property cards and booking forms in website previews remain illustrative.

The configured preview workspace additionally supports real owner-scoped tracker,
CRM, inventory and booking-record applications, with records, design revisions,
reopen, source ZIP and private data export. A validated manifest drives trusted
reviewed code; arbitrary generated source never executes on the main server.
It also includes version-checked manifest editing, private PNG/JPEG images,
actual file hashes and image-complete source ZIPs. Its current Railway filesystem
is temporary, not durable cloud storage. Production
accounts and billing remain disabled. See [delivery boundaries](docs/DELIVERY_STATUS.md)
for verified features and exact external activation dependencies.

Studio now demonstrates one real project through six interactive moments, then
opens its completed revision history in Builder on the same device. It uses the
same generation endpoint and never starts a model call merely from scrolling.
See [the immersive release](docs/IMMERSIVE_STUDIO.md).

Dictation appears in an editable prompt. Pause or stop, edit, then submit.
The browser handles speech recognition and may use its speech service;
COMPASS receives the submitted text. Automated speech tests use mocks;
physical microphone capture and transcription remain a live manual check.

## Run

Use Node 22.16 or newer:

```sh
npm run product:install
npm run build
npm start
```

Open http://localhost:8770. npm start serves the built pages and the demo API.
For local development, run `npm run dev` and open the URL Vite prints.
After building, `npm run preview` runs the built pages locally. Both Vite
commands include the demo API, streamed builder updates and session previews;
no second server is needed. They use prepared builds and mailto access requests,
ignore provider and webhook credentials, and do not load `.env` files.
The root package only forwards commands to compass/; install that package
rather than expecting root npm ci to install the application.

## Verify

```sh
npm run check
npm test
npm run build
npm audit --prefix compass
```

The build produces five pages, including the new /create onboarding flow.
The default public server opens no database or account sessions. Better Auth is
loaded only by the explicitly configured isolated staging feature. The builder
keeps its session in memory. When COMPASS_DEMO_MODE is unset, demos stay on
prepared examples even if model keys exist. Only COMPASS_DEMO_MODE=live
enables provider calls; key names are documented in compass/.env.example.
Production sets COMPASS_DEMO_MODE=live, so the public builder calls the model
and uses a prepared build only if that call fails.
Anthropic is first when its key is set. /healthz reports the active demoMode.
DEMO_VIDEO_URL is read on each request. When it is unset, the homepage plays
the founder-approved product film and links to “Watch the film”. When it
is an https URL, that recording replaces the bundled file. An http URL is ignored.
POST /api/early-access accepts one email. When WAITLIST_WEBHOOK_URL is an
https URL, the server posts `{email, timestamp}` there. When it is unset, the
form falls back to mailto:info@aimedia.global and the page does not claim the
email was stored. Other retired page URLs return 410. Unknown API URLs return
404. Do not reintroduce the retired office or server voice bridge. Account routes are
limited to the isolated staging implementation described below.

## Deploy and recover

Production is the existing COMPASS Railway project (compass-web service),
serving mycompass.world. Source: this repository main, root directory /compass.
The existing Railway service uses its configured Railpack build with root /compass.
compass/Dockerfile is also maintained; this release does not change the builder.
Railway supplies PORT; healthcheck is /healthz.
The response records mode=public-demo, demoMode and the deployed Git revision.
The existing production live setting is preserved. A missing DEMO_VIDEO_URL
plays the founder-approved promo, labelled as an earlier product vision.
See [release notes and media provenance](docs/RELEASE.md) and
[deployment checks](compass/DEPLOYMENT.md).

The [media audit](docs/COMPASS_2_MEDIA.md) distinguishes the approved founder promo
from the two walkthroughs. The [account foundation](docs/ACCOUNT_FOUNDATION.md) documents the Better Auth
staging implementation, configured sign-in methods, owner-scoped projects and
measured usage. Accounts remain off on production; the earlier Clerk proposal
in ACCESS_PREVIEW.md is superseded.

GitHub stores the source and lockfile needed to rebuild on another computer.
Verify a fresh clone, npm run product:install, npm test and npm run build before
relying on that recovery path. Website recovery does not prove that unrelated
local data, credentials or personal files are backed up.

Keep the homepage's bundled font licenses. Do not publish secrets, .env files,
local recovery exports, transcripts or personal files. Provider billing and
account access are managed separately; do not spend, change DNS, create resources
or erase data without explicit approval.
