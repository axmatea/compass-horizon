import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBilling } from '../billing/index.mjs';
import { validateCreditPolicy, measuredCost } from '../billing/policy.mjs';

// Synthetic commercial values are local fixtures, never deployment defaults.
const policy = () => ({ version: 'synthetic-test-v1', currency: 'usd', creditUnitCostMicros: 1000, maxOperationCostMicros: 10000, rounding: 'ceil', creditFeatures: ['generate'],
  rates: [{ provider: 'anthropic', model: 'claude-fixture', inputTokenBasis: 'excludes_cache', inputMicrosPerMillion: 1000000, outputMicrosPerMillion: 2000000,
    cacheReadMicrosPerMillion: 100000, cacheWriteMicrosPerMillion: 1250000, cacheWrite5mMicrosPerMillion: 1250000, cacheWrite1hMicrosPerMillion: 2000000 },
  { provider: 'generalcompute', model: 'compat-fixture', inputTokenBasis: 'includes_cache', inputMicrosPerMillion: 2000000, outputMicrosPerMillion: 3000000, cacheReadMicrosPerMillion: 1000000, cacheWriteMicrosPerMillion: 2000000 }],
  offers: [{ id: 'pack', kind: 'credits', priceId: 'price_fixturePack', credits: 1000, unitAmount: 100, currency: 'usd', features: [] },
  { id: 'plan', kind: 'subscription', priceId: 'price_fixturePlan', credits: 2000, unitAmount: 200, currency: 'usd', interval: 'month', intervalCount: 1, features: ['advanced'] }] });
const usage = changes => ({ id: randomUUID(), provider: 'anthropic', model: 'claude-fixture', reportedModel: null, status: 'accepted', inputTokenBasis: 'excludes_cache',
  inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, reasoningTokens: null, totalTokens: null,
  httpStatus: 200, durationMs: 1, ...changes });
const errorCode = code => error => error?.code === code;
const copy = value => structuredClone(value);

function fixture(t, overrides = {}) {
  const db = overrides.database || new DatabaseSync(':memory:');
  if (!overrides.database) t.after(() => db.close());
  const commercial = overrides.policy || policy();
  let clock = Date.UTC(2026, 10, 13, 18);
  const env = { COMPASS_BILLING_MODE: 'test', COMPASS_BILLING_ORIGIN: 'http://127.0.0.1:8777', COMPASS_ACCOUNT_ORIGIN: 'http://127.0.0.1:8777',
    COMPASS_CREDIT_POLICY_JSON: JSON.stringify(commercial), STRIPE_SECRET_KEY: 'sk_test_compass_fixture_not_real', STRIPE_WEBHOOK_SECRET: 'whsec_compass_fixture_not_real', ...overrides.env };
  const live = env.COMPASS_BILLING_MODE === 'live';
  const state = { calls: [], customers: new Map(), sessions: new Map(), subscriptions: new Map(), invoices: new Map(), refunds: new Map(), counter: 0,
    merchant: { id: 'acct_fixtureMerchant', object: 'account', charges_enabled: true } };
  const keyResults = new Map();
  const invoke = (name, params, options) => state.calls.push({ name, params: copy(params), options: copy(options) });
  const stripe = {
    paymentIntents:{retrieve:async id=>{
      invoke('paymentIntents.retrieve',id);
      const session=[...state.sessions.values()].find(value=>value.payment_intent===id);
      const invoice=[...state.invoices.values()].find(value=>value.payments?.data?.[0]?.payment?.payment_intent===id);
      if(!session&&!invoice)return null;
      return {id,object:'payment_intent',livemode:live,status:'succeeded',customer:(session||invoice).customer,
        currency:(session||invoice).currency,amount:session?session.amount_total:invoice.amount_paid,amount_received:session?session.amount_total:invoice.amount_paid};
    }},
    accounts: { retrieve: async () => { invoke('accounts.retrieve', null); return copy(state.merchant); } },
    customers: { create: async (params, options) => {
      invoke('customers.create', params, options);
      if (keyResults.has(options.idempotencyKey)) return copy(keyResults.get(options.idempotencyKey));
      const value = { id: 'cus_fixture_' + ++state.counter, object: 'customer', livemode: live, metadata: params.metadata };
      state.customers.set(value.id, value); keyResults.set(options.idempotencyKey, value); return copy(value);
    } },
    prices: { retrieve: async id => {
      invoke('prices.retrieve', id);
      const offer = commercial.offers.find(item => item.priceId === id);
      return { id, object: 'price', active: true, livemode: live, currency: offer.currency, unit_amount: offer.unitAmount,
        recurring: offer.kind === 'subscription' ? { interval: offer.interval, interval_count: offer.intervalCount } : null };
    } },
    checkout: { sessions: {
      create: async (params, options) => {
        invoke('checkout.sessions.create', params, options);
        if (keyResults.has(options.idempotencyKey)) return copy(keyResults.get(options.idempotencyKey));
        const value = { id: 'cs_' + (live ? 'live' : 'test') + '_fixture_' + ++state.counter, object: 'checkout.session', livemode: live, status: 'open', payment_status: 'unpaid',
          customer: params.customer, client_reference_id: params.client_reference_id, metadata: params.metadata, mode: params.mode,
          success_url: params.success_url, cancel_url: params.cancel_url, automatic_tax: { enabled: false }, allow_promotion_codes: false,
          total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 }, line_items: { has_more: false, data: params.line_items.map(line => {
            const offer = commercial.offers.find(item => item.priceId === line.price);
            return { quantity: line.quantity, price: { id: line.price, object: 'price', active: true, livemode: live, currency: offer.currency, unit_amount: offer.unitAmount,
              recurring: offer.kind === 'subscription' ? { interval: offer.interval, interval_count: offer.intervalCount } : null } };
          }) }, url: 'https://checkout.stripe.com/c/pay/cs_' + (live ? 'live' : 'test') + '_fixture_' + state.counter };
        state.sessions.set(value.id, value); keyResults.set(options.idempotencyKey, value); return copy(value);
      },
      retrieve: async id => { invoke('checkout.sessions.retrieve', id); return copy(state.sessions.get(id)); },
    } },
    subscriptions: {
      retrieve: async id => { invoke('subscriptions.retrieve', id); return copy(state.subscriptions.get(id)); },
      update: async (id, params, options) => { invoke('subscriptions.update', { id, ...params }, options); const value = state.subscriptions.get(id); Object.assign(value, params); return copy(value); },
    },
    invoices: { retrieve: async id => { invoke('invoices.retrieve', id); return copy(state.invoices.get(id)); } },
    refunds: {
      retrieve: async id => { invoke('refunds.retrieve', id); return copy(state.refunds.get(id)); },
      list: async params => { invoke('refunds.list', params); return { data: [...state.refunds.values()].filter(value => value.charge === params.charge).map(copy), has_more: false }; },
    },
    billingPortal: { sessions: { create: async params => { invoke('billingPortal.sessions.create', params); return { id: 'bps_fixture', object: 'billing_portal.session', ...params, url: 'https://billing.stripe.com/p/session/fixture' }; } } },
  };
  const billing = createBilling({ database: db, env, stripeClient: stripe, storageInspector: overrides.storageInspector, costMeasurementReady: overrides.costMeasurementReady, now: () => clock });
  let eventCounter = 0;
  function signed(type, object, changes = {}, signatureChanges = {}) {
    const event = { id: 'evt_fixture_' + ++eventCounter, object: 'event', api_version: '2026-10-28.endive', created: Math.floor(clock / 1000), livemode: live, type, data: { object: copy(object) }, ...changes };
    const payload = JSON.stringify(event);
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: env.STRIPE_WEBHOOK_SECRET, timestamp: Math.floor(clock / 1000), ...signatureChanges });
    return { payload, signature, event };
  }
  const deliver = (type, object, changes) => { const value = signed(type, object, changes); return billing.webhook(Buffer.from(value.payload), value.signature); };
  async function checkoutPaid(owner = 'owner_a', offerId = 'pack') {
    const offer = commercial.offers.find(item => item.id === offerId);
    const opened = await billing.checkout(owner, { offerId, requestKey: randomUUID() });
    const session = state.sessions.get(opened.sessionId);
    Object.assign(session, { status: 'complete', payment_status: 'paid', amount_total: offer.unitAmount, currency: offer.currency,
      payment_intent: 'pi_fixture_' + ++state.counter });
    await deliver('checkout.session.completed', session);
    return session;
  }
  async function subscriptionPaid(owner = 'owner_a') {
    const session = await checkoutPaid(owner, 'plan');
    const end = Math.floor(clock / 1000) + 30 * 86400;
    const subscription = { id: 'sub_fixture_' + ++state.counter, object: 'subscription', livemode: live, customer: session.customer, metadata: session.metadata,
      status: 'active', cancel_at_period_end: false, items: { has_more: false, data: [{ id: 'si_fixture', price: copy(session.line_items.data[0].price), quantity: 1, current_period_end: end }] } };
    state.subscriptions.set(subscription.id, subscription);
    const invoice = { id: 'in_fixture_' + ++state.counter, object: 'invoice', livemode: live, customer: session.customer, parent: { subscription_details: { subscription: subscription.id } },
      status: 'paid', amount_paid: 200, amount_remaining: 0, currency: 'usd',
      payments: { has_more: false, data: [{ object: 'invoice_payment', livemode: live, invoice: 'in_fixture_' + state.counter, currency: 'usd', amount_paid: 200, status: 'paid', payment: { type: 'payment_intent', payment_intent: 'pi_invoice_' + state.counter } }] },
      lines: { has_more: false, data: [{ quantity: 1, pricing: { price_details: { price: 'price_fixturePlan' } }, period: { start: end - 30 * 86400, end }, proration: false }] } };
    state.invoices.set(invoice.id, invoice);
    await deliver('invoice.paid', invoice);
    return { session, subscription, invoice };
  }
  return { db, env, commercial, billing, state, stripe, signed, deliver, checkoutPaid, subscriptionPaid, now: () => clock, advance: milliseconds => { clock += milliseconds; } };
}

function liveFixture(t, overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'compass-live-billing-fixture-'));
  const path = join(directory, 'fixture.sqlite');
  const database = new DatabaseSync(path);
  t.after(() => { database.close(); rmSync(directory, { recursive: true, force: true }); });
  return fixture(t, { database, storageInspector: async () => ({ mode: 'durable', dependencies: [] }), costMeasurementReady: true, ...overrides,
    env: { COMPASS_BILLING_MODE: 'live', COMPASS_ACCOUNT_MODE: 'production', COMPASS_BILLING_ORIGIN: 'https://mycompass.world', COMPASS_ACCOUNT_ORIGIN: 'https://mycompass.world',
      COMPASS_ACCOUNT_DATABASE: path, COMPASS_BILLING_LIVE_POLICY_VERSION: policy().version, STRIPE_ACCOUNT_ID: 'acct_fixtureMerchant', STRIPE_SECRET_KEY: 'rk_live_compass_fixture_not_real', ...overrides.env } });
}

test('live credits require a succeeded payment belonging to the verified customer and mode',async t=>{
  for(const change of [{status:'processing'},{livemode:false},{customer:'cus_other'},{amount_received:1}]){
    const f=liveFixture(t),retrieve=f.stripe.paymentIntents.retrieve;
    f.stripe.paymentIntents.retrieve=async id=>({...await retrieve(id),...change});
    await assert.rejects(f.checkoutPaid(),errorCode('payment_intent_policy_mismatch'));
    assert.equal(f.billing.account('owner_a').balance,0);
  }
});

test('billing is off without approved economics and never initializes a financial database', t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const b = createBilling({ database: db, env: {} });
  assert.equal(b.status().creditsEnabled, false);
  assert.equal(b.status().billingEnabled, false);
  assert.equal(b.status().liveChargesEnabled, false);
  assert.equal(b.account('owner_a').balance, null);
  assert.ok(b.status().blocked.includes('approved_credit_policy_required'));
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'billing_%'").get().n, 0);
  assert.deepEqual(b.reserve('owner_a', 'operation_a'), { status: 'disabled', creditsEnabled: false });
  assert.throws(() => b.grant('owner_a', { credits: 1, key: 'arbitrary' }), errorCode('credit_policy_setup_required'));
});

test('credit reservations, measured settlement, failure release and reversals are idempotent', t => {
  const { billing: b, db } = fixture(t);
  b.grant('owner_a', { credits: 100, key: 'fixture_seed' });
  assert.equal(b.grant('owner_a', { credits: 100, key: 'fixture_seed' }).replay, true);
  assert.throws(() => b.grant('owner_a', { credits: 101, key: 'fixture_seed' }), errorCode('credit_idempotency_conflict'));
  b.reserve('owner_a', 'operation_a');
  assert.equal(b.account('owner_a').held, 10);
  const event = usage();
  b.recordUsage('owner_a', 'operation_a', event);
  assert.equal(b.recordUsage('owner_a', 'operation_a', event).replay, true);
  assert.throws(() => b.recordUsage('owner_a', 'operation_a', { ...event, outputTokens: 2 }), errorCode('usage_idempotency_conflict'));
  const result = b.settle('owner_a', 'operation_a', { success: true, infrastructureCostMicros: 0 });
  assert.equal(result.status, 'settled'); assert.equal(result.chargedCredits, 2);
  assert.equal(b.account('owner_a').balance, 98); assert.equal(b.account('owner_a').held, 0);
  assert.equal(b.settle('owner_a', 'operation_a', { success: true, infrastructureCostMicros: 0 }).replay, true);
  b.reverse('owner_a', 'operation_a', 'admin_correction');
  assert.equal(b.account('owner_a').balance, 100);
  assert.equal(b.reverse('owner_a', 'operation_a', 'admin_correction').replay, true);
  b.reserve('owner_a', 'operation_failed'); b.recordUsage('owner_a', 'operation_failed', usage());
  const failed = b.settle('owner_a', 'operation_failed', { success: false, infrastructureCostMicros: 0 });
  assert.equal(failed.status, 'released'); assert.equal(failed.chargedCredits, 0); assert.equal(failed.cost.costMicros, 2000);
  assert.equal(b.account('owner_a').balance, 100); assert.equal(b.account('owner_a').held, 0);
  const journal = db.prepare('SELECT SUM(delta) AS balance,SUM(held_delta) AS held FROM billing_ledger WHERE owner=?').get('owner_a');
  assert.deepEqual({ ...journal }, { balance: 100, held: 0 });
  assert.throws(() => db.exec('DELETE FROM billing_ledger'), /immutable_billing_ledger/);
});

test('another account cannot inspect, settle, meter or reverse an owner reservation', t => {
  const { billing: b } = fixture(t);
  b.grant('owner_a', { credits: 10, key: 'one_reservation_only' });
  b.reserve('owner_a', 'private_operation');
  assert.equal(b.reserve('owner_a', 'private_operation').replay, true, 'replay works even when all credits are held');
  assert.throws(() => b.reserve('owner_b', 'private_operation'), errorCode('billing_operation_not_found'));
  assert.throws(() => b.recordUsage('owner_b', 'private_operation', usage()), errorCode('billing_operation_not_found'));
  assert.throws(() => b.settle('owner_b', 'private_operation', { success: false }), errorCode('billing_operation_not_found'));
  assert.throws(() => b.reverse('owner_b', 'private_operation'), errorCode('billing_operation_not_found'));
  assert.equal(b.account('owner_b').transactions.length, 0);
  assert.equal(b.account('owner_a').held, 10);
});

test('unknown provider or infrastructure costs retain a hold and block further consumption', t => {
  const { billing: b } = fixture(t);
  b.grant('owner_a', { credits: 100, key: 'unknown_cost_seed' });
  b.reserve('owner_a', 'unknown_cost');
  b.recordUsage('owner_a', 'unknown_cost', usage({ outputTokens: null }));
  const review = b.settle('owner_a', 'unknown_cost', { success: true, infrastructureCostMicros: 0 });
  assert.equal(review.status, 'pending_review'); assert.equal(review.chargedCredits, null); assert.equal(review.cost.costMicros, null);
  assert.equal(b.account('owner_a').balance, 100); assert.equal(b.account('owner_a').held, 10);
  assert.throws(() => b.reserve('owner_a', 'next_build'), errorCode('usage_reconciliation_required'));
  b.reverse('owner_a', 'unknown_cost', 'generation_failed');
  b.reserve('owner_a', 'unknown_infrastructure'); b.recordUsage('owner_a', 'unknown_infrastructure', usage());
  assert.equal(b.settle('owner_a', 'unknown_infrastructure', { success: true }).status, 'pending_review');
});

test('known cost over the authorized reservation cap is never silently overdrafted', t => {
  const { billing: b } = fixture(t);
  b.grant('owner_a', { credits: 100, key: 'overage_seed' }); b.reserve('owner_a', 'overage');
  b.recordUsage('owner_a', 'overage', usage({ outputTokens: 100000 }));
  const result = b.settle('owner_a', 'overage', { success: true, infrastructureCostMicros: 0 });
  assert.equal(result.status, 'overage_review'); assert.equal(result.chargedCredits, null);
  assert.equal(b.account('owner_a').balance, 100); assert.equal(b.account('owner_a').held, 10);
});

test('financial writes roll back atomically, including inside an outer account transaction', t => {
  const { billing: b, db } = fixture(t);
  b.grant('owner_a', { credits: 100, key: 'atomic_seed' });
  db.exec("CREATE TRIGGER crash_reservation BEFORE INSERT ON billing_reservation WHEN NEW.operation_id='crash_operation' BEGIN SELECT RAISE(ABORT,'test_crash'); END;");
  db.exec('BEGIN IMMEDIATE');
  assert.throws(() => b.reserve('owner_a', 'crash_operation'), /test_crash/);
  db.exec('COMMIT');
  assert.equal(b.account('owner_a').held, 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM billing_ledger WHERE kind='reserve'").get().n, 0);
});

test('settlement uses the policy agreed at reservation rather than later configuration', t => {
  const f = fixture(t); f.billing.grant('owner_a', { credits: 100, key: 'version_seed' }); f.billing.reserve('owner_a', 'versioned');
  f.billing.recordUsage('owner_a', 'versioned', usage());
  const changed = policy(); changed.version = 'synthetic-test-v2'; changed.creditUnitCostMicros = 1;
  const next = createBilling({ database: f.db, env: { ...f.env, COMPASS_CREDIT_POLICY_JSON: JSON.stringify(changed) }, stripeClient: f.stripe, now: f.now });
  const result = next.settle('owner_a', 'versioned', { success: true, infrastructureCostMicros: 0 });
  assert.equal(result.chargedCredits, 2); assert.equal(result.cost.policyVersion, 'synthetic-test-v1');
});

test('measured costs handle Anthropic TTL caches and inclusive compatible caches without duplication', () => {
  const p = validateCreditPolicy(policy());
  const anthropic = measuredCost(p, [usage({ outputTokens: 200, cacheReadTokens: 500, cacheWriteTokens: 100, cacheWrite5mTokens: 80, cacheWrite1hTokens: 20 })], { infrastructureCostMicros: 410 });
  assert.equal(anthropic.known, true); assert.equal(anthropic.costMicros, 2000); assert.equal(anthropic.credits, 2);
  const compatible = measuredCost(p, [usage({ provider: 'generalcompute', model: 'compat-fixture', inputTokenBasis: 'includes_cache', inputTokens: 1000, outputTokens: 100, cacheReadTokens: 600, cacheWriteTokens: 100 })], { infrastructureCostMicros: 0 });
  assert.equal(compatible.costMicros, 1700); assert.equal(compatible.credits, 2);
  assert.equal(measuredCost(p, [usage({ reportedModel: 'unapproved-dated-model' })], { infrastructureCostMicros: 0 }).known, false);
  assert.equal(measuredCost(p, [usage({ inputTokenBasis: 'includes_cache' })], { infrastructureCostMicros: 0 }).known, false);
  assert.equal(measuredCost(p, [usage({ status: 'timeout' })], { infrastructureCostMicros: 0 }).known, false);
  assert.equal(measuredCost(p, [usage({ usageComplete: false })], { infrastructureCostMicros: 0 }).known, false);
});

test('test checkout is server-priced, idempotent and grants nothing from a success redirect', async t => {
  const f = fixture(t), key = randomUUID();
  const first = await f.billing.checkout('owner_a', { offerId: 'pack', requestKey: key, credits: 1000000, unitAmount: 1, owner: 'owner_b' });
  const again = await f.billing.checkout('owner_a', { offerId: 'pack', requestKey: key });
  assert.equal(first.sessionId, again.sessionId); assert.equal(again.replay, true);
  assert.equal(f.state.calls.filter(item => item.name === 'checkout.sessions.create').length, 1);
  assert.equal(f.billing.account('owner_a').balance, 0);
  const call = f.state.calls.find(item => item.name === 'checkout.sessions.create');
  assert.deepEqual(call.params.line_items, [{ price: 'price_fixturePack', quantity: 1 }]);
  assert.equal(call.params.success_url, 'http://127.0.0.1:8777/workspace?billing=success');
  assert.equal('credits' in call.params.metadata, false); assert.equal('owner' in call.params.metadata, false);
  assert.equal(f.billing.account('owner_b').balance, 0);
  await assert.rejects(f.billing.checkout('owner_a', { offerId: 'plan', requestKey: key }), errorCode('billing_idempotency_conflict'));
});

test('official SDK raw-body signatures reject tampering, replay windows, future stamps and live events', async t => {
  const f = fixture(t);
  const opened = await f.billing.checkout('owner_a', { offerId: 'pack', requestKey: randomUUID() });
  const session = f.state.sessions.get(opened.sessionId);
  const value = f.signed('checkout.session.completed', session);
  const before = f.state.calls.length;
  await assert.rejects(f.billing.webhook(value.payload + ' ', value.signature), errorCode('stripe_webhook_signature_invalid'));
  await assert.rejects(f.billing.webhook(value.payload, 't=1,v1=wrong'), errorCode('stripe_webhook_timestamp_invalid'));
  const future = f.signed('checkout.session.completed', session, {}, { timestamp: Math.floor(f.now()/1000) + 301 });
  await assert.rejects(f.billing.webhook(future.payload, future.signature), errorCode('stripe_webhook_timestamp_invalid'));
  const live = f.signed('checkout.session.completed', session, { livemode: true });
  await assert.rejects(f.billing.webhook(live.payload, live.signature), errorCode('stripe_test_event_required'));
  assert.equal(f.state.calls.length, before, 'bad signatures never trigger a provider request');
  assert.equal(f.billing.account('owner_a').balance, 0);
});

test('verified paid checkout grants once across duplicate event IDs and distinct semantic duplicates', async t => {
  const f = fixture(t), session = await f.checkoutPaid();
  assert.equal(f.billing.account('owner_a').balance, 1000);
  const value = f.signed('checkout.session.completed', session);
  await f.billing.webhook(value.payload, value.signature);
  assert.equal((await f.billing.webhook(value.payload, value.signature)).replay, true);
  await f.deliver('checkout.session.async_payment_succeeded', session);
  assert.equal(f.billing.account('owner_a').balance, 1000);
  assert.equal(f.billing.account('owner_a').payments.length, 1);
  assert.equal(f.billing.account('owner_a').transactions.filter(item => item.kind === 'purchase').length, 1);
  const different = f.signed('checkout.session.completed', { ...session, status: 'open' }, { id: value.event.id });
  await assert.rejects(f.billing.webhook(different.payload, different.signature), errorCode('stripe_event_id_conflict'));
});

test('wrong customer/amount/currency, live key and unapproved Stripe price fail closed', async t => {
  const f = fixture(t);
  const opened = await f.billing.checkout('owner_a', { offerId: 'pack', requestKey: randomUUID() });
  const session = f.state.sessions.get(opened.sessionId);
  Object.assign(session, { status: 'complete', payment_status: 'paid', payment_intent: 'pi_wrong_fixture', amount_total: 1, currency: 'usd' });
  await assert.rejects(f.deliver('checkout.session.completed', session), errorCode('checkout_amount_mismatch'));
  session.amount_total = 100; session.customer = 'cus_other';
  await assert.rejects(f.deliver('checkout.session.completed', session), errorCode('checkout_owner_or_policy_mismatch'));
  assert.equal(f.billing.account('owner_a').balance, 0);
  const live = fixture(t, { env: { STRIPE_SECRET_KEY: 'sk_live_fixture_no_network' } });
  await assert.rejects(live.billing.checkout('owner_a', { offerId: 'pack', requestKey: randomUUID() }), errorCode('stripe_test_setup_required'));
  assert.equal(live.state.calls.length, 0); assert.equal(live.billing.status().liveChargesEnabled, false);
  const invalid = fixture(t); invalid.stripe.prices.retrieve = async () => ({ id: 'price_fixturePack', active: true, livemode: false, currency: 'eur', unit_amount: 100 });
  await assert.rejects(invalid.billing.checkout('owner_a', { offerId: 'pack', requestKey: randomUUID() }), errorCode('stripe_price_policy_mismatch'));
  assert.equal(invalid.state.calls.some(item => item.name === 'checkout.sessions.create'), false);
});

test('pending and failed payment notifications never create credits; current paid state can recover', async t => {
  const f = fixture(t), opened = await f.billing.checkout('owner_a', { offerId: 'pack', requestKey: randomUUID() });
  const session = f.state.sessions.get(opened.sessionId);
  session.status = 'complete';
  await f.deliver('checkout.session.completed', session);
  await f.deliver('checkout.session.async_payment_failed', session);
  assert.equal(f.billing.account('owner_a').balance, 0);
  Object.assign(session, { payment_status: 'paid', payment_intent: 'pi_recovered', amount_total: 100, currency: 'usd' });
  await f.deliver('checkout.session.async_payment_succeeded', session);
  assert.equal(f.billing.account('owner_a').balance, 1000);
});

test('subscriptions require a paid invoice, retain paid access on scheduled cancel, and revoke at expiry', async t => {
  const f = fixture(t), { subscription, invoice } = await f.subscriptionPaid();
  assert.equal(f.billing.account('owner_a').balance, 2000);
  assert.equal(f.billing.assertEntitled('owner_a', 'advanced').source, 'paid_subscription');
  await assert.rejects(f.billing.cancel('owner_b', { subscriptionId: subscription.id, requestKey: randomUUID() }), errorCode('subscription_not_found'));
  const canceled = await f.billing.cancel('owner_a', { subscriptionId: subscription.id, requestKey: randomUUID() });
  assert.equal(canceled.cancelAtPeriodEnd, true);
  assert.equal(f.billing.assertEntitled('owner_a', 'advanced').allowed, true);
  const call = f.state.calls.find(item => item.name === 'subscriptions.update');
  assert.equal(call.params.cancel_at_period_end, true); assert.equal('proration_behavior' in call.params, false);
  await f.deliver('invoice.paid', invoice);
  assert.equal(f.billing.account('owner_a').balance, 2000, 'renewal invoice replay does not duplicate its grant');
  f.advance(31 * 86400000);
  assert.throws(() => f.billing.assertEntitled('owner_a', 'advanced'), errorCode('entitlement_required'));
});

test('subscription payment failures and out-of-order deleted snapshots cannot resurrect paid access', async t => {
  const f = fixture(t), { subscription, invoice } = await f.subscriptionPaid();
  f.advance(1000); subscription.status = 'past_due'; invoice.status = 'open'; invoice.amount_paid = 0; invoice.amount_remaining = 200;
  await f.deliver('invoice.payment_failed', invoice);
  assert.throws(() => f.billing.assertEntitled('owner_a', 'advanced'), errorCode('entitlement_required'));
  f.advance(1000); subscription.status = 'canceled'; await f.deliver('customer.subscription.deleted', subscription);
  const old = { ...subscription, status: 'active' };
  await f.deliver('customer.subscription.updated', old, { created: Math.floor(f.now()/1000) - 50 });
  assert.equal(f.billing.account('owner_a').subscriptions[0].status, 'canceled');
  assert.throws(() => f.billing.assertEntitled('owner_a', 'advanced'), errorCode('entitlement_required'));
});

test('refund accounting handles pending, succeeded, duplicate, partial, failed and full refunds', async t => {
  const f = fixture(t), session = await f.checkoutPaid();
  const first = { id: 're_partial', object: 'refund', amount: 25, currency: 'usd', status: 'pending', payment_intent: session.payment_intent, charge: 'ch_fixture' };
  f.state.refunds.set(first.id, first);
  await f.deliver('refund.created', first); assert.equal(f.billing.account('owner_a').balance, 1000);
  first.status = 'succeeded'; await f.deliver('refund.updated', first); assert.equal(f.billing.account('owner_a').balance, 750);
  await f.deliver('charge.refunded', { id: 'ch_fixture' }); assert.equal(f.billing.account('owner_a').balance, 750);
  first.status = 'failed'; await f.deliver('refund.failed', first); assert.equal(f.billing.account('owner_a').balance, 1000);
  first.status = 'succeeded'; await f.deliver('refund.updated', first); assert.equal(f.billing.account('owner_a').balance, 750);
  const rest = { ...first, id: 're_remainder', amount: 75 }; f.state.refunds.set(rest.id, rest);
  await f.deliver('refund.created', rest); assert.equal(f.billing.account('owner_a').balance, 0);
  assert.equal(f.billing.account('owner_a').payments[0].status, 'refunded');
});

test('refunding consumed credits creates a visible shortfall and blocks further usage', async t => {
  const f = fixture(t), session = await f.checkoutPaid();
  f.billing.reserve('owner_a', 'consumed'); f.billing.recordUsage('owner_a', 'consumed', usage());
  f.billing.settle('owner_a', 'consumed', { success: true, infrastructureCostMicros: 0 });
  const refund = { id: 're_full_after_use', object: 'refund', amount: 100, currency: 'usd', status: 'succeeded', payment_intent: session.payment_intent };
  f.state.refunds.set(refund.id, refund); await f.deliver('refund.created', refund);
  assert.equal(f.billing.account('owner_a').balance, -2);
  assert.equal(f.billing.account('owner_a').available, 0);
  assert.throws(() => f.billing.reserve('owner_a', 'cannot_overdraw'), errorCode('credit_refund_shortfall'));
  assert.equal(f.billing.account('owner_b').balance, 0);
});

test('a fully refunded subscription invoice loses entitlements even if an old paid event repeats', async t => {
  const f = fixture(t), { invoice } = await f.subscriptionPaid();
  const refund = { id: 're_plan_full', object: 'refund', amount: 200, currency: 'usd', status: 'succeeded', payment_intent: invoice.payments.data[0].payment.payment_intent };
  f.state.refunds.set(refund.id, refund); await f.deliver('refund.created', refund);
  assert.throws(() => f.billing.assertEntitled('owner_a', 'advanced'), errorCode('entitlement_required'));
  await f.deliver('invoice.paid', invoice);
  assert.throws(() => f.billing.assertEntitled('owner_a', 'advanced'), errorCode('entitlement_required'));
  assert.equal(f.billing.account('owner_a').balance, 0);
});

test('billing history and portal are owner scoped and administrator summary contains no private payloads', async t => {
  const f = fixture(t); await f.checkoutPaid('owner_a');
  assert.equal(f.billing.account('owner_b').payments.length, 0);
  await assert.rejects(f.billing.portal('owner_b'), errorCode('billing_customer_not_found'));
  assert.equal((await f.billing.portal('owner_a')).mode, 'test');
  const summary = f.billing.monitor();
  assert.equal(summary.attempts, 0);
  assert.equal(JSON.stringify(summary).includes('owner_a'), false);
  assert.equal(JSON.stringify(summary).includes('sk_test'), false);
  assert.equal(JSON.stringify(summary).includes('whsec_'), false);
});

test('test billing refuses the main domain; incomplete live configuration creates no financial tables', async t => {
  for (const env of [
    { COMPASS_BILLING_ORIGIN: 'https://another.example', COMPASS_ACCOUNT_ORIGIN: 'https://accounts.example' },
    { COMPASS_BILLING_ORIGIN: 'https://mycompass.world', COMPASS_ACCOUNT_ORIGIN: 'https://mycompass.world' },
    { COMPASS_BILLING_ORIGIN: 'http://127.0.0.1:8777', COMPASS_ACCOUNT_ORIGIN: undefined },
  ]) {
    const f = fixture(t, { env });
    assert.equal(f.billing.status().billingEnabled, false);
    await assert.rejects(f.billing.checkout('owner_a', { offerId: 'pack', requestKey: randomUUID() }), errorCode('stripe_test_setup_required'));
    assert.equal(f.state.calls.length, 0);
  }
  const disabled = fixture(t, { env: { COMPASS_BILLING_MODE: 'live' } });
  assert.equal(disabled.billing.status().creditsEnabled, false);
  assert.equal(disabled.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'billing_%'").get().n, 0);
});

test('live readiness verifies storage, own merchant and every approved price before exposing offers', async t => {
  const f = liveFixture(t);
  assert.equal(f.billing.status().mode, 'live');
  assert.equal(f.billing.status().billingEnabled, false);
  assert.equal(f.billing.status().creditsEnabled, false);
  assert.deepEqual(f.billing.status().offers, []);
  assert.throws(() => f.billing.reserve('owner_a', 'before_preflight'), errorCode('stripe_live_setup_required'));
  const [first, second] = await Promise.all([f.billing.ready(), f.billing.ready()]);
  assert.equal(first.liveChargesEnabled, true); assert.equal(second.billingEnabled, true);
  assert.equal(first.offers.length, 2);
  assert.deepEqual(f.state.calls.map(item => item.name), ['accounts.retrieve', 'prices.retrieve', 'prices.retrieve']);
  assert.equal(f.billing.account('owner_a').balance, 0, 'preflight never grants credits');
  const bound = f.db.prepare('SELECT mode,merchant_id,verified_at FROM billing_environment').get();
  assert.equal(bound.mode, 'live'); assert.equal(bound.merchant_id, 'acct_fixtureMerchant'); assert.ok(bound.verified_at);
  assert.equal(JSON.stringify(first).includes('acct_'), false, 'public state does not publish merchant configuration');
  assert.equal(JSON.stringify(first).includes('rk_live_'), false);
});

test('live configuration cannot claim working measurement or storage through an environment flag', async t => {
  const missingCost = liveFixture(t, { costMeasurementReady: false, env: { COMPASS_BILLING_COST_MEASUREMENT: 'verified' } });
  assert.equal((await missingCost.billing.ready()).billingEnabled, false);
  assert.ok(missingCost.billing.status().blocked.includes('measured_infrastructure_cost_required'));
  assert.deepEqual(missingCost.state.calls.map(item => item.name), ['accounts.retrieve']);
  await assert.rejects(missingCost.billing.checkout('owner_a', { offerId: 'pack', requestKey: randomUUID() }), errorCode('stripe_live_setup_required'));
  const storage = liveFixture(t, { storageInspector: async () => ({ mode: 'ephemeral-preview', dependencies: ['volume_mount_unverified'] }) });
  assert.ok((await storage.billing.ready()).blocked.includes('durable_billing_storage_required'));
  assert.equal(storage.state.calls.length, 0);
  const wrongDatabase = liveFixture(t, { env: { COMPASS_ACCOUNT_DATABASE: '/not/the/open/database.sqlite' } });
  assert.ok((await wrongDatabase.billing.ready()).blocked.includes('durable_billing_storage_required'));
  assert.equal(wrongDatabase.state.calls.length, 0);
});

test('live mode requires reviewed exact production origin, merchant, matching key and policy approval', async t => {
  for (const env of [
    { COMPASS_ACCOUNT_MODE: 'staging' },
    { COMPASS_BILLING_ORIGIN: 'https://mycompass.world/path' },
    { COMPASS_BILLING_ORIGIN: 'https://mycompass.world?anything=yes' },
    { COMPASS_BILLING_ORIGIN: 'https://other.example' },
    { COMPASS_ACCOUNT_ORIGIN: 'https://www.mycompass.world' },
    { COMPASS_BILLING_ORIGIN: 'http://mycompass.world', COMPASS_ACCOUNT_ORIGIN: 'http://mycompass.world' },
    { STRIPE_ACCOUNT_ID: undefined },
    { COMPASS_BILLING_LIVE_POLICY_VERSION: 'unapproved-policy' },
    { STRIPE_SECRET_KEY: 'sk_test_compass_fixture_not_real' },
  ]) {
    const f = liveFixture(t, { env });
    assert.equal((await f.billing.ready()).liveChargesEnabled, false);
    assert.deepEqual(f.billing.status().offers, []);
    await assert.rejects(f.billing.checkout('owner_a', { offerId: 'pack', requestKey: randomUUID() }), errorCode('stripe_live_setup_required'));
    assert.equal(f.state.calls.length, 0);
  }
  const testRestricted = fixture(t, { env: { STRIPE_SECRET_KEY: 'rk_test_compass_fixture_not_real' } });
  assert.equal((await testRestricted.billing.ready()).billingEnabled, true);
});

test('merchant verification uses the key owner, fails closed and refreshes before every payment action', async t => {
  const f = liveFixture(t);
  f.state.merchant.id = 'acct_someoneElse';
  assert.ok((await f.billing.ready()).blocked.includes('stripe_merchant_account_mismatch'));
  assert.equal(f.state.calls.some(item => item.name === 'customers.create'), false);
  f.state.merchant.id = 'acct_fixtureMerchant';
  assert.equal((await f.billing.ready()).liveChargesEnabled, true);
  await f.checkoutPaid();
  f.state.merchant.charges_enabled = false;
  assert.equal((await f.billing.portal('owner_a')).mode, 'live', 'existing customers retain billing management while new sales are suspended');
  assert.equal(f.billing.status().liveChargesEnabled, false);
  assert.ok(f.billing.status().blocked.includes('stripe_merchant_charges_disabled'));
  assert.equal(f.state.calls.filter(item => item.name === 'billingPortal.sessions.create').length, 1);
  assert.throws(() => f.billing.reserve('owner_a', 'paused_merchant'), errorCode('stripe_live_setup_required'));
  f.state.merchant.charges_enabled = true;
  assert.equal((await f.billing.portal('owner_a')).mode, 'live');
  f.stripe.accounts.retrieve = async () => { throw Error('sensitive upstream details'); };
  const unavailable = await f.billing.ready();
  assert.ok(unavailable.blocked.includes('stripe_merchant_verification_unavailable'));
  assert.equal(JSON.stringify(unavailable).includes('sensitive'), false);
});

test('financial database binding refuses mode and merchant changes and unbound legacy financial data', async t => {
  const f = liveFixture(t); await f.checkoutPaid();
  const options = { database: f.db, stripeClient: f.stripe, costMeasurementReady: true, storageInspector: async () => ({ mode: 'durable' }), now: f.now };
  const calls = f.state.calls.length;
  const otherMerchant = createBilling({ ...options, env: { ...f.env, STRIPE_ACCOUNT_ID: 'acct_anotherMerchant' } });
  assert.ok(otherMerchant.status().blocked.includes('billing_environment_merchant_mismatch'));
  assert.equal((await otherMerchant.ready()).billingEnabled, false);
  assert.throws(() => otherMerchant.grant('owner_a', { credits: 1, key: 'wrong_environment' }), errorCode('credit_policy_setup_required'));
  const testMode = createBilling({ ...options, env: { ...f.env, COMPASS_BILLING_MODE: 'test', STRIPE_SECRET_KEY: 'sk_test_compass_fixture_not_real' } });
  assert.ok(testMode.status().blocked.includes('billing_environment_mode_mismatch'));
  assert.equal(f.state.calls.length, calls);
  assert.equal(f.billing.account('owner_a').balance, 1000);
  assert.throws(() => f.db.exec("UPDATE billing_environment SET mode='test'"), /immutable_billing_environment/);
  assert.throws(() => f.db.exec('DELETE FROM billing_environment'), /immutable_billing_environment/);
  const old = new DatabaseSync(':memory:'); t.after(() => old.close());
  old.exec("CREATE TABLE billing_account(owner TEXT PRIMARY KEY); INSERT INTO billing_account VALUES ('existing_owner')");
  const legacy = createBilling({ database: old, env: { ...f.env, COMPASS_BILLING_MODE: 'test' }, stripeClient: f.stripe });
  assert.ok(legacy.status().blocked.includes('billing_environment_migration_required'));
  assert.equal(old.prepare("SELECT name FROM sqlite_master WHERE name='billing_environment'").get(), undefined);
});

test('live checkout verifies exact returned ownership, price, mode, callbacks and hosted Stripe URL', async t => {
  for (const mutate of [
    value => { value.livemode = false; },
    value => { value.id = 'cs_test_wrongMode'; },
    value => { value.customer = 'cus_someoneElse'; },
    value => { value.client_reference_id = 'bc_someoneElse'; },
    value => { value.metadata.compass_checkout_id = 'bc_someoneElse'; },
    value => { value.mode = 'setup'; },
    value => { value.success_url = 'https://other.example/workspace'; },
    value => { value.url = 'https://checkout.stripe.com.attacker.example/pay'; },
    value => { value.line_items.data[0].quantity = 2; },
    value => { value.total_details.amount_discount = 1; },
  ]) {
    const f = liveFixture(t), create = f.stripe.checkout.sessions.create;
    f.stripe.checkout.sessions.create = async (...args) => { const value = await create(...args); mutate(value); return value; };
    await assert.rejects(f.billing.checkout('owner_a', { offerId: 'pack', requestKey: randomUUID() }), error => ['invalid_stripe_live_checkout', 'checkout_price_policy_mismatch'].includes(error.code));
    assert.equal(f.billing.account('owner_a').balance, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM billing_payment').get().n, 0);
  }
  const wrongPrice = liveFixture(t), retrieve = wrongPrice.stripe.prices.retrieve;
  wrongPrice.stripe.prices.retrieve = async id => ({ ...await retrieve(id), livemode: false });
  assert.ok((await wrongPrice.billing.ready()).blocked.includes('stripe_price_policy_mismatch'));
  assert.equal(wrongPrice.state.calls.some(item => item.name === 'customers.create'), false);
});

test('live signed webhooks grant and refund once, reject cross-mode/Connect, and never trust redirects', async t => {
  const f = liveFixture(t);
  const opened = await f.billing.checkout('owner_a', { offerId: 'pack', requestKey: randomUUID() });
  assert.equal(opened.mode, 'live'); assert.equal(f.billing.account('owner_a').balance, 0);
  const session = f.state.sessions.get(opened.sessionId);
  const before = f.state.calls.length;
  const wrongMode = f.signed('checkout.session.completed', session, { livemode: false });
  await assert.rejects(f.billing.webhook(wrongMode.payload, wrongMode.signature), errorCode('stripe_live_event_required'));
  const connect = f.signed('checkout.session.completed', session, { account: 'acct_other' });
  await assert.rejects(f.billing.webhook(connect.payload, connect.signature), errorCode('stripe_live_event_required'));
  await assert.rejects(f.billing.webhook(connect.payload + ' ', connect.signature), errorCode('stripe_webhook_signature_invalid'));
  assert.equal(f.state.calls.length, before, 'invalid signatures and event scope trigger no upstream calls');
  Object.assign(session, { status: 'complete', payment_status: 'paid', amount_total: 100, currency: 'usd', payment_intent: 'pi_liveFixture' });
  session.livemode = false;
  await assert.rejects(f.deliver('checkout.session.completed', session), errorCode('stripe_live_object_required'));
  session.livemode = true;
  const paid = f.signed('checkout.session.completed', session);
  assert.equal((await f.billing.webhook(paid.payload, paid.signature)).mode, 'live');
  assert.equal((await f.billing.webhook(paid.payload, paid.signature)).replay, true);
  assert.equal(f.billing.account('owner_a').balance, 1000);
  const refund = { id: 're_liveFixture', object: 'refund', amount: 100, currency: 'usd', status: 'succeeded', payment_intent: session.payment_intent };
  f.state.refunds.set(refund.id, refund);
  await f.deliver('refund.created', refund); await f.deliver('refund.updated', refund);
  assert.equal(f.billing.account('owner_a').balance, 0, 'real Refund objects have no livemode property');
  assert.equal(f.billing.account('owner_a').transactions.filter(row => row.kind === 'refund_revoke').length, 1);
});

test('live paid subscription and cancellation preserve existing invoice and refund rules', async t => {
  const f = liveFixture(t), { subscription, invoice } = await f.subscriptionPaid();
  assert.equal(f.billing.account('owner_a').balance, 2000);
  assert.equal(f.billing.assertEntitled('owner_a', 'advanced').allowed, true);
  assert.equal((await f.billing.cancel('owner_a', { subscriptionId: subscription.id, requestKey: randomUUID() })).cancelAtPeriodEnd, true);
  const refund = { id: 're_livePlanFixture', object: 'refund', amount: 200, currency: 'usd', status: 'succeeded', payment_intent: invoice.payments.data[0].payment.payment_intent };
  f.state.refunds.set(refund.id, refund); await f.deliver('refund.created', refund);
  assert.throws(() => f.billing.assertEntitled('owner_a', 'advanced'), errorCode('entitlement_required'));
  await f.deliver('invoice.paid', invoice);
  assert.equal(f.billing.account('owner_a').balance, 0);
});

test('existing payments reconcile after prices are archived, charges stop or cost measurement becomes unavailable', async t => {
  const f = liveFixture(t), { subscription, invoice, session } = await f.subscriptionPaid();
  f.state.merchant.charges_enabled = false;
  const retrieve = f.stripe.prices.retrieve;
  f.stripe.prices.retrieve = async id => ({ ...await retrieve(id), active: false });
  const paused = createBilling({ database: f.db, env: f.env, stripeClient: f.stripe, storageInspector: async () => ({ mode: 'durable' }), costMeasurementReady: false, now: f.now });
  assert.equal((await paused.ready()).billingEnabled, false);
  assert.deepEqual(paused.status().offers, []);
  assert.equal((await paused.cancel('owner_a', { subscriptionId: subscription.id, requestKey: randomUUID() })).cancelAtPeriodEnd, true);
  await assert.rejects(paused.checkout('owner_a', { offerId: 'pack', requestKey: randomUUID() }), errorCode('stripe_live_setup_required'));
  const refund = { id: 're_livePaused', object: 'refund', amount: 200, currency: 'usd', status: 'succeeded', payment_intent: invoice.payments.data[0].payment.payment_intent };
  f.state.refunds.set(refund.id, refund);
  const signed = f.signed('refund.created', refund);
  await paused.webhook(signed.payload, signed.signature);
  assert.equal(paused.account('owner_a').balance, 0);
  // A delayed snapshot for an already-paid, owner-bound Checkout still uses its
  // original immutable terms, even after new sales have been suspended.
  session.line_items.data[0].price.active = false;
  const replay = f.signed('checkout.session.completed', session);
  await paused.webhook(replay.payload, replay.signature);
  assert.equal(paused.account('owner_a').balance, 0);
  f.state.merchant.id = 'acct_anotherMerchant';
  const blocked = f.signed('refund.updated', refund);
  await assert.rejects(paused.webhook(blocked.payload, blocked.signature), errorCode('stripe_live_setup_required'));
});
