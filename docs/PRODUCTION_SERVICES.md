# Production services

The founder authorized production accounts, cloud storage, OAuth and payments on
14 November 2026. The existing target remains Railway `compass-web`,
`https://mycompass.world`, repository `axmatea/compass-horizon`, branch `main`.
This document separates implemented support from verified provider activation.

## Verified production status — 16 November 2026

Production accounts are enabled with Google and email/password sign-in. Resend
email delivery is verified, and email verification and password recovery have
been tested. Explicit account saves use private persistent storage with a
verified encrypted S3 backup and restore. Payments remain off.

- A dedicated private 1024 MB volume, `compass-production-data`, is attached at
  `/data` in the existing production service. The storage deployment succeeded
  and production uses this mounted storage for account data.
- A dedicated fixed Better Auth secret was generated and stored directly in
  Railway protected server settings. Origin, database path, persistent-volume
  mode and trusted Railway public-ingress settings are configured.
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

Explicit signed-in cloud saves are separate from the public builder's
browser-local saves. Existing local projects are never silently imported into
accounts. Unconfigured account services remain off; the isolated staging preview
remains temporary unless durable storage is separately configured.

## Identity providers

Better Auth remains the identity library. Google and Resend email are configured
for production COMPASS. Email verification and password-recovery delivery and
flows have been tested.

Keep provider credentials in Railway server settings, never in
chat, source, screenshots, browser storage or a frontend `VITE_` variable.

| Provider | Exact production callback/configuration |
| --- | --- |
| Google | `https://mycompass.world/api/auth/callback/google` |
| Resend | Dedicated verified sender and send-only key; see [ACCOUNT_EMAIL.md](ACCOUNT_EMAIL.md) |

Social-only configuration disables email/password endpoints and removes email
forms and recovery claims. Production's verified email delivery enables email
verification, password recovery and email-change support. Session cookies retain
SameSite=Lax, HttpOnly, host-only and Secure protection.

## Billing activation

Production payments remain off. Provider setup does not enable checkout or
authorize charges.

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
protected reference variables provide the active encrypted backup destination.
A separately generated 32-byte encryption key remains in protected server settings.

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

Tests use actual SQLite snapshots and an injected local S3 transport. Production
has also completed an encrypted S3 upload/download and authenticated SQLite
restore check. This live recovery verification is separate from fixture coverage.

Future identity or storage changes must recheck sign-in/logout, verification and
reset receipt where applicable, owner isolation, save/redeploy/reopen with the
fixed secret, protected backup/restore and the exact production revision/assets.
Payments require their own Stripe checkout/webhook/portal verification before
activation. Live merchant setup and browser consent remain distinct from tests.

Primary references: [Railway private buckets](https://docs.railway.com/storage-buckets),
[volume backups](https://docs.railway.com/volumes/backups),
[Railway public headers](https://docs.railway.com/networking/public-networking/specs-and-limits),
[Better Auth](https://www.better-auth.com/docs/introduction),
[Stripe webhooks](https://docs.stripe.com/webhooks).
