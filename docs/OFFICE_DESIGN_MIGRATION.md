# Office / Shared Memory

Canonical repository: https://github.com/axmatea/compass-horizon.
Release base: `c585785`. Branch: `codex/office-release`.
The former `axmatea/compass` repository is no longer the publication target.
Only the office frontend, existing room artwork and local font were transferred.
No old server, authentication, database or deployment configuration was copied.

## Routes and boundaries

`/` and `/app` open the populated public office concept without login.
`/presentation` walks through the same scene. `/horizon` preserves the original
Horizon engine and query parameters without changing its calculations.

A local reducer models a fictional studio launch: a supplier delay affects three
owners; review previews revised tasks; owner approval applies them. The proposed
coordination session includes only the two dependency owners. Sources stay
inspectable. Task edits and literal notes are resettable and lost on reload.

No live AI, authentication, multi-user persistence, database, calendar checks,
invitations, notifications or self-learning are connected to this office.
Vincent's Python backend arrived in `remaster/` at `c585785` and is preserved.
It is not yet connected to this office. Keep credentials server-side; agree on
workspace snapshots, stable event IDs, source/decision records and explicit
approval before replacing fixtures. Do not silently simulate a failed live call.

## Visual provenance

The user's REMaster screenshot is the binding visual reference. The unchanged
`public/remaster/studio/room-v1.webp` is its clean 1536 x 1024 room artwork.
SHA-256: `a75b1d10170b6de4cad18fe3a283bd7b66234a2a935ca0e5a91a5fbf56269769`.
The original asset manifest records GPT Image generation and WebP conversion.
No new generation or credit spending occurred in this migration. Manrope's OFL
is bundled alongside the font. React buttons and SVG paths add the interaction.

Doc-Code/agent-office at `52b844346ab33297717c5f918c7ad3a19dd53bad` was inspected
for spatial inspiration only; no code, installers or agent hooks were imported.
Artist/Artlist generation tools were unavailable. No paid substitute was used.

## Publication

Vercel is the existing canonical repository deployment setup. Railway belongs
to the former repository. Independently confirm `mycompass.world` domain mapping
before claiming it serves this code. Do not change DNS as an implicit fallback.
