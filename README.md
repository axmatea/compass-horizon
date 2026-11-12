# COMPASS

Canonical source: [axmatea/compass-horizon](https://github.com/axmatea/compass-horizon).

This repository contains the public COMPASS homepage, the /demo site builder,
and the /plan product-plan preview. Workspace, login, registration,
presentations and disconnected research are retired. The demo uses browser
speech only. Historical code is recoverable from Git history; no history
rewrite is needed.

## Run

Use Node 22.12 or newer:

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

The build produces the homepage, /demo, and /plan. The Node delivery server uses
built-in modules only: no runtime dependencies, database, or login. The builder
keeps its session in memory. Public demos default to prepared examples even
when model keys exist. Only an explicitly approved COMPASS_DEMO_MODE=live
setting enables provider calls; key names are documented in compass/.env.example.
Anthropic is first when its key is set. /healthz reports the active demoMode.
DEMO_VIDEO_URL is read on each request. When it is unset, the homepage omits
the video block and the secondary hero link is “Request access”. When it is
an https URL, the homepage renders that player and a “Watch the video” link.
POST /api/early-access accepts one email. When WAITLIST_WEBHOOK_URL is an
https URL, the server posts `{email, timestamp}` there. When it is unset, the
form falls back to mailto:info@aimedia.global and the page does not claim the
email was stored. Other retired page URLs return 410. Unknown API URLs return
404. Do not reintroduce office, auth, or a server voice bridge as incidental cleanup.

## Deploy and recover

Production is the existing COMPASS Railway project (compass-web service),
serving mycompass.world. Source: this repository main, root directory /compass.
Use compass/Dockerfile; Railway supplies PORT; healthcheck is /healthz.
The response records mode=public-demo, demoMode and the deployed Git revision.
/demo returns 200. A missing DEMO_VIDEO_URL omits the video block.

GitHub stores the source and lockfile needed to rebuild on another computer.
Verify a fresh clone, npm run product:install, npm test and npm run build before
relying on that recovery path. Website recovery does not prove that unrelated
local data, credentials or personal files are backed up.

Keep the homepage's bundled font licenses. Do not publish secrets, .env files,
local recovery exports, transcripts or personal files. Provider billing and
account access are managed separately; do not spend, change DNS, create resources
or erase data without explicit approval.
