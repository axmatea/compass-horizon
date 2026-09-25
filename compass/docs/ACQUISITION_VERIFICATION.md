# Acquisition first-cut verification

Date: 2026-09-25. Base: `f72c306f0691366d96bb4f5fa3a4b507b0a224be`.
Branch: `codex/acquisition-engine`. Status: release candidate, NOT deployed.

## Executed checks

| Check | Result | Boundary |
| --- | --- | --- |
| TypeScript and Vite production build | PASS | Local Node 22.22.3 |
| Full backend and legacy transport suite | 232/232 PASS, zero skipped | Explicit local PostgreSQL 18; no live sponsor requests |
| Frontend fixture and date model suite | 7/7 PASS | Client-side synthetic tour |
| Public browser QA | PASS at 390, 768, 1440px | Four tabs and seven tour steps per size |
| Private browser workflow | PASS | Synthetic invited account, real local auth/database |
| Production dependency audit | Zero reported vulnerabilities | `npm audit --omit=dev`; point-in-time, not a security certification |
| Video decode and metadata | PASS | H.264, 1920x1080, 30 fps, 180.000 seconds, 8,041,257 bytes |
| Git diff whitespace check | PASS | No credential files or build artifacts staged |

The PostgreSQL suite covers tenant isolation through authenticated HTTP,
single-use invitation races, logout/SSE revocation, duplicate IDs, out-of-order
and equal-time evidence, unknown attribution, rule versions, malformed provider
responses, leases, quota and stale analytics snapshots. Sponsor HTTP responses
are injected test doubles, not proof of provider credentials or availability.

The restart check runs the real worker in a separate Node process, with a test
provider. It kills that process with SIGKILL immediately after the worker writes
`provider_done` to PostgreSQL. After accelerating lease expiry, a new worker
completes the run without another provider call and preserves the receipt.
Uncertain dispatch is blocked, not retried. This is not an upstream exactly-once
guarantee and is not a multi-day production soak test.

Browser checks found no horizontal overflow, JavaScript page errors or
third-party requests in the public UI. Reduced motion and keyboard focus were
checked. Private QA created an invitation, signed in, saved business rules and
an experiment, added an incomplete lead, applied a budget answer, reloaded the
page, observed a BLOCKED provider job, inspected memory and signed out.
All private QA fixtures were cleaned up. No customer records were involved.

The microphone is explicitly disconnected in this UI, so a browser microphone
permission-denial flow was NOT tested or claimed. Text input is functional.
The underlying acquisition voice authorization adapter has automated tests;
live speech-to-acquisition behavior remains unverified.

## Reproduce locally

Start `npm run db:test`. Do not run a preview worker against the test database
during backend tests: workers share its queue. Use a separate database for any
long-running preview or stop the preview before the suite.

```sh
ACQUISITION_TEST_DATABASE_URL=postgresql://compass_test:local-test-only@127.0.0.1:55438/compass_test npm test
npm run test:acquisition-ui
npm run build
```

Start the application on localhost:8770 with the explicit local DSN, a local
test-only auth secret and BETTER_AUTH_URL=http://localhost:8770. Then:

```sh
npm run qa:acquisition
ACQUISITION_TEST_DATABASE_URL=postgresql://compass_test:local-test-only@127.0.0.1:55438/compass_test npm run qa:acquisition-private
npm run record:acquisition
```

The scripts use Playwright Chromium. Install its browser with
`npx playwright install chromium` when absent. Recording also requires FFmpeg
and ffprobe. No Higgsfield or DaVinci MCP was used.

## Rendered delivery

`delivery/COMPASS_Acquisition_Walkthrough_180s_1080p.mp4` is a real, decoded,
silent screen recording of the public fixture tour. It is not a script posing
as a video, and it is not a live sponsor or worker-restart demonstration.
Use `ACQUISITION_PITCH.md` for live narration. No music or third-party footage.

`delivery/video-manifest.json` records the exact render and timecodes;
`delivery/raw/` retains the source capture. `delivery/qa/` contains screenshots
and JSON browser reports; `delivery/test-report.txt` contains the full suite.
Delivery artifacts are local and gitignored. Reproducible scripts are committed.

## Remaining release blockers

- Railway was authenticated, but its existing project had no PostgreSQL service
  or DATABASE_URL. A spending ceiling for new resources has not been approved.
- Production Better Auth URL/secret and database backups are not configured.
- Nimble, Liquid and Tinybird credentials/resources are absent. No successful
  real sponsor receipts exist; none are represented as live integrations.
- An authenticated synthetic stage workspace is not provisioned. Existing
  private writes are server-labelled LIVE. Do not seed fictional campaign data
  there and imply it is production evidence; public fixtures remain separate.
- Acquisition voice remains disabled. Payment collection is deliberately absent.
- Docker is unavailable on this host, so an actual Linux container build and
  Railway deployment smoke test were NOT run.

Main, Railway and mycompass.world remain unchanged. Do not merge or describe
this candidate as a deployed SaaS until the release gates pass. No paid resource,
generation, advertisement, outbound message or external conversion was created.
