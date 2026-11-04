# COMPASS consolidation verification

## Canonical source

`axmatea/compass-horizon` is the working repository. Commit `4f498d7` imported
the product from `axmatea/compass` main (`b75e82f`) into `compass/`. This cleanup
does not import or discard unrelated repositories or rewrite Git history.

The product, root Next.js concept and Python research runtime have different
entry points and deployment boundaries. They remain in one repository, with
their own toolchains. Root `product:*` commands make the product accessible
without replacing the existing Next.js build/start commands.

## Removed unused files

Fourteen tracked files were removed, recoverable from Git history:

- Nine disconnected product bootstraps, styles and imported homepage/pitch
  components. The exact paths and reference evidence are in
  [the product migration record](../compass/MIGRATION.md#bounded-consolidation-cleanup).
- `remaster/explainer.html`, `remaster/graphs.html`, `remaster/pitch.html` and
  `remaster/REMaster-pitch.pdf`: standalone legacy presentation outputs, with
  no repository references or build/route inputs.
- `remaster/uitest.js`: an unsupported workstation smoke script, absent from
  package commands and using a former developer's absolute output directory.
  Removing it does not provide replacement Python UI coverage.

Runtime code, active HTML entries, dynamic imports, public media, attribution,
licenses, provider adapters, tests, lockfiles, Docker and Railway files remain.
Assets shared by independent deployments remain intentionally duplicated.

## Verification

- Root Vitest: 48 passed. Office model/layout tests: 11 passed.
- Root TypeScript and Next.js production build passed.
- Root ESLint: zero errors, one existing image-optimization advisory.
- Product backend: 214 passed, five database integration tests skipped.
- Product source-level tests: 118 passed. TypeScript/Vite build passed with
  the existing Horizon3D chunk-size advisory.
- All 103 product production-output files are SHA-256 identical before/after
  source removal. Neither dependency lockfile changed.
- Local browser smoke: root office delay, review, approval, decision memory and
  reset; root Horizon timeline and presentation navigation; product homepage,
  Horizon, presentation and Protect's attack/patch replay using the built-in
  patch example. Protect remains a rule-based simulation, not model validation.

No live provider calls, paid probes, production database tests, DNS changes,
service rebinding, main merge or deployment were performed. The historical
Railway source binding was not reverified; confirm it before a future release.
