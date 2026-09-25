# Human Team Workspace API

## Integration and trust boundary

```js
import { createWorkspaces } from './server/workspaces/index.mjs';
const workspaces = createWorkspaces({
  env: process.env,
  getIdentity: req => acquisition.getIdentity(req),
});
// Before static fallback, with the original unread Node IncomingMessage:
if (await workspaces.handle(req, res)) return;
// During shutdown, before closing the acquisition auth owner:
await workspaces.close();
```

`createWorkspaces` is synchronous and returns `{handle, close, status}`.
`handle` returns false only outside `/api/workspaces`; it owns responses within
that prefix. It does not parse global bodies or mutate other application routes.
`status()` is synchronous, public-safe configuration/last-observed health, not a
live database probe. `close()` is asynchronous and idempotent, ends workspace SSE
connections and closes only this module's pool. The integrator owns `server.mjs`.

Required: `DATABASE_URL` (PostgreSQL), `BETTER_AUTH_URL` (explicit same-origin
HTTP(S) origin), and the existing verified `getIdentity(req)` callback. HTTP is
allowed only on non-production loopback. The callback currently returns
`{tenantId,userId}` or null. **Workspace authority uses only the verified userId
and database membership, never acquisition tenantId or client-supplied IDs.**
Names and email come from `acq_auth_users`, not headers or browser payloads.
Ordinary Better Auth signup has `emailVerified=false`; this flag is deliberately
not required. "Verified identity" here means a server-validated session, not
proof that the person owns the mailbox. Email matching is case-insensitive.

An independent `pg.Pool` uses up to eight connections. Migration is lazy, on the
first authenticated request, additive, transactional, and guarded by a PostgreSQL
advisory lock. Existing Better Auth initialization must already have created
`acq_auth_users` and `acq_invites`. No existing table is migrated or reset. The
module creates only `ws_workspaces`, `ws_members`, `ws_tasks`, `ws_materials`,
`ws_invites`, `ws_commands`, `ws_events` and their constraints/indexes. Missing or
unavailable database/auth configuration returns 503, never in-memory fixtures.
Failed initialization can be retried on a later request. Public status does not
initialize schemas or expose DSNs, users, tokens, secrets or runtime endpoints.

## HTTP contract

All routes below start with `/api/workspaces`. Responses are JSON except SSE.
All mutation requests require `Origin: <BETTER_AUTH_URL origin>` and
`Content-Type: application/json`, including DELETE. Cross-site Fetch Metadata
and mismatched supplied origins are rejected for reads as well. No CORS access
is provided. Cookies are verified by existing Better Auth. All responses use
`Cache-Control: no-store`; invite responses also use `Referrer-Policy: no-referrer`.
Unknown input fields, authority headers (`x-user-id`, `x-tenant-id`, and
`x-compass-*` equivalents), and unsupported query parameters are rejected.

| Method and path | Body | Response |
| --- | --- | --- |
| GET `/status` | None; public | `{status,database,reason,ai,invitesConfigured,limits}` |
| GET `/` | None | 200 `{workspaces: [{id,name,goal,deadline,role}]}` |
| POST `/` | `{name,goal?,deadline?,commandId}` | 201 `{workspace}`; caller becomes owner |
| GET `/:id` | None | 200 snapshot below |
| POST `/:id/materials` | `{title,content,commandId}` | 201 `{material:{id,title,content,createdAt,authorId}}` |
| POST `/:id/tasks` | `{title,assigneeId?,status?,dueDate?,commandId}` | 201 `{task}` |
| PATCH `/:id/tasks/:taskId` | `{version,title?,assigneeId?,status?,dueDate?,commandId}` | 200 `{task}`; at least one changed field required |
| DELETE `/:id/tasks/:taskId` | `{version,commandId}` | 200 `{ok:true}` |
| GET `/:id/events` | Optional `?after=<seq>` / `Last-Event-ID` | SSE `event: state`, full snapshot |
| POST `/:id/invites` | `{email,commandId}`; owner only | 201 `{token,expiresAt,signupRequired}` |
| POST `/accept-invite` | `{token,commandId}`; signed in | 200 `{workspace}` |
| DELETE `/:id/members/:userId` | `{commandId}`; owner only, target not owner | 200 `{ok:true}` |

The base list/create URL is `/api/workspaces`, **without** a trailing slash.
Workspace/task IDs are lowercase UUIDs. Dates are valid `YYYY-MM-DD` or null,
not timestamps; omitted creation dates default to null. Goal defaults to `""`.
Task defaults: `assigneeId:null`, `status:"todo"`, `dueDate:null`, `version:1`.
PATCH omission preserves a value; explicit null clears assignee/due date.
Task states are `todo`, `doing`, `done`. Task assignment is limited to current
workspace members, including the owner. Both roles can create materials, create,
edit and delete tasks. Only owners can invite/remove members. Owner transfer,
workspace editing/deletion, material editing/deletion, and member self-leave are
not implemented. Removing a member clears their task assignments and increments
those tasks' versions, preserving authored materials and source attribution.

```json
{
  "workspace": {"id":"uuid","name":"Team","goal":"Ship","deadline":null,"role":"owner"},
  "members": [{"userId":"auth-user-id","name":"Person","email":"person@example.test","role":"owner"}],
  "tasks": [{"id":"uuid","title":"Review","assigneeId":null,"status":"todo","dueDate":null,"version":1}],
  "materials": [{"id":"uuid","title":"Notes","content":"Human text","createdAt":"ISO timestamp","authorId":"auth-user-id"}],
  "proposals": [],
  "events": [{"id":"1","seq":"1","type":"workspace.created","kind":"workspace.created","actorId":"auth-user-id","commandId":"command-id","entityId":"uuid","source":"human","details":{},"createdAt":"ISO timestamp"}],
  "ai": {"status":"BLOCKED","reason":"No verified team-workspace AI runtime is available. No model calls or proposals are generated."},
  "seq": "1"
}
```

The example illustrates the schema, not server seed data. `seq` and event IDs
are decimal strings to preserve PostgreSQL bigint precision. Events contain the
most recent 200 real audits in ascending numeric order; full audit history stays
in PostgreSQL. A new workspace's arrays are empty except its real owner and
creation event. There is no generated team, invented proposal, or runtime fixture.

## Commands, concurrency and audit

Every successful mutation is stored atomically with its audit and response.
`commandId` must match `[A-Za-z0-9][A-Za-z0-9_-]{0,127}`; use a fresh UUID for each
new logical action. Its namespace is **per authenticated user across all workspace
routes**, not per workspace. Identical method/path/JSON body replays the original
HTTP status and body after rechecking current authorization. JSON key order is
ignored; changing field presence, values, route or method returns
409 `COMMAND_MISMATCH`. Do not reuse IDs for new actions. Rolled-back/invalid
commands do not reserve an ID. A 503 may follow an uncertain database commit;
retry the exact command rather than generating a new ID.

Advisory locks serialize commands per actor across processes. Workspace row locks
serialize changes and membership decisions. A fresh membership statement runs
after the workspace lock, preventing stale membership after a queued revocation.
Snapshot reads hold a shared workspace lock only through their transaction.
Task PATCH/DELETE compare `version`; stale versions return 409
`VERSION_CONFLICT`. Refetch and obtain user intent before a new version/new ID.
A successful update increments version; deletion removes the task from snapshots
but retains the entire previous task in a `task.deleted` audit tombstone. A fresh
command against an absent task returns 404; the original successful deletion can
still replay. Composite task-assignee foreign keys reject cross-workspace links.

Audits carry `source:"human"`, verified actor, command, entity, timestamp and
details. Task edits include before/after values. Material audits include title,
author, byte size and SHA-256 of content, not another copy of the material.
Raw request bodies, invite tokens, cookies, credentials and connection errors are
not logged. Commands store only a request digest, not raw invitation requests.

Errors use `{error,code}`: 400 invalid input/assignee/invite/cursor, 401 missing
session/account, 403 bad origin or owner-required/protected, 404 inaccessible
workspace/task/member/endpoint, 405 method mismatch, 408 body timeout, 409 version,
command, capacity or ahead-cursor conflict, 413 body limit, 415 content type or
compression, 429 stream capacity, and 503 unavailable storage/session/invite key.
Inaccessible and nonexistent workspaces both return 404.

## Invitations and existing signup

Only a workspace owner creates an invitation. Tokens expire after 72 hours and
are single-use for **team membership**, with idempotent replay of the successful
acceptance command. A signed-in existing account must match the database invite
email to join; arbitrary email/body/user/tenant claims are not accepted.

For an email without an existing account, the same owner transaction creates an
`acq_invites` row with the exact same token hash, normalized email and expiration.
No credential, account, tenant, cookie, email or external message is created by
the workspace API. `signupRequired` reflects the state at invite creation.

1. Existing users sign in through the existing `/api/auth/sign-in/email` route.
2. New users submit the token, email, name and password to the existing
   `/api/acquisition/accept-invite`. That unchanged code creates credential,
   account and acquisition tenant safely; then the user signs in normally.
3. The signed-in user submits the same token and a commandId to
   `/api/workspaces/accept-invite`. Team and system-signup consumption are
   independent; signup alone does not add workspace membership.

The integrator preserves the team token through login and uses no-referrer
navigation. Do not put tokens in logs, analytics, events or public status. Tokens
are returned only to the inviting owner; delivery is manual. Self-service public
signup, invitation email delivery and mailbox ownership verification are outside
this module. Existing accounts cannot use a new system signup token to replace
their credentials. An already-existing account simply signs in and accepts the
team token. Expired/used/wrong-email tokens do not silently create membership.

Hash-only storage plus replay: tokens are HMAC-SHA256 of a domain-separated random
invite UUID using `BETTER_AUTH_SECRET` (at least 32 non-padding characters).
Only SHA-256 token hashes are stored in both invite tables; command responses
store invitation ID/expiration/signup flag, not token plaintext. The secret must
remain stable across instances/restarts for owner invite-response replay. Rotating
it makes old response reconstruction return 503 `INVITES_UNAVAILABLE`; create a
new invitation with a new commandId. Already delivered tokens remain valid until
consumption/expiry because acceptance checks their persisted hashes. Old invite
response replays retain the original expiration/signup flag; they do not renew an
expired invitation. No invitation revocation endpoint is provided in v1.

## SSE and resource bounds

`event: state` carries a complete snapshot directly, not `{snapshot: ...}`.
`id: <seq>` is the workspace's persisted sequence, incremented once per mutation.
Without a cursor, the current snapshot is sent immediately. Reconnect accepts
`Last-Event-ID` and/or `after`; if both exist, the larger valid cursor wins. Only
newer snapshots are sent. An equal cursor receives a heartbeat until a change;
a cursor ahead of current state returns 409 `CURSOR_AHEAD`, requiring refetch.
This is snapshot recovery, not replay of every intermediate event. Sequence gaps
are valid; a latest snapshot contains all current state and recent audit events.

Polling is once per second after the preceding poll/write completes. Each poll
revalidates the actual auth session, then rechecks membership and sequence under
a shared workspace lock in a database transaction. Unchanged polls and equal-cursor
reconnects do not query materials, tasks, member profiles or audit history; they
only emit a heartbeat. Changed snapshots are loaded in that same transaction
without releasing the membership lock. Revocation or session loss emits `event: workspace-error` with
`{code}`, then ends the stream. The UI must stop displaying the revoked workspace
and avoid reconnect loops on 401/404. Connection lifetime is five minutes; normal
EventSource reconnect resumes using its cursor. Buffer backpressure prevents
queued snapshots; stalled writes are disconnected after 15 seconds. Fifty streams
per module and two per user per module are allowed. Limits are per process, not a
distributed connection quota. Account profile changes alone do not increment a
workspace sequence; a normal GET always reads current account names/emails.

JSON bodies are bounded at **6 MiB actual bytes**, including chunked uploads, and
must finish within 15 seconds. Compressed bodies are rejected. Materials contain
plain JSON text, up to **5 MiB UTF-8 bytes** each, 100 per workspace and 20 MiB total
material content per workspace. JSON escaping can make a 5 MiB source file exceed
6 MiB on the wire; the API rejects that encoded request. There is no binary upload,
MIME processing, document extraction or malware scanning. Render content as text,
not trusted HTML. Titles: 240 bytes; workspace names: 160; goal: 8192. Invalid UTF-8,
lone surrogates and NUL characters are rejected. Workspace/task/name/date input
is validated before SQL writes.

Limits also include 100 workspaces per account, 100 members per workspace, 1000
current tasks per workspace, and 100 active invites per workspace. Retained audit
and command history has no automatic pruning; operations must plan disk capacity,
backups, retention policy and deployment-level request rate limits. Snapshots can
contain up to 20 MiB of materials, so this first version targets small teams rather
than high-volume real-time collaboration. No production soak/load test is claimed.

## AI boundary and verification

No outbound requests, paid services, models, sponsor calls or runtime adapter run
in this module. Existing simulation/runtime APIs are not verified team-workspace
proposal sources. AI stays truthfully `BLOCKED`; `proposals` stays empty. There is
no proposal acceptance endpoint until a genuine persisted, authorized server
proposal and verified runtime contract exist. Unknown proposal endpoints return
404, not fabricated success.

```sh
ACQUISITION_TEST_DATABASE_URL=postgresql://compass_test:local-test-only@127.0.0.1:55438/compass_test \
  node --test --test-concurrency=1 test/workspaces-api.test.mjs
```

`WORKSPACES_TEST_DATABASE_URL` can override the shared test variable. Use an
expendable local PostgreSQL database, never production. Without either variable,
database integration tests explicitly skip; configuration tests still run.
Tests initialize the real `createAuth`, register/sign in synthetic users, and
exercise real HTTP/PostgreSQL. Coverage includes isolation, origin and schema
validation, hash-only signup-linked invites, consumption races, actual existing
account signup with `emailVerified=false`, body/chunked limits, duplicate commands,
versioned edit/delete, source audit, queued revocation, SSE cursor and session
revocation, module shutdown/restart and a fresh Node process replay. Fixtures exist
only in tests and are cleaned by their owned synthetic account IDs. No acquisition
worker or external provider is started. Browser, server integration, deployment
and production database provisioning belong to the main integrator.
