# COMPASS template marketplace

The founder's current direction replaces the prompt-first homepage with a small,
white template storefront. The existing Builder, reference planner, accounts,
private projects and Studio remain available. Shared `/?start=app` links open
the reference planner in Builder without generating or replacing a draft.

The initial catalog contains three original website templates (Atlas, Forma and
Mono) and three mobile template families (Pulse, Field and Venue). Each mobile
family includes a responsive web edition and editable Expo / React Native source
for iOS and Android. These are starters, not published apps or connected services.
The native packages have source and behavior checks; a simulator/device build is
not verified by a browser preview. Package dependency provenance is included in
the source bundles.

Every browser preview uses engineer-authored code. Websites are scriptless;
interactive mobile web previews allow only their exact trusted script hash in an
opaque iframe. Network access, form submission, remote resources and external
framing are blocked. Demo selections and records stay in memory and reset on
reload. Venue reviews a local selection; it never books a real appointment.

Public read-only API:

- `GET /api/templates` returns the catalog and `purchasesEnabled:false`.
- `GET /api/templates/:id` returns the allowlisted product.
- `GET` or `HEAD /api/templates/:id/preview` serves the isolated real preview.
- `POST /api/templates/:id/checkout` returns `503 purchases_not_enabled`.

Checkout remains closed even if the existing credit/subscription billing
configuration changes. Client prices, external redirect URLs and supplied
purchase flags cannot create charges or grant downloads. Paid-source download
routes are absent. Catalog prices are `null`; no prices, orders, customer counts,
reviews, sales or commercial licenses are invented.

`marketplace/delivery.mjs` prepares deterministic source bundles internally. It
does not make them publicly downloadable or imply that a purchase occurred.
Preview-only license notices explicitly leave commercial terms unapproved.
Delivery source is outside Vite's public assets; only catalog metadata and the
storefront UI are client-bundled.

Payments stay off. Selling will require founder-approved prices and license /
refund terms, a verified merchant, a dedicated template-order and entitlement
flow, verified Stripe webhooks, protected delivery and an end-to-end purchase
test. The existing build-credit ledger is not a template ownership ledger.

Pricing research: the official Framer marketplace lists free and paid templates,
including individual offers at $29, $59, $79 and $149 as checked on 18 November
2026: <https://www.framer.com/marketplace/templates/>. A possible COMPASS launch
offer is $29 per website and $59 per mobile family (web + iOS/Android source),
one-time. This is a proposal only, not approved or displayed as a live price.
