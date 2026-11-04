# Homepage deployment

Canonical repo: axmatea/compass-horizon. Existing Railway service:
compass-nayl-vincent / compass-web, serving mycompass.world.
Verified source binding: main, root directory /compass, healthcheck /healthz.
Use the existing Dockerfile; no database, auth, API, new resource or secret setup.

Run check, tests, build and audit before merge. After deployment, require the
expected Git revision and mode=homepage-only in /healthz, successful homepage
assets, retired office/login/demo URLs returning 410 and APIs returning 404.
Inspect the published page in-browser. Never claim a merge is itself a deploy.

Keep current domains, resource limits, variable values and data unchanged.
Old runtime variables may be unused but are not credentials to disclose or
rotate as part of source cleanup. Do not pay bills, upgrade plans or grant
broader access automatically. Rollback redeploys an existing image, not a DB reset.
