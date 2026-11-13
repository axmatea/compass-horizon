# Limited-access preview design (superseded)

Historical 12 November research. The founder's 13 November brief and provider
choice supersede this Clerk proposal. Current implementation uses the previously
used Better Auth library; see [account foundation](ACCOUNT_FOUNDATION.md).
Clerk was not installed or enabled.

Research checked 12 November 2026. This is a concrete follow-up design, **not an
implemented account system**. Public `/`, `/demo`, `/plan` and `/studio` remain
available. Projects still save only in the current browser; no cloud workspace,
cross-device project persistence or login is claimed by this release.

## Provider choice

Recommend **Clerk managed identity** for the first isolated preview: it supports
Vite/vanilla JavaScript through `@clerk/clerk-js` and a Node backend through
`@clerk/backend`. This avoids a React/Next.js migration and custom password
security. [JavaScript integration](https://clerk.com/docs/js-frontend/getting-started/quickstart),
[Node backend SDK](https://clerk.com/docs/reference/backend/overview).

Use its **Invite-only** access mode and email verification links initially.
Invitations are administrator-controlled; an uninvited visitor must not create
an account by bypassing the visible sign-in form. Enable OAuth only later if
the same invitation/entitlement checks apply to every identity path.
[Access restrictions](https://clerk.com/docs/guides/secure/restricting-access),
[email-link options](https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options).

| Alternative | Fit and tradeoff |
| --- | --- |
| Better Auth | Framework-agnostic and self-hosted; requires an owned session/user database and email delivery. Its vanilla client, Node handler and magic-link plugin fit the stack. `disableSignUp:true` prevents automatic account creation, but invitations and entitlements still need application policy. Prefer if owning the auth database is a requirement. [Node handler](https://better-auth.com/docs/integrations/express), [magic links](https://better-auth.com/docs/plugins/magic-link). |
| Supabase Auth | Managed magic links and administrative invitations; relevant if Supabase is also selected for future project storage. Disable public signup at the provider and use `shouldCreateUser:false` for sign-in; that client option alone is not an authorization boundary. A new data platform is unnecessary for the current local-only projects. [Passwordless flow](https://supabase.com/docs/guides/auth/auth-email-passwordless), [administrative invitations](https://supabase.com/docs/guides/auth/users). |

No provider application was created, paid plan selected, email sent, secret read,
or production auth setting changed during this research. Provider selection and
configured staging credentials are required before real end-to-end verification.

## Concrete implementation boundary

Use a separate branch, proposed `codex/compass-invite-preview`, and an isolated
Railway preview with a stable HTTPS origin and separate provider application.
Keep `/demo` as the public limited demonstration. Add proposed `/preview` and
`/api/preview/*` for invited access; do not repurpose public session IDs as private
workspace IDs. These proposed routes do not exist in the current release.

Every protected request must verify the provider session on the server, then
check an active application entitlement. Derive the owner from verified `userId`;
ignore client-supplied owner/user/email fields. Authenticate with the official
backend SDK, accept session tokens only, restrict `authorizedParties` to the
exact preview origin, and verify the configured issuer/audience where applicable.
Do not trust a decoded JWT, a browser variable or the presence of a cookie.
[Request verification](https://clerk.com/docs/reference/backend/authenticate-request).

Provider identity sessions and COMPASS build sessions are different objects.
Attach an owner to every protected build/stream/HTML/export/history lookup;
return 404 for another user's resource. Protect all API paths independently of
the page route. Public fallback APIs must never become a bypass to protected
resources or extended model usage. Render generated HTML in the existing
scriptless sandbox; it must receive no auth cookie/token or provider SDK.

Use provider-managed session lifecycle and server verification rather than a
new homemade token/password scheme. Treat expiry/revocation/logout as denial,
not as a reason to accept stale identity. If introducing an application session
later, use a vetted library and server-side store with Secure, HttpOnly,
SameSite cookies, rotation and CSRF defenses; do not assume Clerk's browser
session token is an application-owned opaque HttpOnly session.

## Inputs required before the separate preview

- Selected provider and staging application; exact preview origin/callbacks.
- Staging-only `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`, provisioned through
  the secure environment flow. Only the publishable key may enter a client
  bundle; never prefix a server secret with `VITE_`.
- Approved invitation administrators and invited tester list, with a revocation
  procedure. Keep emails and administrative secrets out of the public repo.
- Explicit entitlements: allowed actions, expiry and model-request budget.
  Reserve usage atomically before invoking a model, keyed by verified owner.
- A durable shared entitlement/quota store selected before granting extended
  usage. In-process counters reset on deploy and do not enforce a multi-instance
  account budget. Do not provision storage or claim cloud project saving as an
  incidental part of identity setup.
- Email-link sender/branding, provider-supported callback behavior, allowed
  origins and required CSP/connect/frame hosts. Restrict additions precisely.

The preview feature must be off in production by default. Missing or invalid
auth configuration must fail closed for private endpoints while public pages
and the public demo continue working. Do not show a working-login claim until
the provider-backed flow is verified.

## Staging release gates

1. Test actual invited registration, email link, sign-in, expiry and logout in
   two independent browser profiles; confirm provider session verification.
2. Deny absent, forged, expired, revoked, wrong-issuer and wrong-origin tokens.
   Reject uninvited signup, expired/reused invitations and entitlement revocation.
3. User A must not read, stream, refine, export or resume B's build by changing
   URL/body IDs, including through public API aliases and direct page fetches.
4. Check CSRF/origin validation, redirect allowlisting, request limits, email-link
   throttling and atomic per-account usage limits. Fail closed when provider or
   entitlement storage fails; never log tokens, links or private prompts.
5. Confirm logout clears visible account content, private responses use
   `Cache-Control: no-store`, and pages do not leak data through shared caches.
   Do not silently migrate one shared browser's local projects into an account.
6. Run current install/check/test/build and all public demo, voice, export,
   device-save/history/mobile/fallback checks. Deploy only the separate preview,
   verify its exact revision and health, and retain the previous image.

Production enablement requires passing these real provider/data-isolation tests
and a reviewed rollout. Its rollback disables the private preview or restores
the prior image; it must not erase users, projects or provider state.
