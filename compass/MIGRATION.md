# Higgsfield → Railway migration

Source: https://compass-thinking.higgsfield.app/#present
Source website ID: f72c27b6-74b2-4780-b61b-0efb66b421f4
Source Git revision: 4c3f3eabf6a1dd32d45aee92af1b5d1b481a73f3
Migration date: September 17, 2026 Pacific.

The actual authorized repository was exported through Higgsfield MCP and cloned with scoped access, without exposing credentials. The product Home, PitchDeck and CompassDemo React components and CSS were adapted into a standalone Vite app. Unused Cloudflare/TanStack platform scaffolding, editor inspector and Higgsfield authentication/telemetry hooks are not part of the Railway runtime. No product backend or user database was present in the migrated client experience.

Public media, fonts, icons, captions and pitch notes are local. The film and social cover were copied from their existing authorized source URLs; source URLs, byte sizes and SHA256 hashes are in MIGRATION_ASSETS.json. No media was generated or purchased.

The Higgsfield version’s visuals and three scenarios are preserved, including its existing male protagonist. This is an exact source migration, not a regenerated film or redesign. Earlier Railway presentation versions remain in Git history at commit 3cb2d58 and before.

No automatic two-way sync exists. At migration time, releases used
`axmatea/compass`, branch `main`, and the existing Railway service. This is now
historical: the canonical repository is `axmatea/compass-horizon`, with this
product in `compass/`. Verify the provider's actual source before any approved
release; consolidation does not switch the live service. The original
Higgsfield site remains separate and can diverge if separately edited.

## Verification

- Source film: 60.000 seconds, 1920×1080, H.264/AAC, 24fps.
- Static server: normal health request 200, start/suffix video ranges 206 with correct bytes, out-of-bounds range416, source path404.
- Frontend build, browser comparison and public deployment verification are recorded below when completed.

- Vite production build and TypeScript checks passed; npm audit reports zero vulnerabilities at migration.
- Browser comparison: opening presentation matches original at1280×720; mobile correction slide reviewed at390×844.
- Autoplay advances slide1→2, pause works, slide selector opens correction scene.
- Guided demo correction preserves partnership and updates goal from leaving to redistributing work.

- Migration fix: opening the presentation pauses the film, so its soundtrack cannot overlap browser narration.

## Design correction

User clarified that the intended active design is the dark sci-fi adult heroine and large orb, not the imported Higgsfield page. Restored that specific presentation and matching demo from3cb2d58 into editable source/public assets while keeping the new build system, server, video, GitHub integration and Railway service. Root and #present now use the sci-fi design. The earlier male-character film is available only as a clearly labelled archive in the demo.

## Bounded consolidation cleanup

The earlier sections record migration history, not the current route map. In
`axmatea/compass-horizon`, this product remains in `compass/` with its own Vite
build and Node server. No functioning route, provider, dependency or public asset
was removed.

Removed source paths, relative to this product directory:

- `src/main.tsx`, `src/Home.tsx`, `src/base.css`, `src/compass.css`,
  `src/components/PitchDeck.tsx`, `src/components/pitch-deck.css`: disconnected
  imported homepage/pitch shell. The only importer of `Home` and its base/page
  styles was the unreferenced `src/main.tsx`; only `Home` imported `PitchDeck`,
  which alone imported its stylesheet. All ten Vite HTML inputs, public HTML,
  server routes, dynamic imports, CLI/QA scripts and maintained docs were checked.
  The active homepage uses `index.html` and `src/site/landing.{js,css}`, not this
  shell. The historical source migration above is preserved as provenance.
- `src/landing/app.js`, `src/landing/styles.css`: an older landing implementation
  with no imports, HTML links, server loaders, script hooks or maintained-doc
  instructions. It is distinct from the active `src/site/landing.*` files.
- `src/remaster/main.tsx`: redundant bootstrap with no HTML entry, imports or
  script hooks. REMaster remains mounted by the lazy import in `src/entry.tsx`
  through `app.html`; both legacy REMaster routes and all runtime code remain.
  The contract's frontend ownership list now describes that shared entry.

Preserved deliberately: providers, recorded/synthetic fixtures, tests, CLI and
browser QA tools, public assets and source licenses. For example, the stage
imports its ten-slide archive for `?deck=v10`, standalone bridge files have
their own run instructions, and the voice adapter is still a documented
contract reference. Lack of a static importer alone is not deletion evidence.

Verification is local only. Baseline: `npm ci --ignore-scripts --no-audit
--no-fund`, `npm test` (214 passed, five DB tests skipped), TypeScript/Vite build
(passed with the existing large Horizon3D chunk warning), and 118 source-level
unit tests (passed). Production output hashes were captured before deletion.
No browser/Playwright script, provider probe, live model, database provisioning,
deployment or credential operation is part of this cleanup.

Final verification matched baseline: 214 backend tests passed with the same five
DB skips, all 118 source-level tests passed, and TypeScript/Vite build passed
with the same chunk-size warning. All 103 files in the production `dist/` output
are byte-for-byte identical by SHA-256. A final import/HTML/CSS reference scan
across 305 retained files found zero references to the nine deletions; remaining
path mentions are this removal record. Package scripts, dependency versions,
lockfile, Vite inputs, server routes, public assets and Docker packaging are
unchanged. `git diff --check -- compass` passed. Database integration was not
exercised without an explicit test DSN; the parent owns browser checks via CUA.

Source-level test command, from `compass/` (no browser scripts):

```sh
node --experimental-strip-types --test --test-concurrency=1 \
  src/protect/*.test.mjs src/remaster/*.test.mjs src/workspace/*.test.mjs \
  src/mission/*.test.mjs src/acquisition/demo.test.mjs \
  src/office/model.test.mjs src/office/scene/layout.test.mjs
```

Both baseline and final test/build processes used an empty environment with only
`PATH` and `HOME` retained, so no inherited provider credentials or database DSN
could activate integrations. No environment or credential file was inspected,
and authentication code is unchanged.
