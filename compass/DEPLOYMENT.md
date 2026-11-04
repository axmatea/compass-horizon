# COMPASS deployment

Canonical source: axmatea/compass-horizon. Product root: /compass.
Existing target: Railway compass-nayl-vincent / compass-web, mycompass.world.
Verify authenticated provider ownership before modifying this service.
Use compass/Dockerfile in the /compass build context; health check /healthz.
The retired axmatea/compass Git source must not be used for new releases.
Preserve domains, variables, database and mounts when reconnecting source.
Do not upgrade billing, change DNS or provision credentials/resources without
specific approval. Never copy local .env or transcripts into the image.

## Current no-database publication

The owner chose deployment without provisioning PostgreSQL. Homepage and sign-in
UI can be published, but authentication/persistence stay explicitly unavailable.
healthz.ok is process liveness, not proof of private collaboration readiness.
The team AI runtime remains BLOCKED. Do not substitute demos for real data.

## Release checks

Run tests, typecheck and build on the reviewed SHA. Verify /, /app, /login and
/office redirect; retired demos/presentations return 410 and obsolete APIs 404.
Deploy reviewed source only to the existing service. Verify provider deployment
ID/SHA, public health, linked assets and the three retained pages in-browser.

Rollback redeploys the prior known-good image, never resets data or rewrites Git.
Payment blocks require owner action; do not evade them via another project.
