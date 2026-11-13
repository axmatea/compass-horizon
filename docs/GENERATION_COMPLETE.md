# Application generation and execution boundary

The existing public scriptless website builder is preserved. The new application
pipeline compiles a bounded JSON specification into a reviewed application
runtime. Model/user JavaScript, shell commands, SQL, URLs and source files are
not accepted by the manifest. No arbitrary generated program runs on the COMPASS
server or engineering host.

## Working implementation

`compass/generation/index.mjs` exports:

- `createApplicationManifest(prompt,{preferences})`: tracker, CRM, booking or
  inventory fields from a bounded request; no invented records.
- `refineApplicationManifest(manifest,instruction)`: validated field additions or
  removal and real theme, typography, spacing and accent changes.
- `validateApplicationManifest(value)`: normalized specification or null.
- `validateApplicationRecord(manifest,data)`: `{ok,value}` or `{ok:false,error}`.
- `createApplicationBundle(manifest)`: async trusted files, exact SHA-256 receipt,
  source manifest and template identifier.
- `exportApplicationZip(bundle)`: actual ZIP bytes with fixed safe paths.
- `renderApplicationPreview(manifest)`: async self-contained trusted UI, precise
  script/style hashes and a network-denying CSP.

The manifest has at most eight fields; labels, options and appearance enums are
bounded. Records accept only declared fields, finite numbers, real calendar
dates and declared select values. Ownership, record IDs and timestamps are
server-controlled. The generic SQLite record store uses parameterized queries,
never manifest-derived SQL identifiers.

The source ZIP includes a Node 22.13+ backend, SQLite, Better Auth 1.7.23, its
resolved npm lockfile, responsive frontend, a real CRUD API, Dockerfile and smoke
tests. Generated code is original engineer-authored template code. Better Auth
is a pinned third-party dependency with its package license; its cryptography is
used instead of custom password or session algorithms.

The trusted export test runs this reviewed source as a separate disposable child
server. It verifies real registration, HttpOnly sessions, anonymous denial,
owner-isolated CRUD, invalid-field rejection, SQLite/session persistence through
a server restart, deletion and logout. The manifest controls data only. This
test does not authorize executing arbitrary source in a host subprocess.

The standalone export intentionally permits only reserved `.test` account email
addresses. Production email delivery, verification, recovery, OAuth credentials,
an HTTPS origin and persistent deployment storage remain the receiving app
operator's setup requirements. Exporting source creates no deployment.

## Hosted trusted application preview

`src/applications/workspace.mjs` provides the prompt/chat, actual application
list, source view/copy/ZIP download, design controls, history restore and record
bridge. Voice uses the existing editable browser dictation implementation and
never auto-submits. Layout preferences change panel widths. A cancelled HTTP
wait preserves the instruction and idempotency key; it does not claim that
server-side work or incurred costs were reversed.

The parent inserts an iframe with exactly `sandbox="allow-scripts"`, without
`allow-same-origin`, navigation, popups or form permissions. The document has an
opaque origin. Its exact trusted script and stylesheet are hash-authorized;
`connect-src 'none'` denies network traffic. No account cookie/token or storage
API is given to the frame.

The frame sends `{type:'compass-app-request',requestId,action,data?,id?}` with
actions list/create/update/delete. The parent verifies `event.source` against the
current frame, binds every action to the currently selected owned app, validates
the action/record schema and request size, and calls the authenticated account
API. It accepts no client project ID, owner, arbitrary endpoint or executable
capability. Switching app/revision creates a new iframe element so a queued old
WindowProxy cannot mutate the newly selected project. Responses go only to that
same frame and matching request ID. Eight concurrent bridge operations and 500
request IDs per frame are bounded; replay IDs do not repeat mutations.

Replies are `{type:'compass-app-response',requestId,ok,records?,record?,error?}`.
The frame accepts replies only from its parent and uses textContent/native form
controls for record values. These protections supplement server-side session,
owner, origin, record limits and validation; the bridge is not authorization.

The iframe isolation is suitable for this fixed trusted renderer and bounded
specification. It is not an arbitrary full-stack code-execution sandbox.

## Optional external execution adapter

`sandbox/vercel.mjs` is default off. It requires explicit spend authorization,
provider credentials and an approved immutable image containing pinned
dependencies before dynamically importing `@vercel/sandbox`. No Vercel resource
was created by this implementation. Provider tests use a mock, and do not prove
live execution or account eligibility.

The adapter rebuilds and compares trusted source before upload, verifies the
server-supplied owner, and records provider sandbox/session/command IDs and source
hash. It requests one vCPU (2 GiB), a 120-second lifetime, no exposed ports,
deny-all egress and no automatic persistence. It runs fixed syntax/smoke commands
with 45-second limits, then stops in finally. No platform credential is passed to
the VM. A failed stop invalidates the receipt. A process-local concurrency cap
is not a distributed spend ledger; server quota reservation is still required
before enabling this adapter across replicas.

This follows the official [Vercel Sandbox SDK](https://vercel.com/docs/sandbox/sdk-reference):
explicit command deadlines, cached session metadata, filesystem upload and
network policies. The SDK's normal defaults allow network traffic and persistent
snapshots, so the adapter overrides both. Any future arbitrary-source support
requires independent isolation and abuse review, real provider receipts and
verified billing/credential authorization.

External blockers: approved external sandbox credentials/account eligibility,
immutable prebuilt image and spend controls for arbitrary execution; persistent
storage/backups and email/OAuth configuration for standalone deployment. The
trusted hosted CRUD preview does not depend on external sandbox infrastructure.
