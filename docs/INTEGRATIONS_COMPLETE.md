# Owner-scoped staging tool connections

Implemented in `compass/integrations/`. These are official OAuth/API adapters,
not engineer-account connectors or simulated connections. They are default off.
No live provider consent, API access, credentials, provider app creation,
production configuration, deployment, or spend was used to develop or test them.
The root agent owns HTTP/session/CSRF/UI integration; this change deliberately
does not edit those surfaces. A passing mock test does not verify live OAuth.

## Server contract

```js
import { createIntegrations, IntegrationError } from './integrations/index.mjs';
import { reviewGitHubExport } from './integrations/github-export.mjs';

const tools = createIntegrations({ database, env, fetchImpl: fetch, now: Date.now });
tools.status(verifiedSession.userId);
tools.connect(verifiedSession.userId, 'google-drive');
await tools.callback(verifiedSession.userId, 'google-drive', { state, code });
await tools.read(verifiedSession.userId, 'google-drive', {});
await tools.disconnect(verifiedSession.userId, 'google-drive');
```

`database` is the root's existing isolated staging `DatabaseSync` connection.
The module creates only its own three namespaced tables when enabled; it opens
no files itself. Use the staging account database's private file permissions
and backup policy. Container-local SQLite is not a durable cloud backup.
`env` defaults to an empty object, not `process.env`. Pass only the intended
server configuration. No `.env`, authentication cache, or connector credential
file is read by this module.

All methods require a validated server-session **owner ID string**. Never take
an owner from a request body, OAuth state, query string or provider identity.
`status` and `connect` are synchronous; other factory methods are asynchronous.
Failures expose `IntegrationError.status` and `.code`, with no upstream error
body, token, client secret or OAuth library cause. Do not log callback query
strings, authorization URLs, request bodies, Authorization headers, token
responses, prompts or raw exceptions from provider libraries.

Return status/read/disconnect responses with `Cache-Control: no-store`.
Render provider-derived text as text, never HTML, and never execute returned
content. Do not expose raw request/transport utilities through HTTP or to
generated code. The factory's six methods are the integration boundary.

## Configuration and exact external blockers

Required configuration, supplied by an authorized operator through the server's
secret mechanism (not from a browser or client-supplied token):

| Setting | Requirement |
| --- | --- |
| `COMPASS_INTEGRATIONS_MODE` | Exactly `staging` |
| `COMPASS_ACCOUNT_ORIGIN` | An exact origin with no path/trailing slash, query, fragment or credentials; HTTPS, or non-production HTTP loopback |
| `COMPASS_INTEGRATION_ENCRYPTION_KEY` | Canonical standard base64 encoding of **32 independently generated random bytes**; preserve securely across restarts |
| `COMPASS_GITHUB_CLIENT_ID` / `_CLIENT_SECRET` | Existing authorized test OAuth app or GitHub App user-authorization credentials |
| `COMPASS_GOOGLE_CLIENT_ID` / `_CLIENT_SECRET` | Existing authorized test web OAuth client; shared by the four separate Google grants |
| `COMPASS_NOTION_CLIENT_ID` / `_CLIENT_SECRET` | Existing public test integration configured with Read content capability only |
| `COMPASS_NOTION_READ_ONLY` | Exactly `true`, acknowledging the external Read content capability configuration |
| `COMPASS_SLACK_CLIENT_ID` / `_CLIENT_SECRET` | Existing test app credentials; the PKCE flow uses client ID rather than transmitting the secret |
| `COMPASS_SLACK_PKCE_ENABLED` | Exactly `true` only after PKCE has been enabled on that existing test app; HTTPS callback required |
| `COMPASS_GITHUB_APP_MODE` | Optional `true` for GitHub App user authorization: no OAuth scope request; externally configured selected-repository permissions apply |
| `COMPASS_GITHUB_PUBLIC_EXPORT` | Optional `true` permits a separate explicit export grant; never adds write scope by default |

`mycompass.world` and `www.mycompass.world` are refused. Missing/invalid global
configuration or database disables the module without creating tables.
Missing provider credentials or required external capability acknowledgements
return `external_blocked`, never a fake connection. The integration encryption
key is not derived from Better Auth/QA keys. A missing, changed or incorrect key
cannot decrypt a grant; access fails closed and the owner must reconnect.
There is no automatic key migration or secret recovery.

External setup remains unperformed: authorized test credentials, callback
registration, provider API enablement, Google test users/consent-screen and
restricted-scope requirements, GitHub selected repository/app permissions,
Notion read-only capabilities and page selection, Slack PKCE and workspace
installation approval, and a real owner completing each OAuth consent flow.
Do not create provider apps, change scopes, grant consent or enable billing as
an incidental implementation step. Google restricted-scope reviews/test-mode
token lifetimes and provider workspace policies may block live operation.
The authenticated engineering subscription is not end-user provider consent.

## OAuth callbacks and browser/session boundary

The exact callback for each canonical provider ID is:

```text
<COMPASS_ACCOUNT_ORIGIN>/api/account/integrations/<provider>/callback
```

Canonical IDs: `github`, `google-drive`, `google-sheets`, `gmail`,
`google-calendar`, `notion`, `slack`. Register each enabled callback with the
corresponding existing test provider configuration. Do not accept a callback
URL, discovery endpoint, redirect target, token URL or API base URL from clients.

The root must enforce its central same-origin/CSRF checks for connect,
disconnect, read and export. Its only external-entry exception is the exact
GET callback paths above, still requiring a verified database session plus
module state validation. Keep the account session cookie HttpOnly, host-only,
SameSite=Lax (Secure on HTTPS) so top-level GET callbacks retain the session.
Provider denial or a missing session must not establish a session or identity.
After success, redirect to a fixed local account page to clear code/state from
the address bar; never redirect to a client-provided return URL.

`connect` returns `authorizationUrl`, minimal scopes, plain permissions,
`expiresIn:600`, `requiresVerifiedSession:true` and `stateCookie:null`.
No additional state cookie is required: the cryptographically random state
is stored server-side with the verified owner/provider and exact redirect URI.
The root must not permit unauthenticated connect or callback execution.

State is hashed for lookup, also encrypted with the verifier/grant data, expires
after ten minutes, and is atomically consumed before token exchange. Every
lookup includes owner and provider. Reconnect replaces the outstanding flow.
`oauth4webapi@3.8.8` validates the exact state and authorization-code/token
responses. No `skipStateCheck`, `allowInsecureRequests`, or relaxed token
validation is used. PKCE S256 is required for GitHub, Google and the explicitly
PKCE-enabled Slack app. Notion documents no PKCE parameter; it uses confidential
client Basic authentication and its page picker. Notion's documented JSON
token request encoding is adapted before sending; a documented null optional
refresh token is represented as an omitted optional field, and all required
token fields are still validated by oauth4webapi. Slack's documented `bot` token
type uses the library's custom token-type handler, with `ok:true`, a bot token,
and no nested user access token required. Other token types are refused.

## Grants and bounded reads

| Provider | Exact OAuth scopes | `read(owner, provider, input)` |
| --- | --- | --- |
| GitHub OAuth app | `read:user`; separately approved export adds `public_repo` | `{}` lists up to 30 public repos; `{repository:'owner/name'}` reads public repo metadata |
| GitHub App | None; external selected-repository permissions | Same public-only metadata surface; never exposes private repo data |
| Drive | `https://www.googleapis.com/auth/drive.metadata.readonly` | `{}` returns up to 30 file IDs/names/MIME types/modified times; no content or download links |
| Sheets | `https://www.googleapis.com/auth/spreadsheets.readonly` | `{spreadsheetId,range:'Sheet1!A1:J20'}`; explicit rectangular range, at most 100 rows/20 columns/1,000 cells; each cell at most 1,000 characters |
| Gmail | `https://www.googleapis.com/auth/gmail.metadata` | `{}` lists at most 20 message/thread IDs; `{messageId}` returns labels and From/To/Subject/Date headers only; never bodies/snippets/attachments/send |
| Calendar | `https://www.googleapis.com/auth/calendar.events.readonly` | `{calendarId:'primary',timeMin:'2026-11-13T00:00:00Z',timeMax:'2026-11-14T00:00:00Z'}`; at most 31 days/30 event IDs, summaries, statuses and times |
| Notion | No OAuth scope parameter; Read content capability/page picker | `{pageId}` returns a selected accessible page title and at most 30 immediate blocks' text; no recursive crawl, file URLs or workspace-wide search |
| Slack | `channels:read` bot scope only | `{}` returns at most 30 public channel IDs/names/member counts; no topics, purpose, private channels, history, message bodies or sending |

All reads reject unknown fields, client tokens, caller URLs and pagination
inputs before outbound access. Pagination is reduced to `hasMore`; no raw
cursor or provider-returned URL is followed. Sheets ranges require simple A1
notation with an optional simple sheet name; entire-row/column ranges and
arbitrary formula/query expressions are refused. Google and Slack grants are
rejected if a returned scope set is broader or narrower than requested.
GitHub normalized comma-separated scopes are checked as a set. OAuth permits
scope omission when unchanged; in that case the requested scopes are retained.
Use separate test apps or revoke older broad grants before reconnecting;
providers can accumulate prior consent. Notion capabilities cannot be verified
from OAuth scopes, so the external read-only capability acknowledgement is a
configuration dependency, not a claim of a live permission inspection.

Access and refresh tokens are AES-256-GCM encrypted with fresh random nonces
and owner/provider/purpose associated data. They never appear in status, read,
callback, export or disconnect output. Expiring tokens refresh at a 30-second
margin using the official provider token endpoint and persistent refresh lease.
A replaced refresh token is encrypted before storage. Concurrent refreshes
across service instances are refused; failed refresh or HTTP 401 requires
reconnection and cannot borrow another owner's grant. Providers that return
no expiry remain usable until provider rejection or explicit disconnect.

Disconnect clears local credentials, invalidates pending flows and changes
the connection generation before making any revocation request. It also
blocks an already pending callback or refresh from restoring credentials.
In-flight external requests cannot be undone, but a disconnected read result
is refused before returning it, and subsequent requests are blocked.
Official revocation is attempted for GitHub, Google, Notion and Slack.
`remoteRevocation` is `revoked`, `failed`, `unavailable` or `not_needed`;
remote failure never restores local access. Google revocation can invalidate
the same user's other grants to that shared OAuth app; this is returned as a
notice. Pending/unknown provider exchanges cannot be certified remotely
revoked. An owner can also revoke the app directly in provider settings.

Each HTTP call has an eight-second deadline covering response-body consumption,
`redirect:'error'`, fixed HTTPS endpoint allowlisting and bounded buffering
(64 KiB for token/revocation responses, 1 MiB for read/export responses).
No arbitrary URL proxy, model call, discovery fetch, automatic retry, telemetry,
provider error echo or token logging is present.

## Reviewed GitHub export

The root UI must show actual files/diffs and the summary below, let the owner
choose the public test repository and existing feature branch, and obtain
explicit export confirmation. This module does not infer approval from file
content, prompts, OAuth state, account sign-in or a prior read grant.

```js
// After operator enables COMPASS_GITHUB_PUBLIC_EXPORT=true:
tools.connect(owner, 'github', { publicRepositoryExport: true });
// Complete the separate OAuth grant. OAuth apps request read:user public_repo.

const payload = {
  repository: 'owner/public-test-site',
  branch: 'compass/review-1',
  expectedHeadSha: '<40 lowercase hex characters>',
  requestKey: '<16-100 letters/numbers/underscore/hyphen>',
  files: [{ path: 'index.html', content: '<h1>Reviewed site</h1>\n' }],
};
const review = reviewGitHubExport(payload); // no I/O; paths, digests, byte count
// Root shows file contents/diff too, then passes the exact confirmed payload:
await tools.exportGitHub(owner, payload);
```

For a GitHub App, use selected public repositories and Contents read/write
permission in the existing test app; the user-authorization flow is compatible
with GitHub App user tokens and refresh tokens, with no private installation
token or JWT path. All exports still require the explicit export flag/grant,
public writable repo metadata, and confirmed feature-branch payload.

Exports accept 1–40 text files, at most 128 KiB per file/512 KiB total. They
refuse absolute/traversal/hidden paths, duplicate case-insensitive paths,
environment/key/credential/password/token paths, recognizable private-key/
common token content, workflow directories, deployment config and shell files.
This is conservative filtering, not a universal secret scanner: the root must
show and review the actual content before confirmation. Only a small text-file
extension allowlist is accepted; there are no delete/rename/executable modes.

The module refuses default/main/master/production/live/deploy/release/gh-pages
branches and checks the existing ref. The only mutation is GitHub GraphQL
`createCommitOnBranch` with **`expectedHeadOid`**, which atomically checks the
branch head and adds the commit. No force, merge, branch creation, publishing
or deployment API is used. Choose a test branch whose existing repository
automation cannot deploy production; commits can trigger pre-existing CI rules.

Owner/provider/request-key receipts contain hashes and bounded review/result
metadata, never file contents. Exact retries replay the successful receipt;
different payloads with the same key conflict. A failed/in-progress/uncertain
attempt is not automatically repeated. Network loss after a mutation is
explicitly uncertain: inspect the remote branch before making a newly reviewed
request with its current head. `clientMutationId` is correlation only; the
durable owner-scoped receipt and atomic head precondition enforce safety.

## Validation and primary references

Run on Node 22.23.4 (no HTTP listener or external request required):

```sh
node --test compass/test/integrations*.test.mjs
```

Tests use real in-memory and disposable on-disk SQLite plus injected mock HTTPS
responses for official endpoints. Coverage includes exact scope/callback/PKCE
requests, state replay/expiry/wrong owner/provider, no plaintext token storage,
key/AAD failures, restart, refresh rotation and concurrency, revoked credentials,
disconnect races/remote failures, fixed endpoint/redirect/size/deadline guards,
bounded reads, malicious URLs/paths and GitHub lease/idempotency/uncertain results.
No mock result is evidence of a completed provider connection.

- [oauth4webapi API](https://jsr.io/@panva/oauth4webapi/doc)
- [GitHub OAuth authorization](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [GitHub App user authorization](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- [GitHub OAuth token revocation](https://docs.github.com/en/rest/apps/oauth-applications)
- [GitHub atomic commit mutation and head precondition](https://docs.github.com/en/graphql/reference/commits)
- [GitHub file addition/base64 and branch input schemas](https://docs.github.com/en/graphql/reference/git)
- [Google server OAuth, refresh and revocation](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Sheets scopes](https://developers.google.com/workspace/sheets/api/scopes)
- [Gmail metadata format](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get)
- [Calendar events list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)
- [Notion OAuth authorization and refresh](https://developers.notion.com/docs/authorization)
- [Notion token response](https://developers.notion.com/reference/create-a-token)
- [Notion token revocation](https://developers.notion.com/reference/revoke-token)
- [Slack OAuth v2](https://docs.slack.dev/authentication/installing-with-oauth/)
- [Slack PKCE requirements](https://docs.slack.dev/authentication/using-pkce/)
- [Slack token rotation](https://docs.slack.dev/authentication/using-token-rotation/)
