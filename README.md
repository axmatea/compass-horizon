# COMPASS

Canonical source: [axmatea/compass-horizon](https://github.com/axmatea/compass-horizon).

This repository contains only the public COMPASS homepage. Workspace, login,
registration, APIs, demos, presentations and disconnected research are retired.
Historical code is recoverable from Git history; no history rewrite is needed.

## Run

Use Node 22.12 or newer:

```sh
npm run product:install
npm run build
npm start
```

Open http://localhost:8770. npm run dev starts Vite for frontend development.
The root package only forwards commands to compass/; install that package
rather than expecting root npm ci to install the application.

## Verify

```sh
npm run check
npm test
npm run build
npm audit --prefix compass
```

The build produces one HTML page. The Node delivery server uses built-in modules
only: no runtime dependencies, database, login, sessions, workers, AI calls or
outbound application requests. Previously supported page URLs return 410; API
URLs return 404. Do not reintroduce those systems as incidental cleanup.

## Deploy and recover

Production is the existing Railway compass-nayl-vincent / compass-web service,
serving mycompass.world. Source: this repository main, root directory /compass.
Use compass/Dockerfile; Railway supplies PORT; healthcheck is /healthz.
The response records mode=homepage-only and the deployed Git revision.

GitHub stores the source and lockfile needed to rebuild on another computer.
Verify a fresh clone, npm run product:install, npm test and npm run build before
relying on that recovery path. Website recovery does not prove that unrelated
local data, credentials or personal files are backed up.

Keep the homepage's bundled font licenses. Do not publish secrets, .env files,
local recovery exports, transcripts or personal files. Provider billing and
account access are managed separately; do not spend, change DNS, create resources
or erase data without explicit approval.
