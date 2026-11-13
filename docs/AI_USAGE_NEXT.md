# Measured AI usage

13 November 2026. The existing Anthropic/General Compute/Nebius clients and
provider fallback order remain in place. This adds operation-scoped accounting
to those clients without a provider SDK migration or new runtime dependency.
No real provider calls or production credentials were used for implementation.

## Integration

`compass/usage.mjs` is server-only. Wrap the entire awaited generation operation:

```js
import { withUsageTracking } from './usage.mjs';

const result = await withUsageTracking(
  event => store.recordUsage(ownerId, operationId, event),
  () => runtime.runTurn(sessionId, text, options),
);
```

The result is unchanged. AsyncLocalStorage isolates concurrent operations.
The persistence callback may be async. It receives one frozen final event for
each actual generation transport attempt, after the operation settles. Every
receipt is attempted even if an earlier persistence call fails; persistence
failures then propagate. An operation exception is rethrown after flushing; if
both the operation and sinks fail, an AggregateError contains those failures.

Bind verified owner and operation IDs in the caller, never from client-supplied
account fields. Store each event idempotently by its unique `id`; retries to
persist the same receipt must not duplicate it. A fresh provider request gets a
new receipt ID because it can consume additional tokens. Request-level replay
prevention and reservations belong in the authenticated operation/ledger layer.

Await the complete operation. Detached background work after the wrapper has
finished is not accounted. A started but unawaited attempt is marked
`incomplete`, never successful or free. These receipts are observability data,
not a durable pre-call reservation or complete payment ledger by themselves.

## Receipt contract

| Field | Meaning |
| --- | --- |
| `id` | UUID generated once per attempt; safe as a unique persistence key. |
| `provider` | `anthropic`, `generalcompute`, `nebius`, or `unknown`. |
| `model` | Validated requested model ID, including model-discovery retries. |
| `reportedModel` | Validated model ID supplied in the upstream response, or null. |
| `startedAt`, `durationMs` | Actual request start time and elapsed duration. |
| `httpStatus` | Actual observed HTTP status, or null if no response was obtained. |
| `status` | `accepted`, `rejected_shape`, `parse_error`, `http_error`, `network_error`, `timeout`, `aborted`, `completed`, `incomplete`, or `error`. |
| `inputTokenBasis` | `excludes_cache` for Anthropic; `includes_cache` for OpenAI-compatible clients. |
| `inputTokens`, `outputTokens` | Upstream counters, with the provider semantics below. |
| `cacheReadTokens`, `cacheWriteTokens` | Upstream cache counters when reported. |
| `cacheWrite5mTokens`, `cacheWrite1hTokens` | Anthropic cache-write TTL breakdown when reported. |
| `reasoningTokens` | Upstream reasoning/thinking decomposition, already included in output tokens. |
| `totalTokens` | An explicit upstream total only; no total is fabricated. |

Only nonnegative safe-integer counters are accepted. Missing, invalid, fractional,
negative and overflow values are **null**, while a reported zero stays zero.
Events use a fixed allowlist and contain no prompt, generated content, response
body, request headers, API key, error message, user ID or email. Requested and
reported model IDs are bounded; values containing the configured API key are
discarded. No usage event is written to console by this module.

`completed` means a direct `.chat()` call received/decoded its response. It does
not imply that application-level schema validation accepted it. `completeJson`
updates the same receipt to `accepted`, `rejected_shape`, or `parse_error`, so
validation never creates a second token-bearing event. Rejected output can still
have consumed upstream tokens. HTTP/network/timeout failures with absent usage
remain unknown; they are not recorded as a zero-cost request. If a bounded JSON
HTTP-error body actually reports usage, those counters are retained.

Model-discovery GETs do not generate a token receipt. Every generation retry and
provider fallback does. Prepared builds and deterministic refinements that make
no upstream call produce no receipt.

## Correct token and cost interpretation

Anthropic `input_tokens` excludes cache creation and cache reads. Its documented
total input includes all three categories. OpenAI-compatible `prompt_tokens`
already includes cached input, so adding cacheReadTokens again double-counts it.
Thinking/reasoning counters are a breakdown of output, not extra output tokens.
Preserve these raw categories rather than summing them indiscriminately.
Sources: [Anthropic Messages usage](https://platform.claude.com/docs/en/api/typescript/messages),
[Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching),
[Chat Completions usage schema](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).

No token estimation, bundled price table, dollar cost, credits-per-token formula,
balance change or paid billing is enabled here. Usage is not an invoice. Actual
cost calculation requires approved, versioned rates for the exact provider/model,
cache read/write categories and cache TTLs, plus complete upstream counters and
reconciliation with provider billing. Missing rate/counter data must remain an
unknown cost. Do not treat a Codex subscription as production Anthropic API credit.

## Streaming boundary

Anthropic uses real bounded upstream SSE when `ANTHROPIC_STREAMING=on`.
The parser validates message lifecycle, fragmented UTF-8, cumulative counters,
terminal completion, byte/event limits, deadlines and cancellation. Incomplete
streams are rejected even when partial text happens to be valid JSON. Missing
terminal usage is marked `usageComplete:false` and leaves billing in review.
The browser receives validated application progress/results; raw model tokens
and hidden reasoning are not forwarded. The default JSON path and other
providers remain supported. No paid live Anthropic call was made in development.

## Verification

Mocked tests cover actual upstream counter extraction, cache semantics, reported
model IDs, shape/parse fallback, HTTP-error usage, model-discovery retries,
deadline/cancellation errors, malformed response bodies, concurrent owner scopes,
async sink failure, preserved operation failures, zero versus unknown counters
and absence of private content in receipts. Existing builder/provider regression
tests pass with this instrumentation. No real paid call is part of these tests.
