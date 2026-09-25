# Acquisition Authentication

Invite-only email/password authentication backed by PostgreSQL and Better Auth.
Implementation verified against installed Better Auth **1.7.6**. No account,
workspace, invitation, email, or external service call is created at startup.

## Integration Contract

```js
import { createAuth } from '../server/acquisition/auth.mjs';

const auth = await createAuth({ pool, env: process.env });
// Before body parsing and before any generic Better Auth route:
if (await auth.handle(req, res)) return;
const identity = await auth.getIdentity(req);
// identity: { tenantId: string, userId: string } | null
// Always scope protected database operations to identity.tenantId.
```

- `createAuth({ pool, env = process.env })` is async. Requires a working `pg.Pool`.
- `handle(req, res): Promise<boolean>` accepts raw Node HTTP requests, ends the
  response and returns `true` for its routes, or returns `false` for unrelated
  routes. It handles `/api/acquisition/accept-invite` as well as `/api/auth/*`.
- `getIdentity(req): Promise<{tenantId, userId} | null>` validates a Better Auth
  **database** session, then resolves membership from `acq_tenants.user_id`.
  No cookie cache, bearer tokens, request body, query parameter, tenant cookie,
  or tenant/user header can supply the identity. Invalid/expired/signed-out
  sessions and missing membership return `null`; database failure throws 503.
- `acceptInvite({ token, name, email, password }): Promise<{ok: true}>` is a
  server-only helper, with the same transaction as the HTTP endpoint. It does
  **not** establish a session; sign in afterward. A custom caller must provide
  its own HTTP origin/content-type/body-size/rate checks, or use `handle`.
- Errors expose safe `message`, `status`, `statusCode`, and `code` properties.
  Invalid invitation/replay/email mismatch is 400 `INVITE_INVALID`; unavailable
  database is 503 `AUTH_UNAVAILABLE`; invalid startup configuration is 503
  `AUTH_CONFIGURATION_ERROR`. No driver errors or connection strings are exposed.
- The parent owns the pool lifetime; there is no `close()` and no `pool.end()`
  in the factory. Startup failure must block protected routes, not fall back to
  anonymous/demo identity. Parent migration may run before auth initialization.

## Configuration

| Variable | Requirement |
| --- | --- |
| `BETTER_AUTH_SECRET` | Required, at least 32 characters after trimming; supply high-entropy secret material via the operator's secret manager. Never `VITE_*`. |
| `BETTER_AUTH_URL` | Required, one explicit origin, e.g. `https://mycompass.world`, with no path, query, fragment, or credentials. |
| `NODE_ENV` | `production` requires HTTPS and Secure cookies. HTTP is accepted only for non-production loopback hosts. |
| `DATABASE_URL` | Used only by the manual CLI here. The server receives its pool from the parent. No implicit in-memory/database-less auth fallback. |
| `ACQUISITION_TEST_DATABASE_URL` | Optional, explicitly expendable PostgreSQL database for integration tests; never falls back to `DATABASE_URL`. |

This module does not load `.env` files or infer origin from Host/forwarded
headers. Runtime configuration comes from the caller. Do not log request
passwords, cookies, tokens, or environment values.

## HTTP Surface And Security

| Method | Path | Behavior |
| --- | --- | --- |
| POST | `/api/auth/sign-in/email` | Better Auth email/password sign-in. |
| POST | `/api/auth/sign-out` | Better Auth server-side session revocation. |
| GET | `/api/auth/get-session` | Better Auth session or `null`. |
| POST | `/api/acquisition/accept-invite` | `{token,name,email,password}`; returns `{ok:true}` only after commit. |

All other `/api/auth/*` routes return 404, including public signup, password
reset, account linking, email change, and session-management endpoints. Wrong
methods return 405. Better Auth signup is also disabled internally. Do not
mount a second unrestricted Better Auth handler elsewhere.

All POST requests require `Origin` exactly equal to `BETTER_AUTH_URL`'s origin
and `Content-Type: application/json`, including initial login without cookies.
Cross-origin and same-site-but-not-same-origin Fetch Metadata is rejected on
GET and POST. A GET without Origin is allowed for same-origin browser fetches
and trusted server clients; no CORS access is granted. Better Auth's own
origin/CSRF checks remain enabled. Bodies are limited to 16 KiB; name is 1-120
trimmed characters and passwords are 12-128 characters at enrollment. Email is
trimmed/lowercased and follows the same ASCII email grammar as Better Auth
1.7.6's Zod validator, not provider-specific dot/plus transformations.

Cookies are HttpOnly, SameSite=Strict, host-only, Path=/, and Secure on HTTPS
and always in production. Session duration is seven days, refresh age one day.
`getIdentity` disables refresh because it cannot forward Set-Cookie; the browser
may call `get-session` to refresh. Responses are `Cache-Control: no-store`.
Sign-in accepts only email/password/optional `rememberMe`, not callback URLs.

The wrapper permits 30 POST attempts per socket IP per minute, including invite
attempts. Its map is bounded to 10,000 keys; Better Auth additionally limits
sign-in to 10 attempts per minute. Forwarded IP headers are never trusted.
These limits are **per process**, reset on restart, and do not replace a trusted
edge/distributed rate limiter. Behind a reverse proxy, all users sharing its
socket IP share the wrapper limit. Configure appropriate ingress limits before
production scale. Parent-owned acquisition write endpoints still need their
own same-origin/CSRF checks; `getIdentity` is authentication, not CSRF middleware.

## Schema And Atomicity

`createAuth` uses the installed package's
[`getMigrations` API](https://better-auth.com/docs/concepts/database#programmatic-migrations),
not hand-invented Better Auth DDL. Model names are `acq_auth_users`,
`acq_auth_accounts`, `acq_auth_sessions`, and `acq_auth_verifications`. Better
Auth IDs use its default text schema; invite-created user/account IDs are UUID
strings. The default Better Auth `credential` mapping and exported
`hashPassword` are used, with no custom password hashing implementation.

Migration introspection, additive DDL, and `auth-schema.sql` execute on one
checked-out connection in one transaction protected by a transaction-scoped
PostgreSQL advisory lock. This works with a one-connection pool and concurrent
startup. Startup probes the application columns and awaits Better Auth's schema
check, rejecting incompatible schema instead of claiming readiness. Lock timeout is ten
seconds and individual statement timeout is thirty seconds; failure rejects
initialization. The database role therefore needs DDL privileges at startup.
Migrations do not drop tables. Review Better Auth upgrades before changing the
lockfile, especially its credential mapping and schema requirements; this is
not a general legacy-schema/data repair tool.

Application tables, owned solely by this module:

- `acq_tenants`: `id uuid PRIMARY KEY`, `user_id text UNIQUE NOT NULL` references
  `acq_auth_users(id) ON DELETE CASCADE`, `created_at timestamptz`. Exactly one
  member/user per workspace in v1, not multi-member organization invitations.
  Parent project/lead/etc. tables may reference `acq_tenants(id)` after auth has
  initialized. This module does not create early-access or acquisition tables.
- `acq_invites`: UUID ID, unique SHA-256 `token_hash`, normalized email,
  `created_at`, `expires_at`, nullable `consumed_at` and `consumed_by`. No raw
  invite token is stored in PostgreSQL. An invite alone creates no workspace.
- Additional unique indexes on lowercased user email and each user's credential
  account prevent duplicates, including races between distinct invitations.

Acceptance locks the invite row, checks email/unused/expiry, hashes the password
with Better Auth, inserts user + credential + workspace, then conditionally
marks the invite consumed. The final expiry check uses `clock_timestamp()` so
time spent hashing/waiting cannot redeem an expired invite. All writes commit
or roll back together. Racing redemption has exactly one winner. A workspace
failure rolls back user, credential, and consumption; retry can use the token.
Invites for an existing email do not attach another tenant or reset a password.

There is no cross-service transaction or email delivery. A network failure at
commit may leave the client unsure whether acceptance succeeded; replay remains
invalid if committed, and the invitee should try signing in. Possession of the
token plus the matching email authorizes enrollment, not proof of mailbox
ownership: `emailVerified` stays false. Deliver tokens only to their intended
recipient over an approved private channel. Reset/recovery, multi-member
workspaces, MFA, administrator UI, and distributed throttling are not provided.

## Manual Invite CLI

Do not run against real data without explicit current operator approval.

```sh
node scripts/acquisition-invite.mjs --help
# Only after approval, with environment injected securely:
node scripts/acquisition-invite.mjs --email invitee@example.test --expires-hours 72 --confirm-create
```

The CLI requires `--confirm-create`, validates email and a 1-168 hour expiry,
initializes additive auth schema, and inserts only an invitation. It generates
a cryptographically random 32-byte base64url token and prints one JSON record
with `id`, `email`, `token`, and `expiresAt` to **local stdout** after durable
insertion. It sends nothing and creates no account/workspace. Avoid CI logs,
terminal sharing, shell capture, or public URLs containing the token. No real
invitation or credential was created as part of implementation.

## Verification

```sh
node --test test/acquisition-auth.test.mjs
# With an explicitly injected test-only URL:
ACQUISITION_TEST_DATABASE_URL='<test-only-postgres-url>' node --test test/acquisition-auth.test.mjs
```

Offline tests validate fail-closed configuration, redaction, email handling,
hashed tokens, and CLI approval requirements. Without the dedicated test URL,
PostgreSQL tests are explicitly skipped, not claimed to have passed.

Integration tests create a random `acq_auth_test_<uuid>` schema using a pool
whose `search_path` is that schema only. Cleanup drops **only that schema**;
no public/shared tables are truncated or dropped. The test role needs schema
creation permissions. Tests use synthetic credentials and cover concurrent
migrations, one-connection startup, two tenants, login/logout, forged identity,
session expiry, replay, email mismatch, duplicate-token/email races, expiry
while waiting for a lock, rollback after a workspace failure, Secure cookies,
origin/CSRF checks, body limits, rate limiting, and database unavailability.
