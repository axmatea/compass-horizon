# Credit accounting and Stripe test billing

13 November 2026. This is implemented server-side code with local financial and
provider-stream regression tests. **No live charging path exists.** No Stripe
account, price, subscription, payment or provider call was created during this
work. Real Stripe test-account credentials and approved commercial inputs are
still external setup requirements; SDK-signed fixtures do not prove a real
checkout, portal, card payment or webhook delivery.

## Activation and external requirements

Default-off `createBilling({database,env,stripeClient?,now?})` uses the already-open
account SQLite database. With no explicit test mode, valid policy or database,
it creates no billing tables and returns null balances, empty offers and exact
blocked-reason codes. It never manufactures a free credit balance.

Required server configuration:

| Input | Requirement |
| --- | --- |
| `COMPASS_BILLING_MODE` | Exactly `test`. `live` is refused. |
| `COMPASS_CREDIT_POLICY_JSON` | A founder-approved versioned policy with the fields below. No numerical economics are bundled as defaults. |
| `COMPASS_BILLING_ORIGIN` | Exact reviewed staging origin, matching `COMPASS_ACCOUNT_ORIGIN`; no credentials, query, hash or non-root path. HTTPS, except local development. Main domains are refused. |
| `STRIPE_SECRET_KEY` | A test secret (`sk_test_`), provisioned securely. A live key cannot activate this adapter. |
| `STRIPE_WEBHOOK_SECRET` | Separate test endpoint signing secret (`whsec_`), provisioned securely. |
| Stripe prices and portal | Existing approved test prices must match the catalog; configure the Stripe test portal and restrict it to the supported products/actions. |
| Durable storage | An owned durable database location, backup/restore and financial retention policy before customer billing. Ephemeral Railway files are not reliable financial storage. |

The policy requires `version`, `currency:"usd"`, positive integer
`creditUnitCostMicros`, positive integer `maxOperationCostMicros`, explicit
`rounding:"ceil"`, a `creditFeatures` allowlist, exact `rates`, and an `offers`
array. Monetary policy values use integer micro-USD; Stripe prices use integer
USD cents. Rates are micro-USD **per million tokens**, keyed by exact provider
and model, with the correct `inputTokenBasis`. Input/output rates are mandatory;
cache read, generic write and 5-minute/1-hour write rates are required when those
measured categories affect the operation. A reported versioned model does not
silently inherit a different alias's price.

Each offer specifies `id`, `kind` (`credits` or `subscription`), `priceId`, integer
`credits`, `unitAmount`, `currency:"usd"`, and a feature allowlist. Subscriptions
also specify `interval` (`month` or `year`) and `intervalCount`. The server fetches
the actual test Price and checks active state, currency, amount and interval
before creating Checkout. Only one approved price/quantity per checkout/invoice
is supported. Trials, discounts, taxes, currency conversion, proration and plan
upgrades are not silently mapped to a credit grant; mismatched events fail closed.

Commercial approval must cover actual provider rates, infrastructure measurement,
credit unit value/rounding, bundle and subscription economics, rollover/refund
terms, supported entitlements and spending caps. The local test values are marked
synthetic and are not a recommendation or deployment configuration. Provider fees,
tax accounting and revenue recognition are not inferred from gross payments.

## Ledger behavior

`billing_ledger` is append-only. Transactions use `BEGIN IMMEDIATE`; when composed
inside an account transaction they use a savepoint, preserving atomic rollback.
SQL triggers also protect usage receipts and original reservation terms. Financial
records have no automatic deletion/pruning. Every lookup includes the verified
owner, and persisted receipt IDs and financial references prevent double writes.

1. `reserve(owner,operationId)` atomically checks entitlement and available
   credits, then holds the approved maximum operation amount. Replays return the
   same reservation; another owner receives 404. The agreed policy is snapshotted.
2. `recordUsage(owner,operationId,event)` stores allowlisted measured metadata.
   Same-ID/same-content writes replay; conflicting content/owners are rejected.
3. `settle(owner,operationId,{success,infrastructureCostMicros})` uses exact integer
   arithmetic and the original policy. The infrastructure amount must come from
   a trusted actual measurement. Unknown is null, not a default zero.
4. A successful operation with complete measured costs consumes only its actual
   rounded credits and releases the remaining hold. Unknown costs or incomplete
   stream usage stay `pending_review`; costs over the authorized cap stay
   `overage_review`. Neither silently overdraws credits. Further consumption is
   blocked until server/admin reconciliation.
5. Failed generations release the entire hold and preserve the platform's measured
   provider-cost record. A prepared fallback after an AI failure is not charged
   as a successful AI generation. Server/admin credit reversals are idempotent.

Anthropic input counters exclude cached input; compatible prompt counters include
it. Cached and reasoning tokens must not be added twice. Missing breakdowns are
unknown unless approved identical/zero rates make that missing category irrelevant
to the exact cost. Input/output counts still must be reported. See
[Anthropic usage](https://platform.claude.com/docs/en/api/typescript/messages) and
[Chat Completions usage](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).

Outstanding reservations after a process failure must be reconciled against the
provider before charging. There is no unsafe automatic release that assumes an
interrupted paid request was free. `reverse` and `grant` are trusted server/admin
operations, not user-selected amounts or self-service refund endpoints.

## Stripe transport and lifecycle

The official `stripe@23.1.0` SDK handles test API calls and raw-body signature
verification. The adapter bounds webhook bodies and checks signature age/future
timestamps, event IDs, test mode and merchant scope before any API retrieval.
It retrieves current Stripe objects, rather than granting from redirects or
trusting an out-of-order snapshot. Duplicate deliveries and distinct events for
the same payment cannot duplicate a grant. Event hashes are stored; raw payment
payloads, card data and addresses are not. This follows Stripe's
[raw-body verification and duplicate/out-of-order guidance](https://docs.stripe.com/webhooks).

Credit purchases grant only after an approved owner-bound checkout is complete
and paid, with exact amount/currency and a PaymentIntent. Subscription checkouts
grant nothing by themselves: verified paid invoices create per-invoice credits.
Active, paid-through subscriptions provide only configured feature entitlements.
Scheduled cancellation retains already-paid access until expiry; payment failure,
terminal subscription state or fully refunded periods remove that access. See
[Stripe subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks).

Refunds reconcile per refund ID and payment. Pending refunds do not revoke
credits as if money had already returned. Succeeded amounts revoke the configured
proportion of the original grant, rounded cumulatively rather than per delivery.
Failed/canceled refund corrections restore any previous revocation. Refunding
already-consumed credits produces a visible credit shortfall and blocks further
usage; it never creates a cash charge. Fully refunded subscription invoices lose
paid-period entitlements, including after old invoice events repeat. This is
credit accounting, separate from actually initiating a money refund. Stripe's
[refund statuses and lifecycle](https://docs.stripe.com/refunds) remain authoritative.

Register the test webhook for checkout completion/async outcomes/expiry,
subscription creation/update/deletion/pause/resume, `invoice.paid`,
`invoice.payment_failed`, refund creation/update/failure and `charge.refunded`.
The raw HTTP endpoint is `/api/billing/webhook`. Normal authenticated billing
routes require owner verification and CSRF/origin checks; the signed webhook
does not use a browser session. Keep webhook endpoint/API versions and portal
configuration under review when upgrading Stripe.

## Router contract

```js
const billing = createBilling({ database: identity.database, env });
const state = { status: billing.status(), account: billing.account(owner) };
const held = billing.reserve(owner, operation.id);
const result = await withUsageTracking(event => {
  store.recordUsage(owner, operation.id, event);
  billing.recordUsage(owner, operation.id, event);
}, () => runtime.runTurn(...));
// Commit application result, operation receipt and settlement atomically.
billing.settle(owner, operation.id, {
  success: result.source === 'model',
  infrastructureCostMicros: measuredInfrastructureOrNull,
});
```

`checkout(owner,{offerId,requestKey})`, `portal(owner)`, and
`cancel(owner,{subscriptionId,requestKey})` return only approved Stripe URLs and
owner-bound results. The client never supplies price, credits, customer, callback
URL or subscription ownership. Keep checkout idempotency keys through retries.
`webhook(rawBuffer,signature)` receives exact bytes before JSON parsing.
`monitor()` provides aggregate counts without prompts, emails or owner IDs; the
router must restrict it to verified administrators.

## Actual Anthropic provider streaming

`ANTHROPIC_STREAMING=on` explicitly sends `stream:true` and consumes provider SSE
inside the server. JSON mode and other providers retain their behavior. The
parser handles fragmented UTF-8, message/content lifecycle, thinking/signature
deltas, pings and forward-compatible event types. It never executes a streamed
tool block. Usage deltas are cumulative, not additive. No partial structured JSON
is accepted without a valid terminal `message_stop`; schema validation still
happens through `completeJson`. See the official
[Anthropic streaming protocol](https://platform.claude.com/docs/en/build-with-claude/streaming).

The shared request deadline covers body reads, including cancellation. The parser
bounds bytes (512 KiB by default, at most 1 MiB), events and blocks, and rejects
malformed/incomplete sequences. Provider errors use the existing bounded fallback.
Receipts contain `usageComplete:false` for interrupted or non-final usage. A valid
terminal message without final usage can deliver content, but its partial counters
are never billed as final usage. Raw text, thinking, signatures and credentials
remain out of accounting events/logs. The browser receives application progress
events and validated page output, not unvalidated provider tokens.

No Anthropic key was provisioned or paid call made. Real-provider SSE verification
remains blocked until an authorized key/model and spending budget are supplied.

## Verification and recovery

Local tests cover ledger/receipt replay, policy snapshots, transaction rollback,
owner isolation, unknown cost, overages, failure release, reversals, cache/TTL
costs, SDK-generated webhook signatures, bad/tampered/old/future/live events,
price/owner/amount mismatches, pending/failed/paid payments, subscription expiry
and cancellation, out-of-order events, cumulative partial/full/failed refunds,
spent-credit shortfalls and paid-period entitlement revocation. Provider tests
also exercise fragmented real SSE frames, terminal validation, errors, resource
limits, cumulative usage and cancellation. All upstream transport is mocked.

Before real Stripe test-account approval, complete an actual browser checkout,
webhook delivery, paid subscription renewal/failure, cancellation, refund and
cross-account test with that account. Before any future live implementation,
obtain explicit financial authorization, approved commercial terms, durable
storage/restore evidence and provider-billing reconciliation. Rollback disables
the module or restores the prior image; it must not delete financial records.
