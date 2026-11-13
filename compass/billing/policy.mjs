// Commercial values are supplied by an approved policy, never bundled defaults.
export class BillingError extends Error {
  constructor(status, code) { super(code); this.name = 'BillingError'; this.status = status; this.code = code; }
}
export const reject = (status, code) => { throw new BillingError(status, code); };
export const integer = value => Number.isSafeInteger(value) && value >= 0;
export const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value);
const modelId = value => typeof value === 'string' && /^[A-Za-z0-9_./:+-]{1,120}$/.test(value);
const providers = ['anthropic', 'generalcompute', 'nebius'];
const rateFields = ['inputMicrosPerMillion', 'outputMicrosPerMillion', 'cacheReadMicrosPerMillion', 'cacheWriteMicrosPerMillion', 'cacheWrite5mMicrosPerMillion', 'cacheWrite1hMicrosPerMillion'];
const features = value => Array.isArray(value) && value.length <= 20 && value.every(item => typeof item === 'string' && /^[a-z][a-z0-9_-]{0,47}$/.test(item));
const ceil = (numerator, denominator) => (numerator + denominator - 1n) / denominator;

export function loadCreditPolicy(env = {}) {
  if (typeof env.COMPASS_CREDIT_POLICY_JSON !== 'string' || !env.COMPASS_CREDIT_POLICY_JSON.trim()) return { enabled: false, blocked: ['approved_credit_policy_required'], policy: null };
  let raw;
  try { raw = JSON.parse(env.COMPASS_CREDIT_POLICY_JSON); }
  catch { return { enabled: false, blocked: ['invalid_credit_policy_json'], policy: null }; }
  try { return { enabled: true, blocked: [], policy: validateCreditPolicy(raw) }; }
  catch (error) { return { enabled: false, blocked: [error.code || 'invalid_credit_policy'], policy: null }; }
}

export function validateCreditPolicy(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !identifier(raw.version) || raw.version.length > 80) reject(503, 'policy_version_required');
  if (raw.currency !== 'usd') reject(503, 'policy_usd_currency_required');
  if (!integer(raw.creditUnitCostMicros) || raw.creditUnitCostMicros < 1) reject(503, 'credit_unit_cost_required');
  if (!integer(raw.maxOperationCostMicros) || raw.maxOperationCostMicros < 1) reject(503, 'operation_cost_cap_required');
  if (raw.rounding !== 'ceil') reject(503, 'explicit_credit_rounding_required');
  if (!features(raw.creditFeatures)) reject(503, 'credit_features_required');
  if (!Array.isArray(raw.rates) || !raw.rates.length || raw.rates.length > 30) reject(503, 'exact_model_rates_required');
  const seen = new Set();
  const rates = raw.rates.map(value => {
    if (!value || !providers.includes(value.provider) || !modelId(value.model) || !['includes_cache', 'excludes_cache'].includes(value.inputTokenBasis)) reject(503, 'invalid_model_rate');
    if ((value.provider === 'anthropic') !== (value.inputTokenBasis === 'excludes_cache')) reject(503, 'invalid_token_basis');
    const key = value.provider + '\0' + value.model;
    if (seen.has(key)) reject(503, 'duplicate_model_rate');
    seen.add(key);
    const rate = { provider: value.provider, model: value.model, inputTokenBasis: value.inputTokenBasis };
    for (const field of rateFields) {
      if (value[field] !== undefined && value[field] !== null && !integer(value[field])) reject(503, 'invalid_token_rate');
      rate[field] = value[field] ?? null;
    }
    if (rate.inputMicrosPerMillion === null || rate.outputMicrosPerMillion === null) reject(503, 'input_output_rates_required');
    return rate;
  });
  if (!Array.isArray(raw.offers) || raw.offers.length > 20) reject(503, 'invalid_offer_catalog');
  const offerIds = new Set(), priceIds = new Set();
  const offers = raw.offers.map(value => {
    if (!value || !identifier(value.id) || value.id.length > 80 || offerIds.has(value.id) || !/^price_[A-Za-z0-9]{1,100}$/.test(value.priceId || '') || priceIds.has(value.priceId)) reject(503, 'invalid_offer_id');
    if (!['credits', 'subscription'].includes(value.kind) || !integer(value.credits) || value.credits < 1 || !integer(value.unitAmount) || value.unitAmount < 1 || value.currency !== 'usd' || !features(value.features)) reject(503, 'invalid_offer_economics');
    if (value.kind === 'subscription' && (!['month', 'year'].includes(value.interval) || !integer(value.intervalCount) || value.intervalCount < 1 || value.intervalCount > 12)) reject(503, 'subscription_interval_required');
    offerIds.add(value.id); priceIds.add(value.priceId);
    return { id: value.id, kind: value.kind, priceId: value.priceId, credits: value.credits, unitAmount: value.unitAmount, currency: value.currency, features: [...new Set(value.features)], ...(value.kind === 'subscription' ? { interval: value.interval, intervalCount: value.intervalCount } : {}) };
  });
  const reserveCredits = Number(ceil(BigInt(raw.maxOperationCostMicros), BigInt(raw.creditUnitCostMicros)));
  if (!integer(reserveCredits) || reserveCredits < 1) reject(503, 'invalid_reservation_amount');
  return Object.freeze({ version: raw.version, currency: 'usd', creditUnitCostMicros: raw.creditUnitCostMicros, maxOperationCostMicros: raw.maxOperationCostMicros, rounding: 'ceil', creditFeatures: [...new Set(raw.creditFeatures)], reserveCredits, rates, offers });
}

// Exact integer arithmetic. Rates are micro-USD per million tokens. Unknown
// counters stay unknown, unless their configured price cannot affect the cost.
export function measuredCost(policy, events, { infrastructureCostMicros = null } = {}) {
  const unknown = new Set();
  let numerator = 0n;
  if (!integer(infrastructureCostMicros)) unknown.add('measured_infrastructure_cost_required');
  else numerator += BigInt(infrastructureCostMicros) * 1_000_000n;
  function charge(tokens, rate, name) {
    if (rate === 0) return;
    if (!integer(tokens) || !integer(rate)) { unknown.add(name); return; }
    numerator += BigInt(tokens) * BigInt(rate);
  }
  for (const event of events) {
    if (event.usageComplete === false || ['incomplete', 'timeout', 'aborted', 'network_error', 'error'].includes(event.status)) unknown.add('upstream_usage_not_final');
    const model = event.reportedModel || event.model;
    const rate = policy.rates.find(item => item.provider === event.provider && item.model === model);
    if (!rate) { unknown.add('exact_model_rate_missing'); continue; }
    if (event.inputTokenBasis !== rate.inputTokenBasis) { unknown.add('token_basis_mismatch'); continue; }
    if (!integer(event.inputTokens) || !integer(event.outputTokens)) unknown.add('upstream_token_usage_unknown');
    charge(event.outputTokens, rate.outputMicrosPerMillion, 'output_usage_or_rate_unknown');
    if (rate.inputTokenBasis === 'excludes_cache') {
      charge(event.inputTokens, rate.inputMicrosPerMillion, 'input_usage_or_rate_unknown');
      if (event.cacheReadTokens !== 0) charge(event.cacheReadTokens, rate.cacheReadMicrosPerMillion, 'cache_read_usage_or_rate_unknown');
      if (event.cacheWriteTokens === 0) continue;
      if (integer(event.cacheWrite5mTokens) && integer(event.cacheWrite1hTokens)
        && (!integer(event.cacheWriteTokens) || event.cacheWrite5mTokens + event.cacheWrite1hTokens === event.cacheWriteTokens)) {
        if (event.cacheWrite5mTokens) charge(event.cacheWrite5mTokens, rate.cacheWrite5mMicrosPerMillion, 'cache_5m_rate_unknown');
        if (event.cacheWrite1hTokens) charge(event.cacheWrite1hTokens, rate.cacheWrite1hMicrosPerMillion, 'cache_1h_rate_unknown');
      } else charge(event.cacheWriteTokens, rate.cacheWriteMicrosPerMillion, 'cache_write_usage_or_rate_unknown');
    } else {
      // Cached tokens are already included in prompt_tokens. Subtract them
      // before applying distinct cache prices, never add them a second time.
      const read = integer(event.cacheReadTokens) ? event.cacheReadTokens : rate.cacheReadMicrosPerMillion === rate.inputMicrosPerMillion ? 0 : null;
      const write = integer(event.cacheWriteTokens) ? event.cacheWriteTokens : rate.cacheWriteMicrosPerMillion === rate.inputMicrosPerMillion ? 0 : null;
      if (read === null || write === null || !integer(event.inputTokens) || read + write > event.inputTokens) { unknown.add('inclusive_cache_breakdown_unknown'); continue; }
      charge(event.inputTokens - read - write, rate.inputMicrosPerMillion, 'input_usage_or_rate_unknown');
      if (read) charge(read, rate.cacheReadMicrosPerMillion, 'cache_read_rate_unknown');
      if (write) charge(write, rate.cacheWriteMicrosPerMillion, 'cache_write_rate_unknown');
    }
  }
  const cost = ceil(numerator, 1_000_000n);
  const credits = ceil(numerator, 1_000_000n * BigInt(policy.creditUnitCostMicros));
  if (cost > BigInt(Number.MAX_SAFE_INTEGER) || credits > BigInt(Number.MAX_SAFE_INTEGER)) unknown.add('cost_overflow');
  const known = !unknown.size;
  return { known, currency: policy.currency, costMicros: known ? Number(cost) : null, credits: known ? Number(credits) : null, policyVersion: policy.version, attempts: events.length, unknownReasons: [...unknown] };
}
