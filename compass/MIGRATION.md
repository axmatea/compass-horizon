# Higgsfield → Railway migration

Source: https://compass-thinking.higgsfield.app/#present
Source website ID: f72c27b6-74b2-4780-b61b-0efb66b421f4
Source Git revision: 4c3f3eabf6a1dd32d45aee92af1b5d1b481a73f3
Migration date: September 17, 2026 Pacific.

The actual authorized repository was exported through Higgsfield MCP and cloned with scoped access, without exposing credentials. The product Home, PitchDeck and CompassDemo React components and CSS were adapted into a standalone Vite app. Unused Cloudflare/TanStack platform scaffolding, editor inspector and Higgsfield authentication/telemetry hooks are not part of the Railway runtime. No product backend or user database was present in the migrated client experience.

Public media, fonts, icons, captions and pitch notes are local. The film and social cover were copied from their existing authorized source URLs; source URLs, byte sizes and SHA256 hashes are in MIGRATION_ASSETS.json. No media was generated or purchased.

The Higgsfield version’s visuals and three scenarios are preserved, including its existing male protagonist. This is an exact source migration, not a regenerated film or redesign. Earlier Railway presentation versions remain in Git history at commit 3cb2d58 and before.

No automatic two-way sync exists. Future changes ship from axmatea/compass main to the same Railway service. The original Higgsfield site remains unchanged and can diverge if separately edited.

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
