# Exact-room office scene

Default export: `OfficeScene.tsx`, accepting the unmodified `../types.ts`
`OfficeSceneProps` contract. Explicit `use client` boundary for Next/React reuse.
Imports only React, its local layout helper and CSS.
The only image request is the existing `/remaster/studio/room-v1.webp`, unchanged.
No Three renderer, remote asset, API call, storage, font request or generated image.

The room keeps its original 3:2 aspect ratio without cropping. Parent owns the
outer frame, tokens, inspector and state. Seat labels and paths share the image's
percentage coordinate system. The central table opens the shared plan. The memory
layer keeps the artwork visible beneath a translucent warm foundation overlay.

Canonical public mapping: Esra upper left, Ravi upper middle, Sam right, Leo
left foreground, Maya center foreground, Noa right foreground. Original room
names Priya/Sarah/Max/Leo/Maya/Noah are also recognized. Two-person adapters retain
Maya/Leo positions; arbitrary people use free seats and any overflow stays in the
roster. Only supplied people get labels. Fixed figures in the artwork are explicitly
not membership, identity verification, attendance or online-status indicators.

`affectedIds` adds amber paths and badges only to affected people. `selectedId`
focuses that seat and its path. `meetingIds` moves only matching labels toward the
table, never fabricates attendee figures or claims an actual meeting occurred.
Motion stops under prefers-reduced-motion. No continuous timers or animation loops.

HTML controls work without WebGL. If the image fails, an original inline SVG
floorplan preserves spatial selection. A roster appears on smaller layouts and
for overflow people, including a two-column phone layout. Desktop hotspots are
keyboard accessible. No unassigned decorative person buttons.

Accessible names:
- Scene: `Interactive shared office`.
- Photograph labels: `Select <full name>, <role>` with affected/preview suffixes.
- Roster: group `Office seats`, buttons `Open seat for <full name>`.
- Central table: `Open shared team plan`.
- Memory: `Open shared memory`.

Checks:
`node --experimental-strip-types --test src/office/scene/layout.test.mjs`
`node_modules/.bin/tsc --project src/office/scene/tsconfig.json`
