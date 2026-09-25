# Release verification

2026-09-25, release based on c585785 including Vincent's remaster directory.

- Next production build and TypeScript: pass.
- Horizon Vitest suite: 46 tests pass, unchanged engine.
- Office reducer and scene layout: 11 Node tests pass.
- Browser: 390, 768, 1440px; real clicks through delay, proposal, approval,
  memory and reset; no horizontal overflow or page errors. Reduced motion used.
- /app, /presentation and /horizon?day=9: HTTP 200.
- Six presentation scenes manually inspected at all three widths before final
  build; keyboard navigation and notes checked. Slides can scroll vertically.
- npx eslint src: no errors, one advisory for the unchanged local room img.
- Full npm run lint is blocked by a pre-existing require-style import in
  remaster/uitest.js. Backend files were not changed to suppress it.

Reproduce browser checks with a local Playwright installation:
`BASE_URL=http://localhost:8902 node scripts/office-smoke.mjs`.
If Playwright is installed elsewhere, set PLAYWRIGHT_MODULE to its ESM entry.
The script saves viewport screenshots to /tmp/compass-office-WIDTH.png.

Not verified: live AI integration, Python provider calls, multi-user persistence,
production domain reassignment. No API/model credits were spent.
