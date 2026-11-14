# Production services

The founder authorized production accounts, cloud storage, OAuth and payments on
14 November 2026. The existing target remains Railway `compass-web`,
`https://mycompass.world`, repository `axmatea/compass-horizon`, branch `main`.
This document separates implemented support from verified provider activation.

## Provisioned and prepared

- A dedicated private 1024 MB volume, `compass-production-data`, is attached at
  `/data` in the existing production service. The storage deployment succeeded
  and the public health endpoint retained the current live builder revision.
- A dedicated fixed Better Auth secret was generated and stored directly in
  Railway protected server settings. No existing application credential was read
  or copied. Origin, database path, persistent-volume mode and trusted Railway
  public-ingress settings are prepared for the next deployment.
- The account database destination is `/data/compass/accounts.sqlite`. Production
  initialization verifies the actual Linux mount and private destination before
  creating an absent file or applying identity migrations. Existing files are
  inspected and never truncated or silently repaired.
- Production identity accepts only `https://mycompass.world`, a fixed secret,
  verified storage and real email delivery or a configured social provider.
  The default production database cap is 256 MiB; this 1 GB deployment explicitly
  uses 128 MiB to reserve snapshot and journal space. The 50-user QA cap applies only
  to staging. Missing production readiness makes `/healthz` return 503, so Railway
  cannot promote an account release with an unavailable identity store.

Production account mode is intentionally not enabled until provider setup can be
verified. Existing browser-local projects are never silently imported into accounts.

## Existing providers

Better Auth remains the identity library. Owned Railway applications demonstrate
existing Google OAuth and Resend use; their client-specific credentials must not
be copied into COMPASS. The COMPASS service had no account, mail, OAuth or Stripe
credentials at inventory. Resend and Stripe dashboards currently require sign-in.
The accessible Google Cloud project is unrelated to COMPASS.

Use COMPASS-specific clients and a dedicated Resend sending key in those owned
provider accounts. Store their values only in Railway server settings, never in
chat, source, screenshots, browser storage or a frontend `VITE_` variable.

| Provider | Exact production callback/configuration |
| --- | --- |
| Google | `https://mycompass.world/api/auth/callback/google` |
| GitHub | `https://mycompass.world/api/auth/callback/github` |
| Apple | `https://mycompass.world/api/auth/callback/apple`; owned Services ID and current ES256 client assertion |
| Resend | Dedicated verified sender and send-only key; see [ACCOUNT_EMAIL.md](ACCOUNT_EMAIL.md) |
| Stripe | `https://mycompass.world/api/billing/webhook`; exact merchant, matching live key, live webhook signing secret and approved live Prices |

Social-only configuration disables email/password endpoints and removes email
forms and recovery claims. Real email enables verification, password recovery
and email-change flows. Provider acceptance alone does not prove inbox delivery.
Apple state cookies support its cross-site POST callback; session cookies retain
SameSite=Lax, HttpOnly, host-only and Secure protection.

## Billing activation

The official Stripe adapter supports isolated test/live modes. A persisted
financial-store binding refuses moving an initialized ledger between Stripe
merchants or modes. Live readiness checks the actual merchant and approved Price
catalog, private persistent database, policy version and trusted cost-measurement
capability before presenting checkout offers. Checkout redirects never grant
credits; signed, mode-checked, idempotent webhooks do.

No commercial prices, subscription promises, credit rates or model-cost policy
were supplied for this rollout. These values are not invented. The existing
measured-credit policy also requires infrastructure measurement: current build
calls pass unknown cost, so an environment flag cannot make live checkout ready.
Confirm the commercial model before implementing and verifying its final charging
path. See [BILLING_COMPLETE.md](BILLING_COMPLETE.md).

## Recovery and verification

The current Railway plan requires Pro for native backups/schedules. No plan
upgrade was made. A dedicated private `compass-production-backups` bucket and
protected reference variables provide the prepared alternative. A separately
generated 32-byte encryption key remains in Railway server settings; no key was
printed or copied from another app.

With `COMPASS_BACKUP_MODE=encrypted-s3`, production startup creates an online
SQLite snapshot, streams AES-256-GCM encryption, uploads an immutable object,
downloads those actual bytes, authenticates/decrypts them and checks the restored
SQLite database. Production health waits for this first successful restore.
The server repeats backups every 24 hours, prevents overlapping jobs and drains
an active job before closing its database. Only seven matching older remote
snapshots are retained after the newest passes restore; unrelated objects remain
untouched. The local helper retains one snapshot on this bounded volume. Ciphertext
and disposable restore files use private temporary directories and are cleaned.

`account/backup.mjs` exports `decryptSnapshot` for an operator restoring a downloaded
encrypted object into an absent private destination. It authenticates the object
key and rejects tampering, wrong keys, excessive size, invalid SQLite and existing
destinations. It never restores a running production database automatically.
Preserve the encryption key separately through the owner's protected credential
recovery process before rotating it; old snapshots require their original key.

Tests use actual SQLite snapshots and an injected local S3 transport. They prove
the implementation's encrypted restore behavior, not live bucket access. Account
mode remains off while real provider sign-in is pending, so the first live cloud
backup and account save/redeploy/reopen verification remain outstanding.

Activation verification must include real provider login/logout, verification and
reset receipt where applicable, owner isolation, save/redeploy/reopen with the
fixed secret, a protected backup and restore, Stripe sandbox checkout/webhook/
portal, and exact production revision/assets. Live merchant setup and browser
consent remain distinct from fixture tests.

Primary references: [Railway private buckets](https://docs.railway.com/storage-buckets),
[volume backups](https://docs.railway.com/volumes/backups),
[Railway public headers](https://docs.railway.com/networking/public-networking/specs-and-limits),
[Better Auth](https://www.better-auth.com/docs/introduction),
[Stripe webhooks](https://docs.stripe.com/webhooks).
