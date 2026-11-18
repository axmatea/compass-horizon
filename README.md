# COMPASS

Canonical source: [axmatea/compass-horizon](https://github.com/axmatea/compass-horizon).

Current production account, storage and provider activation status:
[Production services](docs/PRODUCTION_SERVICES.md).

COMPASS opens with a curated template marketplace for websites and mobile apps.
Browse six original templates and try their live previews. Mobile families include
responsive web and editable iOS/Android source editions. Purchases remain off;
prices and commercial terms are not approved. See
[template marketplace](docs/TEMPLATE_MARKETPLACE.md) for delivery and verification boundaries.

The existing Builder starts from an app reference or an original idea, then builds
and refines websites and functional data applications in the signed-in workspace.
The predominantly white public pages are `/`, `/demo`,
`/plan`, `/studio` and `/create`; `/voice-demo` aliases `/demo`. The Builder
preserves one prompt through `/create` and optional onboarding. **Create a data
app** opens the production account workspace through `/create?app=1` on the same
origin. The **Platform Tour** opens an in-place guide without leaving a project.

In Builder, **Start from an app** accepts an app name or public link, then lets the user name
their own project, choose Website or Data app, and edit its sections or fields.
The reviewed plan follows the same account/onboarding and builder handoff as an
idea. Reference planning stays local: COMPASS does not fetch the supplied page or
recover its source. Only the public hostname or app name enters the build brief;
URL paths, query parameters and fragments are omitted. Selected fields and
sections are enforced for prepared and model builds. **Start from an idea** keeps
editable dictation and offers Website or Data app explicitly. See
[reference starts](docs/REFERENCE_START.md) for behavior and boundaries.

The tour has 11 chapters, captions, playback controls and real product screens.
It currently uses the interactive walkthrough fallback because native recording
was unavailable; no instructional video is shipped or represented as recorded.
See [tutorial provenance](compass/public/assets/tutorial/README.md).

The public website builder includes desktop/tablet/mobile previews, adjustable
conversation panels, visual controls, safe HTML/CSS editing, conflict-aware code
refinement, undo/restore, HTML export and explicit device-local project saves. Loading
a saved project makes no model request. The next refinement resumes only its
validated brief. Failed requests keep the last complete page and retry text.
Property cards and booking forms in website previews remain illustrative.

The account workspace additionally supports real owner-scoped tracker,
CRM, inventory and booking-record applications, with records, design revisions,
reopen, source ZIP and private data export. A validated manifest drives trusted
reviewed code; arbitrary generated source never executes on the main server.
It also includes version-checked manifest editing, private PNG/JPEG images,
actual file hashes and image-complete source ZIPs. As of 16 November 2026,
production accounts use Google and verified Resend email delivery, with email
verification and password recovery tested. Explicit account saves use a private
persistent volume with verified encrypted S3 backup and restore. These cloud
saves are separate from the public builder's device-local saves; existing local
projects are never silently imported. The isolated staging preview remains
temporary unless durable storage is separately configured. Payments remain off.
See [production services](docs/PRODUCTION_SERVICES.md) for activation status and
[delivery boundaries](docs/DELIVERY_STATUS.md) for supported features.

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
loaded only when staging or production accounts are explicitly configured. The
public builder keeps its session in memory. When COMPASS_DEMO_MODE is unset, demos stay on
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
404. Do not reintroduce the retired office or server voice bridge. Private account
routes require an explicitly configured account service and verified identity.

## Deploy and recover

Production is the existing COMPASS Railway project (compass-web service),
serving mycompass.world. Source: this repository main, root directory /compass.
The tracked Railway configuration uses the Dockerfile builder with root /compass
and compass/Dockerfile. Development dependencies are pruned before the runtime image is copied.
Railway supplies PORT; healthcheck is /healthz.
The response records the account mode, demoMode and the deployed Git revision;
an unconfigured public server reports mode=public-demo.
The existing production live setting is preserved. A missing DEMO_VIDEO_URL
plays the founder-approved promo, labelled as an earlier product vision.
See [release notes and media provenance](docs/RELEASE.md) and
[deployment checks](compass/DEPLOYMENT.md).

The [media audit](docs/COMPASS_2_MEDIA.md) distinguishes the approved founder promo
from the two walkthroughs. The [account foundation](docs/ACCOUNT_FOUNDATION.md) documents the Better Auth
identity implementation, configured sign-in methods, owner-scoped projects and
measured usage. Production accounts and encrypted cloud recovery are enabled;
payments remain off. The earlier Clerk proposal in ACCESS_PREVIEW.md is superseded.

GitHub stores the source and lockfile needed to rebuild on another computer.
Verify a fresh clone, npm run product:install, npm test and npm run build before
relying on that recovery path. Website recovery does not prove that unrelated
local data, credentials or personal files are backed up.

Keep the homepage's bundled font licenses. Do not publish secrets, .env files,
local recovery exports, transcripts or personal files. Provider billing and
account access are managed separately; do not spend, change DNS, create resources
or erase data without explicit approval.
