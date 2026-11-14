# Account email delivery

`compass/account/email.mjs` sends verification, password-reset and email-change
confirmation messages. It runs only on the server; no provider key, sender,
recipient, delivery payload or provider response is added to public configuration
or logged by this adapter. Better Auth creates and validates each link token.

## Existing Resend account

Reuse the owned Resend account with a dedicated COMPASS sending key. Do not copy a
different application's API key. In Resend, verify an owned sender domain such as
`auth.mycompass.world`, then create a sending-only key restricted to that domain.
Configure these variables only in the COMPASS Railway service's protected settings:

| Variable | Value |
| --- | --- |
| `COMPASS_ACCOUNT_EMAIL_PROVIDER` | `resend` |
| `COMPASS_ACCOUNT_EMAIL_FROM` | Authorized sender, for example `COMPASS <accounts@auth.mycompass.world>` |
| `RESEND_API_KEY` | Dedicated COMPASS sending key |

The example sender is a proposed address; its domain must actually be verified
before use. Keep the existing mailbox MX records. Apply the specific Resend DNS
records to the sending subdomain, preserving any existing SPF policy rather than
creating competing SPF records. Disable click/open tracking for authentication
emails. Domain verification and configuration completeness alone do not prove
delivery to a real inbox.

The adapter posts only `from`, `to`, `subject` and plain `text` to the fixed
`https://api.resend.com/emails` endpoint. It requires a successful API response
with an accepted message ID, rejects redirects and bounds each request to eight
seconds. It does not retry or interpret acceptance as inbox delivery. Invalid or
incomplete explicit Resend settings fail closed and never fall back to a webhook.

## Existing authorized webhook

Existing deployments can keep `COMPASS_ACCOUNT_EMAIL_WEBHOOK_URL` and optional
`COMPASS_ACCOUNT_EMAIL_WEBHOOK_TOKEN`. Leave the provider unset or select
`COMPASS_ACCOUNT_EMAIL_PROVIDER=webhook`. The URL must use HTTPS with no embedded
credentials or fragment. The receiver gets `{kind,to,subject,text}` and, when
configured, a Bearer token. It must actually deliver the email; a receipt-only
endpoint does not implement verification or recovery. A Resend API URL cannot be
used directly as this webhook because Resend additionally requires a sender and
a different payload.

## Production evidence

After protected provider setup, receive and complete a verification link in an
actual inbox. Check that sign-in is refused before verification and works after
it; check that a completed link cannot be reused to change identity. Request a
password reset, complete it, and verify that the old password and revoked sessions
stop working. Change an email address and check old-address confirmation and
new-address verification. Check delivery failures without exposing tokens or
provider details in a public response. Use a dedicated test identity and keep
token-bearing links, inbox contents and credentials out of screenshots and logs.

Local tests inject the transport and synthetic messages. They validate the API
contract and failure handling without sending email; they do not prove a verified
domain, provider access or delivery.

Primary references: [Resend send API](https://resend.com/docs/api-reference/emails/send-email),
[domain verification](https://resend.com/docs/dashboard/domains/introduction),
[scoped API keys](https://resend.com/docs/dashboard/api-keys/introduction),
[Better Auth email](https://better-auth.com/docs/concepts/email).
