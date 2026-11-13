# COMPASS account foundation

First incremental slice of the founder's 13 November 2026 product brief. Existing
Vite, vanilla JavaScript and Node delivery remain. This is not full-stack app
generation, production accounts, activated billing, or cross-device cloud storage.

## Working path

Homepage Build validates and stores the original prompt in tab-local sessionStorage,
then navigates to /create. Prompt text and credentials never enter URLs or OAuth
callbacks. The bounded draft expires after 30 minutes. Failed sign-in, cancelled
OAuth, failed onboarding and failed generation leave it available. Only a completed
build clears its exact handoff id; a late result cannot delete a newer request.

Without configured accounts, /create offers two optional personalization choices
and opens the existing public builder. Choosing SaaS or another application type
still starts with an explicitly labelled website preview. Preferences alter actual
first-build typography, layout and spacing while preserving the original brief.

The isolated account preview adds real registration/sign-in, DB-backed HttpOnly
sessions, optional profile preferences, private generation, owner-scoped saved
projects and usage history. The current page remains intact after a failed request.
Save on this device and HTML export remain available; existing local projects are
never silently migrated. Save to preview account is a separate explicit action.

## Identity choice

The founder chose an alternative to Clerk. Repository history contains Better Auth
1.7.7 with Postgres in the retired acquisition product; this release reuses that
established library, upgraded and pinned to 1.7.23, without restoring those old
services or tables. Better Auth handles password hashing, OAuth state/PKCE, cookie
signing, sessions and account linking. New tables use compass_account_* names.

The implementation uses the officially supported node:sqlite DatabaseSync adapter
for isolated, single-process staging. DB-backed sessions are checked on each
private request, with no client identity trust or session-cookie cache. Exact
origin/Host and same-origin mutations are required. Cookies are host-only,
HttpOnly, SameSite=Lax and Secure on HTTPS. No tokens are stored in frontend storage.
OAuth access/refresh tokens use Better Auth encryption and verified-email linking.
The disposable staging database has a 64 MiB page cap and 50 synthetic-account
limit. These are technical QA safeguards, not a commercial plan or pricing policy.

Primary production domains are explicitly refused by staging configuration. The
public builder retains its own runtime; private session IDs cannot retrieve or
refine private output through public APIs. Every project query includes the
verified owner. Another owner's identifiers return 404. Imported saved HTML is
bounded, scriptless and permits fragment navigation only.

## Exact staging setup

Use the existing compass-web-preview service and its stable HTTPS origin. Keep
the public production service unchanged. Provision configuration through secure
Railway settings; never paste secret values into chats, commits or logs.

| Name | Purpose |
| --- | --- |
| COMPASS_ACCOUNT_MODE | staging; all other values keep accounts off |
| COMPASS_ACCOUNT_ORIGIN | Exact HTTPS preview origin, without path/query |
| COMPASS_ACCOUNT_DATABASE | Absolute SQLite path in the isolated preview container |
| BETTER_AUTH_SECRET | Random server-only secret, at least 32 characters; required except for the explicit disposable QA option below |
| COMPASS_ACCOUNT_EPHEMERAL_SECRET | Optional `1`: generate a server-memory signing secret for synthetic email-only, single-process staging when BETTER_AUTH_SECRET is absent |
| GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET | Optional owned Google OAuth application |
| GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET | Optional owned GitHub OAuth application |
| APPLE_CLIENT_ID / APPLE_CLIENT_SECRET | Optional owned Apple Services ID and valid signing secret |
| COMPASS_ACCOUNT_EMAIL_WEBHOOK_URL | Optional HTTPS transactional delivery endpoint |
| COMPASS_ACCOUNT_EMAIL_WEBHOOK_TOKEN | Optional delivery authorization secret |

The ephemeral-secret option generates 48 cryptographically random bytes inside
the server instance and never writes, logs or returns them. Only the mode name
is exposed. It requires explicit staging mode, a valid non-primary origin and an
absolute database path. Missing secrets still fail closed without this opt-in;
an empty or invalid supplied secret does not trigger a fallback. A configured
fixed secret always wins. Ephemeral mode refuses real email delivery and OAuth
credentials unless a fixed secret is supplied, because rotation would invalidate
their verification tokens and encrypted provider tokens.

Use this option only for disposable `.test` accounts in the existing preview,
with one replica. Every server-instance restart invalidates its old login
cookies, even if the SQLite file survives; synthetic accounts can sign in again.
It is unsuitable for production, shared replicas, real providers or durable
session guarantees. It provisions no external service or paid infrastructure.

For each configured social provider, register precisely
`<preview-origin>/api/auth/callback/google`, `/github`, or `/apple`. Configure the
provider's consent screen, allowed testers and Apple signing-key expiry. OAuth
sign-in does not grant access to GitHub repositories or productivity tools.

With no email delivery, the isolated preview permits only reserved .test email
registration. These are unverified test identities; password recovery and email
verification are not offered. Once real delivery is configured, registration
requires verification and Better Auth's actual verification/reset flows are enabled.
The webhook receives `{kind,to,subject,text}` with a verification/reset link, must
send it through an authorized transactional service, and must not log those links.
An HTTP 2xx alone does not prove delivery; test receipt and completion in a real inbox.

Real Google/GitHub/Apple OAuth and external delivery require their configured
applications and actual browser/inbox tests. Test fixtures alone do not prove them.
Use full Chrome/Edge for Google OAuth; embedded WebViews can be refused by Google.

## Data, usage and operations

SQLite supports actual restart persistence only when the same database file is
retained. A Railway container file can disappear on redeploy: the UI therefore
calls these preview saves and asks users to export work. No volume, managed DB,
paid service or production migration is provisioned by this slice. Durable
production storage needs a separately reviewed database/backup/retention rollout.

Profile preferences and explicitly saved projects are owner-scoped. Saved projects
retain bounded revision snapshots; deleting one is explicit. Device-local saves
remain independent. The schema supports a future opt-in import without deleting
the local original. There is no cloud synchronization claim.

Each private build has an owner-scoped idempotency key and request hash. Repeated
successful requests return the saved exact result, including after restart; a
conflicting payload is rejected. A lost response can be retried without a second
model generation; completed receipts are retained for 24 hours, attempt receipts
for seven days. Failed operations do not masquerade as completed builds. Open tabs
bind their expected owner and clear private output if another tab changes accounts.

Actual provider attempts are recorded with upstream token/cache counters and
metadata, including failures and fallback attempts. Missing usage remains unknown.
Prepared builds create no model receipt. No credit balance, token estimate, price,
financial deduction or paid billing is invented. See AI_USAGE_NEXT.md. The Usage
panel shows the current user's records; administrator-wide controls remain future
work and must have explicit authorization and role checks.

## Further increments

1. Configure and verify social applications and actual verification/recovery email.
2. Review durable storage, backups, deletion/retention and private artifact delivery
   before enabling production accounts or promising cross-device persistence.
3. Use measured model and infrastructure costs to define credits and a transactional
   reservation/debit/reversal ledger before enabling paid plans.
4. Add scoped GitHub/project export and one verified customer-requested tool using
   official OAuth/API authorization, encrypted tokens, consent and disconnect.
5. Introduce isolated code execution/build hosting before any full-stack generation.
   Generated code must never execute in the delivery server.

No decorative integration controls or conceptual signup/demo are presented as
working product features. The approved historical promo remains clearly labelled.

## Sources

[Better Auth SQLite](https://better-auth.com/docs/adapters/sqlite),
[session management](https://better-auth.com/docs/concepts/session-management),
[account linking](https://better-auth.com/docs/concepts/users-accounts),
[security](https://better-auth.com/docs/reference/security).
