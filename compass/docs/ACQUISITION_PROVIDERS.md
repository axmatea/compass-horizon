# Acquisition providers

Implementation verified with offline injected-fetch tests on 2026-09-25. No paid
inference/search/analytics call, deployment, credential creation, or resource
provisioning was performed. Documentation and public model metadata research are
not a live integration receipt. No secret files were read.

## Contract and safety boundary

```js
import { createProviders, ProviderError } from '../server/acquisition/providers/index.mjs';
const providers = createProviders({ env: process.env, fetchImpl: fetch });
providers.status();
// [{name: 'Nimble'|'Liquid AI'|'Tinybird', status: 'BLOCKED'|'CONFIGURED',
//   operation: 'research'|'extract'|'metrics', reason: string}]
```

Construction and `status()` make **zero network calls**. `CONFIGURED` means only
that configuration passes local validation, not that credentials, models,
permissions, resources, billing, or availability have been verified. Missing or
invalid configuration is `BLOCKED`; there is no mock, fixture, offline AI,
alternate-model, or alternate-provider fallback. Recreate the factory after
changing environment configuration.

The main worker owns `ACQUISITION_SPONSOR_CALLS_ENABLED`, default **false**, and
must gate every operation (including model discovery). Adapters do not duplicate
that spending gate. The public demo must never call these methods. A future
explicitly authorized stage workspace can submit `DEMO` metrics; mode must come
from the trusted workspace, never a browser override.

All three async methods return `{ result, receipt }`. `requestId` is accepted for
the caller's durable correlation but is **not forwarded or echoed**. A request ID
is not an upstream idempotency guarantee.

```ts
type Receipt = {
  provider: 'Nimble' | 'Liquid AI' | 'Tinybird';
  operation: 'research' | 'extract' | 'metrics';
  model?: string; // configured Liquid model identifier, never a token or host
  status: 'completed' | 'blocked' | 'failed';
  at: string; // local ISO completion/validation timestamp
  durationMs: number; // elapsed locally, includes model preflight / analytics query
};
```

`ProviderError` exposes a fixed safe `message`, `code`, `reasonCode`, `status`,
optional numeric `httpStatus`, and `receipt`. Configuration and unavailable
model/capability errors have `code: 'BLOCKED'`, `status: 'BLOCKED'`. Other codes
are `INVALID_INPUT`, `PROVIDER_TIMEOUT`, `PROVIDER_NETWORK`, `PROVIDER_HTTP`,
`INVALID_RESPONSE`, `RESPONSE_TOO_LARGE`, `INGEST_NOT_ACKNOWLEDGED` with
`status: 'FAILED'`. Upstream text, URLs, headers, causes, request bodies and raw
errors are never attached or logged. A blocked receipt records an attempt that
did not complete, **not** a fabricated upstream success. Successful receipts
are emitted only after validated HTTP results.

Each HTTP request has an abortable deadline covering headers and response body,
redirects disabled, JSON content-type checks, and a 4 MiB response cap. The
timeout also rejects an injected fetch that ignores cancellation. No automatic
retries: transport failures may have completed upstream, and paid requests must
not be repeated speculatively. The parent owns leases, durable checkpoints,
uncertain-outcome recovery, idempotency, and safe user-facing persistence.
Extraction and metrics each make two sequential HTTP requests (up to 40 seconds
at defaults); keep the parent's lease longer than the full operation budget,
especially if overriding the timeout.

## Environment

All values are server-only, never `VITE_*`, never return them in status.

| Variable | Requirement / meaning |
| --- | --- |
| `ACQUISITION_SPONSOR_CALLS_ENABLED` | Parent-owned authorization gate, default false. |
| `ACQUISITION_PROVIDER_TIMEOUT_MS` | Optional integer 1-120000; default 20000 per HTTP request. Tinybird uses at least 10000. |
| `NIMBLE_API_KEY` | Required Nimble SDK bearer token. No endpoint override. |
| `LIQUID_BASE_URL` | Required explicit OpenAI-compatible API base ending in `/v1`; no credentials, query or fragment. |
| `LIQUID_MODEL` | Required exact catalog ID beginning `LiquidAI/LFM` or `liquid/lfm`. No implicit default or alias discovery. |
| `LIQUID_API_KEY` | Required for authenticated hosts. Does not reuse any other provider's environment key. |
| `LIQUID_AUTH_SCHEME` | `Bearer` (default), `Key` (Fal), or `none` for loopback only. |
| `LIQUID_ALLOW_LOCAL_HTTP` | Literal `true` permits HTTP only for localhost, 127.0.0.1, or ::1; never remote plaintext. |
| `TINYBIRD_HOST` | Required region origin, HTTPS on `api.tinybird.co` or a `*.tinybird.co` host; no path, credentials, query or custom port. |
| `TINYBIRD_APPEND_TOKEN` | Required, scoped `DATASOURCE:APPEND` on the deployed source only. No CREATE/admin scope needed. |
| `TINYBIRD_READ_TOKEN` | Required, read-only access to the deployed source for the backend Query API. |
| `TINYBIRD_HASH_KEY` | Required secret of 32+ characters; operator supplies high-entropy key. Must remain stable across replicas/restarts. |
| `TINYBIRD_DATASOURCE` | Optional SQL identifier; default `acquisition_lead_versions`. Custom names must refer to the identical deployed schema. |

Environment configuration is trusted operator input, not client input. Custom
Liquid HTTPS hosts are intentional operator-selected egress destinations; this
is not a generic URL-fetch endpoint. Their retention/security policy still
requires approval. There is no automatic provisioning or model download.

## Nimble research

`await providers.research({ query, requestId })` sends one bearer-authenticated
`POST https://sdk.nimbleway.com/v2/search`. This is the **current v2 Search API**,
not the older SDK v1 search or unrelated Nimble CRM. Uses `search_depth: lite`,
`focus: general`, `max_results: 10`, `full_content: false`, and plain-text output.
Query must be 1-2000 characters. [Official Search API](https://docs.nimbleway.com/api-reference/search/search)

The result is `{ sourceURLs: string[], facts: { sourceUrl, title, text,
evidenceType: 'search_snippet', verified: false }[] }`. Source links must be
HTTP(S) without URL credentials. Nothing follows those links or executes result
text. Search snippets are attributed observations, **not independently verified
facts**. Empty results stay empty. Do not send private lead intake in a public
web search; the caller owns query consent and data minimization.

## Liquid structured extraction

`await providers.extract({ text, requestId })` returns `{ fields, validated: true,
requiresReview: true }` with exactly the five contract fields. Null stays null;
numeric strings, extra keys, malformed JSON, invalid ranges, truncated output,
refusals, tool calls, and another model's completion are rejected. Budget is
0-1e12 and timelineDays an integer 0-36500, or null; problem is nonblank text up
to 2000 characters or null. Input is limited to 24000 characters. Output is
capped at 2048 tokens; long reasoning can therefore fail closed as truncation.

Every extraction first requests `GET <LIQUID_BASE_URL>/models` and requires the
**exact configured ID**. OpenRouter must advertise both `structured_outputs`
and `response_format`. Hosts that publish `supported_parameters` must also
advertise both; ordinary self-hosted OpenAI `/models` lists often omit that
metadata, so schema support is confirmed only by the subsequent successful
schema-conforming completion. This verifies host-advertised availability, not
cryptographic model-weight provenance. Model listing is a network call, not a
pure local check; billing for an arbitrary configured host is **uncertain**.
Do not probe `/models` before the same approval gate used for inference. No
configured-host preflight/inference calls were run during this implementation.

`POST <base>/chat/completions` uses a strict `response_format.json_schema`, no
tools, no streaming, and separate system/untrusted-user messages. Local schema
validation always runs, even if the host claims strict mode. OpenRouter adds
`require_parameters: true`, `allow_fallbacks: false`, `data_collection: deny`.
The response model must match; OpenRouter may omit the requested `:free` routing
suffix, but cannot substitute a different model. [OpenRouter structured output](https://openrouter.ai/docs/guides/features/structured-outputs),
[vLLM structured output](https://docs.vllm.ai/en/latest/features/structured_outputs/)

For private production text, the recommended path is an **already authorized**
self-hosted Liquid model behind HTTPS, e.g. a vLLM service advertising
`LiquidAI/LFM2.5-1.2B-Instruct`. Liquid's official guide confirms the
OpenAI-compatible serving route, not a universal Liquid-hosted inference URL.
Fal deployments use their explicit deployment URL and `Key` authorization.
[Liquid vLLM guide](https://docs.liquid.ai/deployment/gpu-inference/vllm),
[Liquid Fal guide](https://docs.liquid.ai/deployment/gpu-inference/fal)

As of this research date, OpenRouter's public catalog lists
`liquid/lfm-2.5-2.6b:free` at `https://openrouter.ai/api/v1` with structured
outputs. Its model page warns that prompts/outputs may be retained for
training. This is **not a privacy-approved production recommendation**, and the
adapter's deny-collection setting may leave no eligible endpoint. Do not remove
that guard to get a green demo. Catalog/model availability can change; recheck
on an authorized call, never silently switch models. [Official model page](https://openrouter.ai/liquid/lfm-2.5-2.6b:free),
[Models API](https://openrouter.ai/docs/api-reference/models/get-models)

`validated` means schema-valid, not factually true or prompt-injection-proof.
Do not auto-apply output or treat `businessFit` as computed qualification.
Preserve the review step; unsupported/ambiguous source facts should be null.
No model-generated command, URL, or extra field is executed.

## Tinybird current-lead metrics

`await providers.metrics({ rows, requestId })` accepts 1-5000 **server-derived**
rows, all for exactly one tenant and one mode:

```ts
type LeadVersion = {
  tenantId: string;
  leadId: string;
  version: number; // positive safe integer, incremented on EVERY canonical change
  experimentId: string | null;
  status: 'QUALIFIED' | 'NEEDS_CONTEXT' | 'NOT_ICP';
  mode: 'LIVE' | 'DEMO';
  deleted?: boolean; // true is a tombstone, requires a newer version
};
```

IDs must be nonblank and at most 200 characters. Extra fields are rejected,
including names, email, raw text, problem, budget, and the original lead object.
Do not spread canonical lead objects into this call. Mixed tenant/mode batches
and conflicting content for the same lead+version are rejected before HTTP.
The main DB increments version on every canonical/rules/attribution change;
updated-at clocks are not used to order mutable lead states.

Only eight values leave the adapter: `tenant_key`, `lead_key`, `mode`, `version`,
`experiment_key`, `qualification`, `deleted`, `event_id`. IDs become
domain-separated HMAC-SHA256 hashes scoped to tenant **and mode**. Missing
attribution is the empty experiment hash. `event_id` is a deterministic HMAC of
the normalized state and version, independent of request ID, send time, object
key order, retries and process restarts. This is **pseudonymization**, not a
claim of irreversible anonymization or regulatory exemption. No direct PII,
budget, raw source text or model output is sent to Tinybird.

The adapter posts NDJSON to `/v0/events?name=<source>&wait=true`. It requires
HTTP 200, the exact successful row count and zero quarantined rows. HTTP 202 is
not enough. Tinybird documents `wait=true` as a committed-write acknowledgement
and recommends a timeout of at least ten seconds. Events API is not itself
idempotent. [Events API reference](https://www.tinybird.co/docs/api-reference/events-api),
[Write acknowledgement](https://www.tinybird.co/docs/forward/ingest-data/events-api)

After acknowledgement, it makes a **real** `POST /v0/sql` using the separate read
token and form-encoded fixed SQL. Only a validated resource identifier, generated
64-hex tenant hash and fixed mode enum enter SQL, never a user string. The query
groups by tenant+lead and chooses one whole tuple with
`argMax(tuple(experiment_key, qualification, deleted), tuple(version, event_id))`,
then removes tombstones and aggregates current states. Retries, delayed older
versions and duplicate events do not inflate lead counts. A deterministic hash
tie-break handles cross-batch version collisions; equal versions with differing
states are still a **parent data-integrity bug**, not an approved update path.
[Query API](https://www.tinybird.co/docs/forward/query-data/sql-api),
[Deduplication guidance](https://www.tinybird.co/docs/forward/guides/deduplication-strategies)

Result is the canonical metrics object with `source: 'Tinybird'`. Totals are
summed from validated **remote grouped counts**, never manufactured from local
row length. Hashes are mapped back to caller-known experiment IDs locally.
Unknown returned experiment hashes, inconsistent totals and invalid counts
fail closed. Send the complete current tenant lead snapshot so all current
experiment IDs are known. An empty workspace stays local PostgreSQL: an empty
array cannot safely infer tenant scope. No winner or causal lift is inferred;
`sampleStatus` remains `insufficient_evidence`.

Deletion requires explicit persisted newer tombstones before removing leads
from synchronization. Absence from a later snapshot does **not** delete remote
rows. Changing the hash key requires a deliberate migration/rebuild; otherwise
historical state becomes a different identity space. With an ingestion success
and later query failure, no successful metrics receipt is returned. A parent-
approved retry may resend identical rows; query-time dedup handles them, but
the storage/ingestion cost is real. Physical deletion and retention are separate
operator workflows, not implemented by a metrics call.

## Deployment and verification

Tinybird datafiles and an equivalent parameterized endpoint pipe are in
`server/acquisition/providers/tinybird/`. See its `README.md` for the controlled
deployment and smoke-test checklist. The adapter currently uses the backend
Query API, not the published pipe. The pipe is supplied for a reviewed migration
to an endpoint contract; no SQL, credential or broad workspace access belongs
in the browser. Both paths use the same latest-per-lead rule.

Run only offline tests, without `.env` loading:

```sh
node --test test/acquisition-providers.test.mjs
```

Tests use injected fetch and synthetic credentials, covering success, missing
config, API/network errors, bounded bodies/deadlines, schema rejection, prompt
and SQL injection boundaries, ack failures, duplicates, version ordering,
tombstones, and LIVE/DEMO/tenant isolation. They are not vendor conformance
tests: no Tinybird server parsed or executed these datafiles in this task, no
configured Liquid model ran inference, and no Nimble search was submitted.
The authorized deployment smoke test remains a release gate.
