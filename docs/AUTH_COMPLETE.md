# Authentication and onboarding implementation

This increment extends the existing Better Auth 1.7.23 integration. It does not
enable production accounts, create provider applications, provision storage or
activate a paid service.

## Working account surfaces

- `/create?view=account`: change display name and password, inspect active-session
  count, sign out other devices, manage configured sign-in methods and sign out.
- `/create?view=recover`: request a managed password-reset link when transactional
  email delivery is configured.
- `/create?view=reset`: complete the actual Better Auth reset using the token from
  its email link. The token is removed from browser history before API requests
  and sent only in the reset POST body; it is never put in a saved draft.
- `/create?view=verify`: show verification status from the verified session and
  request another verification link. A URL flag alone never proves verification.
- `/create?view=preferences`: edit preferences without discarding a pending idea
  or accidentally starting a build.

Account management uses the official Better Auth HTTP endpoints. Every action
still verifies its HttpOnly cookie and database session. A bound user header is
only a continuity assertion: another account's shared cookie is rejected. Name
updates accept only a bounded name. Password changes force revocation of other
sessions and accept the library's rotated current-device cookie. Email changes
require delivery and the library's old-address confirmation/verification flow.

Linking uses configured social providers, Better Auth state/PKCE and verified
email policy. The UI does not display an unconfigured provider or imply that an
OAuth connection grants repository or productivity-tool access. OAuth token
encryption, host-only Secure cookies on HTTPS, exact origin checks, resource caps,
default-off staging and primary-domain guards remain in place.

## Short onboarding and server contract

The first two optional questions remain project type and visual direction.
Experience, intended use and workspace layout sit in an optional disclosure.
They can all be skipped. Original prompts retain their tab-local lifetime and
are never copied into authentication URLs or preference records.

`normalizePreferences` in `src/create/draft.mjs` supports these bounded values:

| Field | Values |
| --- | --- |
| projectType | website, saas, internal-tool, client-portal, other |
| visualDirection | minimal, editorial, bold, professional, custom |
| experience | beginner, designer, developer, founder |
| intendedUse | personal, startup, agency, business |
| workspaceLayout | balanced, preview, conversation |

`account/profile.mjs` exports `validateProfilePreferences(value)`. It returns a
normalized object or null for invalid/unknown fields. The owner-scoped profile
API continues to use `{preferences}`; this needs no new database columns.

## Verified and externally blocked

Actual Better Auth/SQLite tests cover registration, login, password checking,
session expiry, logout/revocation, shared-cookie account changes, name updates,
password rotation, other-device revocation and account isolation. Captured test
delivery exercises the library's real verification, reset and email-change
tokens, including legitimate external email-link navigation. This is not a real
inbox-delivery test. Client protocol tests cover private identity binding, reset
token handling, optional preferences, prompt preservation and safe callbacks.

| External dependency | Exact setup and evidence still required |
| --- | --- |
| Google OAuth | Owned client ID/secret, allowed origin, consent/tester settings, exact preview callback and a real full-browser login. |
| GitHub OAuth | Owned OAuth application/client credentials, exact preview callback, consent and a real login/link/unlink cycle. |
| Apple OAuth | Apple Developer ownership, App/Services IDs and valid signing credentials; exact callback and actual Apple account flow. |
| Transactional email | Authorized HTTPS delivery endpoint/token and sender setup; receive and complete verification, old/new address change and password recovery in actual inboxes. |
| Production accounts | Approved durable database/volume, fixed secret, backup/restore evidence, provider tests and a separate production-auth rollout; current production remains disabled. |

Social callbacks are `<preview-origin>/api/auth/callback/google`, `/github` and
`/apple`. Only server-side credential pairs enable them. Without delivery the
preview accepts unverified `.test` identities only and offers no recovery or
email-change controls. Ephemeral signing secrets remain restricted to disposable
single-instance synthetic-email QA; real providers require a fixed secret.

## Durable storage and explicit backup readiness

`account/storage.mjs` exports `inspectStorage(env)`. A plain directory or an
ephemeral signing key never earns a durable-storage label. The check requires
`COMPASS_STORAGE_MODE=persistent-volume`, the real absolute
`RAILWAY_VOLUME_MOUNT_PATH` supplied for the attached volume, an existing private
`COMPASS_ACCOUNT_DATABASE` whose real path remains inside that mount, writable
database/journal directories, and a fixed `BETTER_AUTH_SECRET`. It verifies the
dedicated mount entry in Linux mountinfo and rejects public database locations,
symlink escapes and unsafe database permissions. Only mode and dependency codes
are suitable for public configuration; paths and secrets are not returned there.

No volume has been provisioned by this implementation. That remains an explicit
external dependency requiring authorized Railway storage configuration and its
cost approval. Give the non-root service user ownership/write access to its
private data directory. Railway volumes use one service instance; adding this
adapter does not authorize additional infrastructure or production identity.

`backupAccountDatabase({env,database})` is an operator-only helper, never a user
API or startup action. Set `COMPASS_BACKUP_DIRECTORY` to an existing absolute
0700 private directory outside the served static root. The helper checks the
source handle against the configured account database, uses Node's SQLite online
backup API, creates a new exclusive 0600 snapshot, and checks SQLite integrity.
It neither overwrites an earlier snapshot nor restores anything automatically.
Node 22.16+ is required for the backup API; the verified runtime is 22.23.4.

Disposable tests restore a synthetic account, its fixed-secret session and an
owner-scoped saved project from an actual snapshot; another owner still receives
404. The positive mount checks use an explicit test mountinfo seam and do not
prove that any cloud volume exists. Live redeploy persistence and actual mounted
volume recovery remain required before claiming cloud saving. Keep protected
off-volume backups and review retention/recovery separately: a snapshot on the
same volume does not protect against losing that volume.

## Primary references

[Better Auth account management](https://better-auth.com/docs/concepts/users-accounts),
[email and password recovery](https://better-auth.com/docs/authentication/email-password),
[session management](https://better-auth.com/docs/concepts/session-management),
[social OAuth](https://better-auth.com/docs/concepts/oauth),
[Railway volumes](https://docs.railway.com/volumes/reference),
[Node SQLite API](https://github.com/nodejs/node/blob/v22.23.0/doc/api/sqlite.md).
