// Server-only measured provider usage. No prompts, responses, keys or user IDs.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const tracking = new AsyncLocalStorage();
const resultAttempts = new WeakMap();
const providers = new Set(['anthropic', 'generalcompute', 'nebius']);
const finalStatuses = new Set(['accepted', 'rejected_shape', 'parse_error']);
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

function modelName(value, secret) {
  if (typeof value !== 'string' || !value || value.length > 120 || !/^[A-Za-z0-9_./:+-]+$/.test(value)) return null;
  return secret && value.includes(secret) ? null : value;
}

// Preserve the provider's accounting semantics. Anthropic input_tokens excludes
// cache reads/writes; OpenAI-compatible prompt_tokens already includes them.
export function normalizeProviderUsage(provider, raw) {
  const usage = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const anthropic = provider === 'anthropic';
  return {
    inputTokenBasis: anthropic ? 'excludes_cache' : 'includes_cache',
    inputTokens: count(anthropic ? usage.input_tokens : usage.prompt_tokens),
    outputTokens: count(anthropic ? usage.output_tokens : usage.completion_tokens),
    cacheReadTokens: count(anthropic ? usage.cache_read_input_tokens : usage.prompt_tokens_details?.cached_tokens),
    cacheWriteTokens: count(anthropic ? usage.cache_creation_input_tokens : usage.prompt_tokens_details?.cache_write_tokens),
    cacheWrite5mTokens: count(anthropic ? usage.cache_creation?.ephemeral_5m_input_tokens : null),
    cacheWrite1hTokens: count(anthropic ? usage.cache_creation?.ephemeral_1h_input_tokens : null),
    reasoningTokens: count(anthropic ? usage.output_tokens_details?.thinking_tokens : usage.completion_tokens_details?.reasoning_tokens),
    // Do not manufacture a total when the upstream did not report one.
    totalTokens: count(usage.total_tokens),
  };
}

function failureStatus(error) {
  if (error?.code === 'http') return 'http_error';
  if (error?.code === 'parse') return 'parse_error';
  if (error?.code === 'network') return 'network_error';
  if (error?.code === 'timeout') return 'timeout';
  if (error?.code === 'aborted' || error?.name === 'AbortError') return 'aborted';
  return 'error';
}

/**
 * Run one awaited operation and persist each final attempt exactly once.
 * onAttempt may be async. Sink failures propagate, so a ledger failure cannot
 * silently masquerade as recorded usage. All sinks are attempted before throw.
 */
export async function withUsageTracking(onAttempt, run) {
  if (typeof onAttempt !== 'function' || typeof run !== 'function') throw new TypeError('Usage tracking requires two functions');
  const scope = { attempts: [], closed: false };
  let result;
  let operationError;
  let operationFailed = false;
  try { result = await tracking.run(scope, run); }
  catch (error) { operationFailed = true; operationError = error; }
  scope.closed = true;
  const errors = operationFailed ? [operationError] : [];
  for (const attempt of scope.attempts) {
    if (attempt.event.status === 'pending') {
      attempt.event.status = 'incomplete';
      attempt.event.durationMs = Math.max(0, Math.round(performance.now() - attempt.started));
    }
    try { await onAttempt(Object.freeze({ ...attempt.event })); }
    catch (error) { errors.push(error); }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'AI operation or usage persistence failed');
  return result;
}

// Internal transport boundary. A retry is a separate actual generation attempt.
// Model catalog GETs are intentionally outside this boundary.
export async function trackProviderAttempt({ provider, model, secret }, run) {
  const scope = tracking.getStore();
  const ticket = scope && !scope.closed ? {
    started: performance.now(),
    event: {
      id: randomUUID(),
      provider: providers.has(provider) ? provider : 'unknown',
      model: modelName(model, secret),
      reportedModel: null,
      startedAt: new Date().toISOString(),
      status: 'pending',
      httpStatus: null,
      durationMs: null,
      ...normalizeProviderUsage(provider, null),
    },
  } : null;
  if (ticket) scope.attempts.push(ticket);
  const report = {
    http(status) { if (ticket && Number.isInteger(status) && status >= 100 && status <= 599) ticket.event.httpStatus = status; },
    usage(raw, reportedModel) {
      if (ticket) {
        Object.assign(ticket.event, normalizeProviderUsage(provider, raw));
        ticket.event.reportedModel = modelName(reportedModel, secret);
      }
    },
  };
  try {
    const result = await run(report);
    if (ticket) {
      ticket.event.status = 'completed';
      if (result && typeof result === 'object') resultAttempts.set(result, ticket);
    }
    return result;
  } catch (error) {
    if (ticket) ticket.event.status = failureStatus(error);
    throw error;
  } finally {
    if (ticket) ticket.event.durationMs = Math.max(0, Math.round(performance.now() - ticket.started));
  }
}

// completeJson can reject an HTTP-successful result. Update the same receipt,
// rather than emitting a second event and double-counting its consumed tokens.
export function setUsageOutcome(result, status) {
  const ticket = result && typeof result === 'object' ? resultAttempts.get(result) : null;
  if (ticket && finalStatuses.has(status)) ticket.event.status = status;
}
