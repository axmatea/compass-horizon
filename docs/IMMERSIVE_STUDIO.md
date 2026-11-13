# Immersive Studio and editable Builder

This release builds on the complete-platform main release and the approved Fold
identity. It keeps the same model, identity, billing, database, integrations and
Railway services. The approved product film is unchanged.

## Working experience

Studio has six reachable moments: Idea, Build, Preview, Design, Refine and Export.
Its white sticky canvas follows a single real website. Build/refine actions use
the existing streamed `/api/site/turn` endpoint; loading and scrolling make no
model request. Progress comes from actual server events. A complete validated
result atomically replaces the previous preview. Failed, cancelled, duplicate or
incomplete streams retain the complete version and retry instruction.

Visitors can change typography, palette, spacing and theme, inspect desktop,
tablet or phone layouts, restore history and export the actual HTML. Open in
Builder explicitly saves the exact completed revision history through the
existing bounded device store, then passes only its opaque project ID. The next
chat turn seeds only the validated brief; saved HTML is never an executable server
session seed. Website forms remain unconnected previews. Export does not imply
publication or full-stack hosting.

Native CSS transitions and IntersectionObserver provide restrained motion.
Normal scrolling, scene links, keyboard controls and the final layout work without
animation. Reduced-motion, slow-update, low-core and save-data hints disable
decorative movement. There is no animation framework, WebGL or new imagery.
The earlier generic Studio artwork is no longer displayed; approved team data and
source-backed testimonials policy are preserved below the experience.

## Editing and revisions

The public Builder now has a visible Code action, editable `index.html`, responsive
views, a keyboard/pointer-adjustable conversation pane, restore and consecutive
Undo. Its parser is loaded only on code use: the current parser/policy chunk is
about 105 KB gzip, separate from initial page assets. Source notices are served at
`/licenses/editor-notices.txt`.

The shared parse5 8.1.1 / css-tree 3.2.1 policy accepts a bounded inert HTML/CSS
subset, canonicalizes it and checks it again after serialization. Scripts, frames,
forms, external resources, network CSS, event attributes and unsupported foreign
content are rejected. Existing scriptless iframe/CSP protection remains independent.
Account save/read/publication boundaries revalidate with this same policy instead
of trusting a client label. Applying code creates a revision; invalid input keeps
the editor draft and previous preview.

A conservative three-way merge preserves independent code/chat changes, including
independent stylesheet changes. If both change the same content or incompatible
structure, the update fails visibly and retains the last complete edited page and
retry text. There is no automatic paid repair loop. The base document is bounded,
persisted with the explicit revision and used only for local merging.

The account workspace uses Projects, Studio, Integrations and Settings, with less
frequent actions under More. Its same trusted application engine now supports
version-checked manifest editing, private PNG/JPEG upload/drop, image selection,
actual file hash/change receipts, history and complete binary ZIP export. Runtime
JS files remain read-only. See [the asset contract](BUILDER_ASSETS.md) for quotas,
retention, isolation and exact image validation. The optional GitHub exporter is
text-only and directs image projects to their complete source ZIP.

## Verification and remaining boundaries

The release suite passes 291 tests, including real HTTP/session/owner checks,
manifest edits, optimistic versions, image validation/retention, ZIP bytes and a
real exported trusted server. Syntax/build checks pass; npm audit reports zero
vulnerabilities. Local browser checks cover Studio build/refine/handoff, exact
device reopening, real code editing that survives refinement, account image use,
manifest editing, record creation and restore preserving records. The 390 px
workspace and Studio, and 820 px Studio, have no body horizontal overflow.

These are in-app browser viewport checks, not claims of physical iPhone/Android,
Windows Edge or physical microphone capture. Production is verified separately
against its exact deployed revision and built asset hashes before release is
reported complete. Existing Vercel account deployment restrictions are separate
from the authorized Railway deployment target.

Production accounts remain off. The preview database is still on temporary
Railway storage; durable cloud projects require the existing approved storage,
secret and backup activation work. Live OAuth/email, Anthropic configuration,
commercial credits/test billing, tool connections and arbitrary-code sandbox
activation retain the external dependencies in [DELIVERY_STATUS.md](DELIVERY_STATUS.md).
This release creates no paid resources, live payments or production identity/data
migration, and makes no claim that those disabled providers are connected.
