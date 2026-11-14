import { createCreditLedger } from './ledger.mjs';
import { createStripeAdapter } from './stripe-test.mjs';
import { loadCreditPolicy, reject, BillingError } from './policy.mjs';
import { billingOrigin, bindBillingEnvironment, stripeId } from './environment.mjs';

export { BillingError };

/** Pass the already-open account database. Default-off creates no tables. */
export function createBilling({ database, env = process.env, stripeClient, storageInspector, costMeasurementReady = false, now = () => Date.now() } = {}) {
  const config = loadCreditPolicy(env);
  const mode = env.COMPASS_BILLING_MODE;
  const blocked = [];
  if (!['test', 'live'].includes(mode)) blocked.push('explicit_billing_mode_required');
  if (!database?.prepare || !database?.exec) blocked.push('isolated_persistent_database_required');
  blocked.push(...config.blocked);
  if (mode === 'live') {
    if (!billingOrigin(env, mode)) blocked.push('exact_live_billing_origin_required');
    if (!stripeId(env.STRIPE_ACCOUNT_ID, 'acct')) blocked.push('stripe_merchant_account_required');
    if (!config.policy || env.COMPASS_BILLING_LIVE_POLICY_VERSION !== config.policy.version) blocked.push('approved_live_credit_policy_required');
  }
  const binding = !blocked.length ? bindBillingEnvironment(database, mode, env.STRIPE_ACCOUNT_ID, now) : null;
  blocked.push(...(binding?.blocked || []));
  const enabled = !blocked.length;
  const ledger = enabled ? createCreditLedger(database, config.policy, now) : null;
  const adapter = ledger ? createStripeAdapter(ledger, { env, stripeClient, storageInspector, costMeasurementReady, binding, now }) : null;
  function status() {
    return { mode: enabled ? mode : 'disabled', liveChargesEnabled: mode === 'live' && Boolean(adapter?.enabled), creditsEnabled: enabled && (mode === 'test' || Boolean(adapter?.enabled)), billingEnabled: Boolean(adapter?.enabled),
      policyVersion: enabled ? config.policy.version : null, creditUnitCostMicros: enabled ? config.policy.creditUnitCostMicros : null,
      currency: enabled ? config.policy.currency : null, reserveCredits: enabled ? config.policy.reserveCredits : null,
      blocked: [...blocked, ...(adapter?.blocked || [])],
      offers: adapter?.enabled ? config.policy.offers.map(offer => ({ id: offer.id, kind: offer.kind, credits: offer.credits, unitAmount: offer.unitAmount, currency: offer.currency,
        ...(offer.kind === 'subscription' ? { interval: offer.interval, intervalCount: offer.intervalCount } : {}) })) : [] };
  }
  function account(owner) {
    const current = status();
    if (!ledger) return { ...current, balance: null, held: null, available: null, transactions: [], operations: [], payments: [], subscriptions: [], entitlements: [] };
    const balance = ledger.account(owner), subscriptions = adapter.subscriptions(owner);
    const active = new Set(subscriptions.flatMap(item => item.features));
    if (balance.available >= config.policy.reserveCredits) for (const feature of config.policy.creditFeatures) active.add(feature);
    if ((mode === 'live' && !adapter.enabled) || balance.balance < 0 || database.prepare("SELECT 1 AS n FROM billing_reservation WHERE owner=? AND status IN ('pending_review','overage_review')").get(owner)) active.clear();
    return { ...current, ...balance, payments: adapter.history(owner), subscriptions, entitlements: [...active] };
  }
  function assertEntitled(owner, feature) {
    if (!ledger) reject(503, 'credit_policy_setup_required');
    if (mode === 'live' && !adapter.enabled) reject(503, 'stripe_live_setup_required');
    if (typeof feature !== 'string' || !/^[a-z][a-z0-9_-]{0,47}$/.test(feature)) reject(400, 'invalid_entitlement');
    const balance = ledger.account(owner);
    if (balance.balance < 0) reject(402, 'credit_refund_shortfall');
    if (database.prepare("SELECT 1 AS n FROM billing_reservation WHERE owner=? AND status IN ('pending_review','overage_review')").get(owner)) reject(409, 'usage_reconciliation_required');
    if (config.policy.creditFeatures.includes(feature) && balance.available >= config.policy.reserveCredits) return { allowed: true, source: 'credits' };
    if (adapter.subscriptions(owner).some(item => item.features.includes(feature))) return { allowed: true, source: 'paid_subscription' };
    reject(403, 'entitlement_required');
  }
  function reserve(owner, operationId) {
    if (!ledger) {
      if (mode === 'live') reject(503, 'stripe_live_setup_required');
      return { status: 'disabled', creditsEnabled: false };
    }
    if (mode === 'live' && !adapter.enabled) reject(503, 'stripe_live_setup_required');
    if (database.prepare('SELECT 1 AS n FROM billing_reservation WHERE operation_id=?').get(operationId)) return ledger.reserve(owner, operationId);
    assertEntitled(owner, 'generate');
    return ledger.reserve(owner, operationId);
  }
  const requireLedger = () => { if (!ledger) reject(503, 'credit_policy_setup_required'); if (mode === 'live' && !adapter.enabled) reject(503, 'stripe_live_setup_required'); return ledger; };
  const requirePayments = () => { if (!adapter) reject(503, mode === 'live' ? 'stripe_live_setup_required' : 'stripe_test_setup_required'); return adapter; };
  return {
    status, account, reserve, assertEntitled,
    ready: async () => { if (adapter) await adapter.ready(); return status(); },
    recordUsage: (owner, operationId, event) => ledger ? ledger.recordUsage(owner, operationId, event) : { creditsEnabled: false },
    settle: (owner, operationId, outcome) => ledger ? ledger.settle(owner, operationId, outcome) : { status: 'disabled', chargedCredits: null },
    // These are TRUSTED SERVER/ADMIN operations. They are not user-facing
    // endpoints and must never accept an arbitrary client-selected amount.
    grant: (owner, value) => requireLedger().grant(owner, value),
    reverse: (owner, operationId, reason) => requireLedger().reverse(owner, operationId, reason),
    monitor: () => ({ ...status(), ...(ledger?.monitor() || {}) }),
    checkout: async (owner, value) => requirePayments().checkout(owner, value),
    portal: async owner => requirePayments().portal(owner),
    cancel: async (owner, value) => requirePayments().cancel(owner, value),
    webhook: async (rawBody, signature) => requirePayments().webhook(rawBody, signature),
  };
}
