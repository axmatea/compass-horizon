import { createCreditLedger } from './ledger.mjs';
import { createStripeTestAdapter } from './stripe-test.mjs';
import { loadCreditPolicy, reject, BillingError } from './policy.mjs';

export { BillingError };

/** Pass the already-open account database. Default-off creates no tables. */
export function createBilling({ database, env = process.env, stripeClient, now = () => Date.now() } = {}) {
  const config = loadCreditPolicy(env);
  const blocked = [];
  if (env.COMPASS_BILLING_MODE !== 'test') blocked.push('test_billing_mode_required');
  if (!database?.prepare || !database?.exec) blocked.push('isolated_persistent_database_required');
  blocked.push(...config.blocked);
  const enabled = !blocked.length;
  const ledger = enabled ? createCreditLedger(database, config.policy, now) : null;
  const adapter = ledger ? createStripeTestAdapter(ledger, { env, stripeClient, now }) : null;
  function status() {
    return { mode: enabled ? 'test' : 'disabled', liveChargesEnabled: false, creditsEnabled: enabled, billingEnabled: Boolean(adapter?.enabled),
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
    if (balance.balance < 0 || database.prepare("SELECT 1 AS n FROM billing_reservation WHERE owner=? AND status IN ('pending_review','overage_review')").get(owner)) active.clear();
    return { ...current, ...balance, payments: adapter.history(owner), subscriptions, entitlements: [...active] };
  }
  function assertEntitled(owner, feature) {
    if (!ledger) reject(503, 'credit_policy_setup_required');
    if (typeof feature !== 'string' || !/^[a-z][a-z0-9_-]{0,47}$/.test(feature)) reject(400, 'invalid_entitlement');
    const balance = ledger.account(owner);
    if (balance.balance < 0) reject(402, 'credit_refund_shortfall');
    if (database.prepare("SELECT 1 AS n FROM billing_reservation WHERE owner=? AND status IN ('pending_review','overage_review')").get(owner)) reject(409, 'usage_reconciliation_required');
    if (config.policy.creditFeatures.includes(feature) && balance.available >= config.policy.reserveCredits) return { allowed: true, source: 'credits' };
    if (adapter.subscriptions(owner).some(item => item.features.includes(feature))) return { allowed: true, source: 'paid_subscription' };
    reject(403, 'entitlement_required');
  }
  function reserve(owner, operationId) {
    if (!ledger) return { status: 'disabled', creditsEnabled: false };
    if (database.prepare('SELECT 1 AS n FROM billing_reservation WHERE operation_id=?').get(operationId)) return ledger.reserve(owner, operationId);
    assertEntitled(owner, 'generate');
    return ledger.reserve(owner, operationId);
  }
  const requireLedger = () => { if (!ledger) reject(503, 'credit_policy_setup_required'); return ledger; };
  const requirePayments = () => { if (!adapter) reject(503, 'stripe_test_setup_required'); return adapter; };
  return {
    status, account, reserve, assertEntitled,
    recordUsage: (owner, operationId, event) => ledger ? ledger.recordUsage(owner, operationId, event) : { creditsEnabled: false },
    settle: (owner, operationId, outcome) => ledger ? ledger.settle(owner, operationId, outcome) : { status: 'disabled', chargedCredits: null },
    // These are TRUSTED SERVER/ADMIN operations. They are not user-facing
    // endpoints and must never accept an arbitrary client-selected amount.
    grant: (owner, value) => requireLedger().grant(owner, value),
    reverse: (owner, operationId, reason) => requireLedger().reverse(owner, operationId, reason),
    monitor: () => ({ ...status(), ...(ledger?.monitor() || {}) }),
    checkout: (owner, value) => requirePayments().checkout(owner, value),
    portal: owner => requirePayments().portal(owner),
    cancel: (owner, value) => requirePayments().cancel(owner, value),
    webhook: (rawBody, signature) => requirePayments().webhook(rawBody, signature),
  };
}
