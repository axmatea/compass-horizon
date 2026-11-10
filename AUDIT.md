# COMPASS Phase 0 audit

Date: 2026-11-10. Scope: discovery only. No product code, deploy, DNS, or Railway settings were changed.

Canonical repo: [axmatea/compass-horizon](https://github.com/axmatea/compass-horizon). Live site: https://mycompass.world. Railway project named in the brief: https://railway.com/project/d7a3caa9-648a-4162-a34d-3e3bdc6724cc.

## Stack

The maintained application is `compass/`. Root `package.json` only forwards `dev`, `build`, `start`, `test`, `check`, and `product:*` into that directory.

| Piece | What the repo uses |
| --- | --- |
| Runtime | Node `>=22.12` (Dockerfile `node:22-alpine`). Local check used Node 22.23.4. |
| Frontend | One page, `compass/index.html`, plus `compass/src/site/landing.css` and `landing.js`. Vite `7.3.7` is the only dependency. No React, TypeScript app, or client framework on `main`. |
| Build | `npm run build` → `npm --prefix compass run build` → `vite build`. Single input `index.html`. Output `compass/dist/`. |
| Start | `npm start` → `node compass/server.mjs`. Listens on `PORT`, otherwise `8770`, host `0.0.0.0`. |
| Server | Dependency-free `node:http` static server. Serves `dist` (or `STATIC_ROOT`). |
| Database | None. No sessions, forms, or outbound calls. |
| AI / model providers | None in current code. CSP is `connect-src 'none'` and `form-action 'none'`. |
| Tests | `node --test` on `compass/test/*.test.mjs` and `compass/src/core.test.mjs`. `npm run check` syntax-checks `server.mjs` and `landing.js`. CI: `.github/workflows/compass.yml` on pull requests and pushes to `main` (Node 22, `npm ci`, check, test, build, `npm audit`). |

### Routes on `main`

`compass/server.mjs` accepts `GET` and `HEAD` only (anything else is 405).

- `GET /` and `GET /index.html` — the homepage.
- `GET /healthz` — JSON `{ ok, mode: "homepage-only", revision }`. Revision is `RAILWAY_GIT_COMMIT_SHA`, else `COMPASS_REVISION`, else `"local"`.
- Static files whose extension is in the server allow-list (html, css, js, images, mp4, fonts, txt, xml, json, webmanifest, ico), resolved under the static root.
- Host `www.mycompass.world` in production — `308` to `https://mycompass.world` plus the same path and query.
- Retired prefixes — `410` with `This section has been retired...`: `app`, `office`, `login`, `demo`, `voice-demo`, `presentation`, `present`, `story`, `protect`, `studio`, `horizon`, `vision`, `acquisition`, `live`, `film`.
- `/api` and `/api/*` — `404` `No application API is available.`
- Any other path, including unknown `.html` — `404`. Unknown app routes do not fall through to `index.html`.

### Env var names the current server reads

Values are not recorded here.

- `PORT`
- `NODE_ENV` (www redirect runs when this is `production`; the Dockerfile sets it)
- `STATIC_ROOT`
- `RAILWAY_GIT_COMMIT_SHA`
- `COMPASS_REVISION`

`compass/.env.example` documents only `PORT` and `COMPASS_REVISION`. No `.env` was loaded.

## Deploy config

Present:

- `compass/Dockerfile` — multi-stage. Build stage runs `npm ci` and `npm run build`. Runtime stage copies `dist` and `server.mjs`, runs as user `node`, `EXPOSE 8080`, `CMD ["node", "server.mjs"]`. Railway is expected to inject `PORT`; the process uses that value. `8080` is the image expose port, not a hard-coded listen port.
- `compass/railway.json` — Dockerfile builder, healthcheck `/healthz`, timeout 60s, restart `ON_FAILURE`, max 3 retries.
- `compass/.dockerignore` — excludes `node_modules`, `dist`, `.git`, `.env`, `.env.*`.
- Docs (`README.md`, `compass/DEPLOYMENT.md`, `AGENTS.md`) say production is the existing Railway service `compass-nayl-vincent / compass-web`, source `main`, root directory `/compass`, healthcheck `/healthz`.

Absent: repo-root `railway.json`, `Dockerfile`, `nixpacks.toml`, `Procfile`, `vercel.json`. No preview-environment config is in the repo.

`DEPLOYMENT.md` says old runtime variables may still exist on the service and must stay unpublished. This audit could not list them.

## Live site vs `main`

Fetched 2026-11-10 23:09 UTC. Response header `server: railway-hikari`.

| Check | Live result |
| --- | --- |
| `GET /healthz` | `200` `{"ok":true,"mode":"homepage-only","revision":"4ce21ab8c5b34bcbaceb051175a651db27b1c610"}` |
| `GET /` | `200`, 3978 bytes. Contains `COMPASS is a concept, not an available app.` |
| `GET /demo` | `410` `This section has been retired. Visit the COMPASS homepage at /.` |
| `GET /api/health` | `404` `No application API is available.` |
| `GET https://www.mycompass.world/` | `308` to `https://mycompass.world/` |

`4ce21ab8c5b34bcbaceb051175a651db27b1c610` is `origin/main` HEAD: merge of PR #8, 2026-11-03 23:37 -0800, author identity "AI". A local `npm run build` on that commit produced `compass/dist/index.html` that is byte-identical to the live homepage, including hashed assets `/assets/index-Ca_qVTMB.js` and `/assets/index-p931z0Yi.css`.

Production is this repository's `main`, homepage-only build. It is not an older branch. `origin/codex/compass-homepage-only` is parent `962a2a6`, not the deployed merge commit.

PR #7's description said Railway `compass-web` had been pointed at a retired `axmatea/compass` repo and needed to be reconnected to this repo at root `/compass`. `gh repo view axmatea/compass` does not resolve a repository now. The live revision proves the reconnect (or an equivalent source bind to this repo) is in effect for the homepage. The Railway dashboard itself was not opened. No Railway credentials were sought.

## Where the concept line lives

Exact sentence, `compass/index.html` line 47:

> COMPASS is a concept, not an available app. This homepage introduces the idea only.

Related copy in the same file:

- Title: `COMPASS · Every person. One shared memory. One team.`
- Meta description: `COMPASS is a concept for keeping people, context, and purpose together...`
- Hero subhead: `A concept for keeping people, context, and purpose together.`

`compass/src/core.test.mjs` requires the substring `not an available app` and rejects links to `/demo`, `/app`, `/office`, `/login`, and `/presentation`. Removing the sentence without updating that test fails CI.

The sentence was introduced in `962a2a6` (2026-11-03 23:36 -0800, author `axmatea`), message `Retain only the COMPASS homepage and static delivery`, merged by PR #8 (`4ce21ab`). Before that commit the homepage still said the film illustrated the concept and that the private office needed storage and an invite. It did not say the product was unavailable.

There is no `og:image`, `og:title`, or Twitter card in `index.html`. `robots.txt` allows `/` and points at `sitemap.xml`, which lists only `https://mycompass.world/`.

## Where the demo went

It was deleted on purpose. It is not hidden by a feature flag or an env var. Current `main` has no `DEMO_*` variable. `/demo` is on the hard-coded retired list and returns 410 even if a `demo.html` file is placed in the static root (`compass/test/homepage-server.test.mjs`).

Two commits, the same night, did the damage a reviewer sees:

1. **Demo route and demo files removed.** `85c588e` (2026-11-03 19:42 -0800, author `axmatea`), `Keep only COMPASS home, private office and sign-in`. Merged as PR #7 (`ad416eb`, 2026-11-04). PR #7 scope text: retire all public demos and presentations, keep the homepage plus a private office and invite-only login. The homepage CTA changed from `Talk to COMPASS` (`/demo`) to `Open your office` (`/app`).
2. **Office and film removed, concept disclaimer added.** `962a2a6`, merged as PR #8. PR #8 scope text: keep only the public homepage; retire office, login, auth, workspace APIs, React, PostgreSQL, and demonstrations.

Last commit on `main` that still served the public demo: `c5cb564` (merge of PR #6, 2026-11-03 19:09 -0800, author identity "AI"). Restore from this commit, not from the older September branches.

### What `/demo` actually was

At `c5cb564`, both the production server and the Vite dev middleware mapped `/demo` and `/voice-demo` to `compass/live.html`. That page mounted React `compass/src/site-demo/SiteDemo.tsx` (`useCompassAgent({ domain: 'site' })`).

The page was a voice-or-text site builder: the visitor described a site, could interrupt mid-run, and saw a brief, a build log, and a same-session HTML preview. Prepared example lines asked for a premium AI-company site, then changed tone, hero, and pricing. Homepage nav and the hero CTA both pointed here (`Talk to COMPASS`). A lower section (`#try`) described that public demo. A film block embedded `/media/present/intro-*.mp4` and linked `https://www.youtube.com/watch?v=Y_D17IxUur8`.

Sessions lived in an in-memory `Map` in `compass/server/agent/runtime.mjs` (TTL, capped size), not in Postgres. Copy generation called the server LLM. The UI had a placeholder-copy path when the writer was unavailable, and voice could fall back to browser speech when Gradium and Boson were unset. Postgres (`DATABASE_URL`, Better Auth) belonged to the private acquisition/workspace, which the demo route did not require.

`compass/public/demo.html` (about 2.6 MB, title `COMPASS — Think out loud. Find what’s next.`) was a separate self-contained guided page. The server did not route `/demo` to it. It was deleted in the same `85c588e` commit. QA docs referred to `/demo.html?deck=0`.

Other surfaces removed in `85c588e`, which are not the homepage CTA:

- `/demo/table`, `/demo/workspace`, `/demo/remaster`, `/demo/remaster/app` → `app.html` (office / workspace).
- `compass/src/components/CompassDemo.tsx`, `compass/src/workspace/DemoPortal.tsx`, `compass/src/acquisition/demo.ts`.
- Horizon, studio, presentation, protect, voice bridges, acquisition APIs, and the `remaster/` Python research tree.

No React Native, Expo, or iOS/Android project is in history. `mobile.css` and a Horizon phone view are responsive/UI frames. A claim that this repo shipped mobile apps is not supported by the tree.

### Can it be restored?

Yes. Git history was not rewritten. `git checkout c5cb564 -- <paths>` recovers the files. These remote branches still contain `compass/live.html`, and they are all from 2026-09-25 or 2026-09-29, before the November cleanup: `claude/protect-attack-lab`, `claude/protect-playground`, `codex/office-release`, `codex/restore-original`, `codex/studio-page`. Prefer `c5cb564` over those branches. It is the newest pre-deletion `main`.

Restoring the interactive demo is not a copy onto today's server. Today's Vite build has one HTML input, `package.json` has no React, and `server.mjs` returns 410 for `/demo` before it looks at disk. `AGENTS.md` and `compass/README.md` tell agents not to restore demos. Tests fail if `/demo` stops returning 410 or if the concept sentence disappears. A later phase has to change those guards in the same change that brings a demo back.

There is no tag.

### Historical provider and secret names

Removed from the tree. Names only, in case they are still set on Railway. Do not print values, rotate them, or put them back into the client.

LLM and voice, read by `compass/server/config.mjs` at `c5cb564`: `LLM_PROVIDER`, `GENERAL_COMPUTE_API_KEY`, `GENERAL_COMPUTE_MODEL`, `GENERAL_COMPUTE_BASE_URL`, `GENERALCOMPUTE_API_KEY`, `GENERALCOMPUTE_MODEL`, `GENERALCOMPUTE_BASE_URL`, `GENERALCOMPUTE_TIMEOUT_MS`, `NEBIUS_API_KEY`, `NEBIUS_BASE_URL`, `NEBIUS_MODEL`, `NEBIUS_THINKING`, `NEBIUS_TIMEOUT_MS`, `VOICE_PROVIDER`, `GRADIUM_API_KEY`, `GRADIUM_BASE_URL`, `GRADIUM_VOICE_ID`, `GRADIUM_VOICE_NAME`, `GRADIUM_STT_LANGUAGE`, `GRADIUM_EOT_HORIZON_S`, `GRADIUM_EOT_THRESHOLD`, `GRADIUM_POST_FLUSH_COOLDOWN_FRAMES`, `GRADIUM_TURN_HORIZON_S`, `GRADIUM_TURN_THRESHOLD`, `BOSON_API_KEY`, `BOSON_VOICE`, `BOSON_TURN_DETECTION`, `BOSON_REALTIME_URL`, `COMPASS_TOOLS`, `MOCK_TOOL_DELAY_MS`.

Private office / acquisition: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ACQUISITION_SPONSOR_CALLS_ENABLED`, `ACQUISITION_VOICE_ENABLED`, `NIMBLE_API_KEY`, `LIQUID_BASE_URL`, `LIQUID_MODEL`, `LIQUID_API_KEY`, `TINYBIRD_HOST`, `TINYBIRD_APPEND_TOKEN`, `TINYBIRD_READ_TOKEN`, `TINYBIRD_HASH_KEY`, `TINYBIRD_DATASOURCE`.

REMaster (separate Python tree, not the `/demo` page): `REMASTER_LIVE_ENABLED`, `REMASTER_RUNTIME_URL`, `REMASTER_RUNTIME_TOKEN`, `REMASTER_BRAIN`, `REMASTER_STRATEGIST_BASE`, `REMASTER_DOER_BASE`, `REMASTER_MODEL_STRATEGIST`, `REMASTER_MODEL_DOER`, `REMASTER_MODEL_LIQUID`, `OPENROUTER_API_KEY`, `RAWTREE_TOKEN`, `RAWTREE_HOST`, `RAWTREE_DATABASE`, `RAWTREE_TABLE`, `BFL_API_KEY`.

Defaults recorded in that old `.env.example`: General Compute model `minimax-m2.7`, Nebius model `zai-org/GLM-5.3`, voice auto-select Gradium then Boson then browser speech. Those defaults are not wired on `main`.

## What is broken for a Speedrun review

The site matches its current source. The gap is the product the brief describes.

- The only page tells the visitor the product is a concept and not an app. Tests lock that sentence in.
- There is no `/demo`, no "Try the demo" CTA, and no film. The hero is a short looping `compass-hero.mp4` with a poster image.
- No interactive generator, no waitlist form, no email capture. A form would need a CSP and server change; today `form-action` and `connect-src` are closed.
- No Open Graph image or description aimed at a product preview.
- Footer credit is `NAŸL × VINCENT`. No team bios, customer names, or metrics are on the page. An old homepage illustration contained decorative prices `$29`, `$99`, and `$299` inside a fake generated-page mock. That was not a pricing page. Do not republish those numbers unless the founder confirms them.
- Positioning in the retired homepage (shared team memory, change-intent-mid-action site demo) and the brief (web and mobile app builder versus Lovable, Bolt, Replit, v0) are different stories. The repo does not contain a mobile app builder.

## Parallel work

Checked 2026-11-10 before this file was committed.

- Open pull requests: none.
- Remote heads: `main`, `codex/compass-homepage-only` (merged parent of the concept page), and the four September branches listed above. None of them contain `AUDIT.md`.
- A Codex run on the same brief can still open another branch that adds `AUDIT.md` or edits `index.html`. This draft PR is the only audit file at creation time. Later phase work should rebase if another PR touches `compass/index.html`, `compass/server.mjs`, `compass/src/core.test.mjs`, `AGENTS.md`, or `README.md`.

## Railway facts still needed

Inferred from the repo plus the live responses above. Not visible without Railway access, and not guessed:

- Service id and confirmation that the service name is still `compass-web` inside project `d7a3caa9-648a-4162-a34d-3e3bdc6724cc`.
- Source settings screenshot or API: repo, branch, root directory (`/compass` is what the docs and the matching Dockerfile imply).
- Latest deploy id, time, and build log. Live git SHA is `4ce21ab`; the deploy timestamp is not in `/healthz`.
- Env var **names** currently set on the service (values stay private). Especially whether any historical provider or `DATABASE_URL` names are still present and unused.
- Custom domains besides `mycompass.world` and `www.mycompass.world`.
- Whether a preview/staging environment exists, and the rule for which branch deploys there. Nothing in-repo defines one.
- Resource limits and the healthcheck the platform has saved (repo asks for `/healthz`).

Do not create a service, change the production branch, or promote a deploy until the founder approves a preview URL.

## Plan for later phases

Each step is a separate small PR off `main`, preview first, production only after the founder accepts the preview URL. Phase 0 does not start them. `AGENTS.md` currently forbids restoring demos; the first product PR has to update that guide, `README.md`, and the tests that require the disclaimer and the 410, or CI and later agents will revert the work.

### Phase 1 — credibility

1. Replace the concept disclaimer and meta description with copy the founder approves (`Early access`, `Request access`, or `Join the waitlist`). Keep claims inside what the founder confirms. Update `core.test.mjs` in the same commit.
2. Add a homepage CTA `Try the demo` to a real `/demo` route. Teach `server.mjs` to serve that page with 200, and stop returning 410 for `/demo` only. Leave other retired prefixes on 410 until a later PR needs them. Update `homepage-server.test.mjs`.
3. Add a video block that reads `DEMO_VIDEO_URL` from the server environment (or a build-time public config the server injects). Until it is set, render a request-access state and do not embed an empty player. The old YouTube id is a candidate for the founder to accept or replace; it is not assumed to be the review video.
4. Add title, description, and `og:image` using assets already in the repo (hero poster is the existing image). No new claims.
5. Check the homepage and `/demo` at a phone width and a desktop width. Run Lighthouse against the preview and fix what this page actually fails. Do not quote a score that was not measured.

### Phase 2 — interactive `/demo`

The November `/demo` and the brief's Phase 2 flow are different products. Pick one with the founder before writing it.

- Restoring `c5cb564`'s `SiteDemo` brings back React, the voice stack, the in-memory agent runtime, and a site-preview domain. It does not ask 1–3 clarifying questions and then show a mobile frame of an arbitrary app. It needs a server-side model key to do more than the placeholder-copy fallback.
- Building the brief's flow (intent, a few questions, a plan, a web preview plus a phone frame, three example intents) is a new page. Put the model call in one server module. Keys stay in the environment. If the call fails, show a checked-in example run. Add a per-IP limit and a max prompt length before any public preview. Captcha only if the founder wants that vendor.

No key is in the repo. Do not hardcode one. Do not call a provider during Phase 0.

### Phase 3 — investor story

After the demo route exists: one hero line and two CTAs, a three-step "how it works", a sourced comparison with public Lovable / Bolt / Replit pages, an email-only waitlist whose destination the founder names, and a footer. Team bios, logos, and any traction numbers stay as visible TODOs until the founder supplies them. Links named in the brief (`https://aimedia.global`, `https://jarrarcpa.pro`) go on the page only after the founder confirms the wording around them.

## Questions only the founder can answer

1. Which product should the reviewer see: the retired "shared memory / change the site mid-sentence" demo, or the brief's "describe an app, COMPASS builds the web and mobile product" demo? The repo contains the first. It does not contain a mobile app builder.
2. What is `DEMO_VIDEO_URL`? Is `https://www.youtube.com/watch?v=Y_D17IxUur8` still the film to embed?
3. Which model provider and key should a new server module use? General Compute, Nebius, or another account? Who creates the key, and is it already set on Railway under one of the historical names?
4. May a later PR override `AGENTS.md` and the homepage-only tests so `/demo` can return 200?
5. Team names, bios, and logos to publish. The page credit is only `NAŸL × VINCENT`.
6. Which sentences about AX Media Global, aimedia.global, and jarrarcpa.pro are approved? Any metric, price, or customer name? The old `$29 / $99 / $299` figures were decorative mock copy.
7. Where should a waitlist email go (address, form backend, or a hosted form)? Nothing in the current server can store one.
8. Railway: confirm service, root directory, branch, env var names, and whether a preview environment may be created. Production promotion stays blocked until you approve the preview URL.
