# COMPASS Phase 0: verified Railway supplement

Verified November 10, 2026 (America/Los_Angeles). This supplements the
concurrent [Phase 0 audit PR #9](https://github.com/axmatea/compass-horizon/pull/9),
whose `AUDIT.md` did not have Railway access. It changes documentation only.
No deployment, service setting, environment variable, DNS, billing or
production data was changed. Secret values were neither requested nor printed.

## Production identity

| Field | Verified value |
| --- | --- |
| Project | `compass-nayl-vincent`, `d7a3caa9-648a-4162-a34d-3e3bdc6724cc` |
| Environment | `production`, `04ac467d-09d8-44e8-8a37-422d12990e7c` |
| Service | `compass-web`, `2f7f6c4e-7030-47c2-b391-5a0df7eaaa90` |
| Git source | `axmatea/compass-horizon`, branch `main`, root `/compass` |
| Active deployment | `fea37a5b-6aac-4555-bded-b0c35d4d587a`, `SUCCESS` |
| Exact revision | `4ce21ab8c5b34bcbaceb051175a651db27b1c610`, merge PR #8 |
| Created | November 3, 11:37 p.m. Pacific (`2026-11-04T07:37:43.148Z`) |
| Health | Online, 1/1 replica in `sfo`, zero failures in preceding 24 hours, no active warnings/criticals |

[Railway project](https://railway.com/project/d7a3caa9-648a-4162-a34d-3e3bdc6724cc).
The production service is bound to the canonical repository, not the retired
`axmatea/compass` repository. No branch drift was found.

Attached domains:

- [mycompass.world](https://mycompass.world), custom target port 8080.
- [www.mycompass.world](https://www.mycompass.world), custom target port 8080.
- [compass-web-production-da39.up.railway.app](https://compass-web-production-da39.up.railway.app), automatic port.

Live Safari inspection independently confirmed `/healthz` reports `ok: true`,
`mode: homepage-only` and the exact revision above. The homepage still contains
the concept disclaimer; `/demo` displays the retired-section response. The
server source and passing local route tests establish the HTTP 410 contract.

## Effective build, start and release checks

The stored service field reports builder `RAILPACK`, while repository
`compass/railway.json` declares `DOCKERFILE`. The latest deployment actually
used the Dockerfile: logs explicitly load `compass/Dockerfile` and show its
`npm ci`, `npm run build`, `COPY --from=build /app/dist ./dist` and
`COPY server.mjs ./` stages. Do not change settings just to reconcile the
stored display field. Full resolved deployment config was not exposed.

The repository image uses `node:22-alpine`, runs as non-root `node` and starts
`node server.mjs`; no service-level start-command override was returned.
Railway supplies `PORT`. Healthcheck is `/healthz`, timeout 60 seconds;
restart policy is on failure with three retries. Stored runtime is V2.
The sampled 53 build and two runtime entries had no error/failure/exception/
traceback/warning matches; healthcheck succeeded at `2026-11-04T07:38:01Z`.

The deployed SHA's [GitHub Actions run](https://github.com/axmatea/compass-horizon/actions/runs/41793597696)
and its `verify` check succeeded. Railway external commit status is also
successful. The red GitHub combined status comes from Vercel:
`Account is blocked.`, posted November 3 at 11:37 p.m. Pacific. It does not
indicate a Railway failure. Do not change Vercel or pay an account as part
of this Railway task. Stored source config has `checkSuites: false`; keep
review and CI as explicit gates before any production merge.

## Existing variable names only

`BOSON AI`, `BOSON_API_KEY`, `BOSON_VOICE`, `GENERALCOMPUTE_API_KEY`,
`GRADIUM_API_KEY`, `NEBIUS TOKEN`, `NEBIUS_API_KEY`, `NEBIUS_THINKING`.

`DEMO_VIDEO_URL` is absent. There are no shared variables. Provider-related
names do not prove key validity, model availability or code integration.
Current homepage source has no provider client and reads none of those
provider settings. Historical General Compute/Nebius clients are recovery
references only. No paid provider probes were run; ask the founder to approve
the provider/model and budget before live integration tests.

## Staging and next-step boundaries

Only one environment and one service were returned. No staging, volumes,
buckets, staged changes or pending work exists in the returned project state.
No database service exists in this project. This does not establish whether
unrelated external databases exist elsewhere.

The latest founder brief explicitly authorizes rebuilding `/demo`; it
supersedes the old no-demo rule in `AGENTS.md`. Implementation does not need
another permission question merely because that rule exists. Update the
guide, route/build configuration and tests in the same product change.
Retain unrelated route retirements, secret protection and data safeguards.

Rebuild the narrow intent -> questions -> plan -> interactive web/phone-frame
preview flow on current source. Selectively reuse historical safe-rendering
and provider ideas; do not revert the entire cleanup. A phone frame is not
evidence of native mobile export, and planned SMS/payment integrations are
not completed external actions. Label prebuilt provider-failure examples.

Prepare the exact isolated Railway staging configuration for founder approval
before creating it, because the brief reserves project-setting changes.
Use a temporary Railway domain and no production custom domains or mounts.
Approve the actual preview URL before merging/promoting to production `main`,
which is the current automatic deployment source. No new preview or production
release was created by this audit.

## Validation and remaining inputs

- Current server and landing JS syntax checks passed. All four current Node
  test groups passed using bundled Node v24.22.1 with authorized loopback
  access. These verify the existing homepage behavior, not the future demo.
- This run did not perform a fresh install/build/npm audit, Node 22-specific
  run, mobile emulation or Lighthouse measurement. Do not infer scores >=90
  from the small static bundle or previous deployment success.
- Native Safari desktop screenshots were inspected but not exported; no new
  product screenshots accompany this documentation-only change. Actual
  implementation PRs still require desktop/mobile preview evidence.
- Needed from founder: approved video/poster, provider/model and budget,
  exact team/client claims and bios, and early-access storage/delivery target.
  Metrics/pricing remain unpublished unless confirmed. Missing credentials
  belong in Railway's secret UI, never chat, source or client-side config.

Evidence: connected Railway service/environment/deployment/status and sampled
logs; GitHub branch/commit/status/Actions reads; current source, Git history,
local tests, and live Safari homepage/demo/health inspection.
