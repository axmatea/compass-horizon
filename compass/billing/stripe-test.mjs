import Stripe from 'stripe';
import { randomUUID, createHash } from 'node:crypto';
import { reject, integer, identifier } from './policy.mjs';

const ref = value => typeof value === 'string' ? value : value?.id;
const stripeId = (value, prefix) => typeof value === 'string' && new RegExp('^' + prefix + '_[A-Za-z0-9_]{1,160}$').test(value);
const requestKey = value => typeof value === 'string' && /^[A-Za-z0-9_-]{16,100}$/.test(value);
const sha = value => createHash('sha256').update(value).digest('hex');
const ceil = (n, d) => (n + d - 1n) / d;
const terminal = ['canceled', 'unpaid', 'incomplete_expired'];

function billingOrigin(env) {
  try {
    const url = new URL(env.COMPASS_BILLING_ORIGIN);
    const accountUrl = new URL(env.COMPASS_ACCOUNT_ORIGIN);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    if (accountUrl.username || accountUrl.password || accountUrl.search || accountUrl.hash || accountUrl.pathname !== '/' || accountUrl.origin !== url.origin) return null;
    const host = url.hostname.replace(/\.+$/, '');
    if (['mycompass.world', 'www.mycompass.world'].includes(host)) return null;
    if (url.protocol === 'https:') return url.origin;
    if (env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(host)) return url.origin;
  } catch {}
  return null;
}

function externalUrl(value, hosts) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && hosts.includes(url.hostname) ? url.href : null;
  } catch { return null; }
}

// Test-only payment transport. This file deliberately has no live-mode branch.
export function createStripeTestAdapter(ledger, { env, stripeClient, now = () => Date.now() }) {
  const { database: db, policy, transaction, ensureAccount, addEntry } = ledger;
  const origin = billingOrigin(env);
  const key = env.STRIPE_SECRET_KEY;
  const signingSecret = env.STRIPE_WEBHOOK_SECRET;
  const blocked = [];
  if (!origin) blocked.push('exact_test_billing_origin_required');
  if (typeof key !== 'string' || !/^sk_test_[A-Za-z0-9_]{8,}$/.test(key)) blocked.push('stripe_test_secret_key_required');
  if (typeof signingSecret !== 'string' || !/^whsec_[A-Za-z0-9_]{8,}$/.test(signingSecret)) blocked.push('stripe_test_webhook_secret_required');
  if (!policy.offers.length) blocked.push('approved_stripe_test_offers_required');
  const enabled = !blocked.length;
  const stripe = enabled ? stripeClient || new Stripe(key, { timeout: 8000, maxNetworkRetries: 1 }) : null;
  db.exec(`
    CREATE TABLE IF NOT EXISTS billing_customer (owner TEXT PRIMARY KEY, account_id TEXT NOT NULL UNIQUE, customer_id TEXT UNIQUE);
    CREATE TABLE IF NOT EXISTS billing_checkout (id TEXT PRIMARY KEY, owner TEXT NOT NULL, request_key TEXT NOT NULL, kind TEXT NOT NULL, offer_json TEXT NOT NULL,
      status TEXT NOT NULL, customer_id TEXT, session_id TEXT UNIQUE, checkout_url TEXT, payment_id TEXT UNIQUE, subscription_id TEXT, created_at TEXT NOT NULL, UNIQUE(owner,request_key));
    CREATE UNIQUE INDEX IF NOT EXISTS billing_one_subscription_checkout ON billing_checkout(owner) WHERE kind='subscription' AND status IN ('pending','open','complete');
    CREATE TABLE IF NOT EXISTS billing_payment (id TEXT PRIMARY KEY, owner TEXT NOT NULL, customer_id TEXT NOT NULL, payment_intent_id TEXT UNIQUE, invoice_id TEXT UNIQUE,
      offer_json TEXT NOT NULL, amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, credits INTEGER NOT NULL, revoked_credits INTEGER NOT NULL DEFAULT 0,
      refund_version INTEGER NOT NULL DEFAULT 0, subscription_id TEXT, period_end INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS billing_payment_owner ON billing_payment(owner,created_at);
    CREATE TABLE IF NOT EXISTS billing_subscription (id TEXT PRIMARY KEY, owner TEXT NOT NULL, checkout_id TEXT NOT NULL, customer_id TEXT NOT NULL,
      offer_json TEXT NOT NULL, status TEXT NOT NULL, paid_through INTEGER NOT NULL DEFAULT 0, current_period_end INTEGER NOT NULL DEFAULT 0,
      cancel_at_period_end INTEGER NOT NULL DEFAULT 0, event_created INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS billing_refund (id TEXT PRIMARY KEY, payment_id TEXT NOT NULL, amount_minor INTEGER NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS billing_event (id TEXT PRIMARY KEY, type TEXT NOT NULL, payload_hash TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL);
  `);
  const paymentColumns = new Set(db.prepare('PRAGMA table_info(billing_payment)').all().map(column => column.name));
  for (const [name, definition] of [['refund_version', 'INTEGER NOT NULL DEFAULT 0'], ['subscription_id', 'TEXT'], ['period_end', 'INTEGER NOT NULL DEFAULT 0']]) {
    if (!paymentColumns.has(name)) db.exec('ALTER TABLE billing_payment ADD COLUMN ' + name + ' ' + definition);
  }
  const stamp = () => new Date(now()).toISOString();
  const requireReady = () => { if (!enabled) reject(503, 'stripe_test_setup_required'); };
  const api = async run => { try { return await run(); } catch { reject(502, 'stripe_test_api_unavailable'); } };
  function offerFor(id) { const offer = policy.offers.find(item => item.id === id); if (!offer) reject(400, 'unknown_billing_offer'); return offer; }
  function ownedCustomer(owner) {
    ensureAccount(owner);
    const row = db.prepare('SELECT * FROM billing_customer WHERE owner=?').get(owner);
    if (!row?.customer_id) reject(404, 'billing_customer_not_found');
    return row;
  }
  async function customer(owner) {
    const row = transaction(() => {
      ensureAccount(owner);
      db.prepare('INSERT INTO billing_customer(owner,account_id) VALUES (?,?) ON CONFLICT(owner) DO NOTHING').run(owner, 'ba_' + randomUUID());
      return db.prepare('SELECT * FROM billing_customer WHERE owner=?').get(owner);
    });
    if (row.customer_id) return row.customer_id;
    const value = await api(() => stripe.customers.create({ metadata: { compass_account_id: row.account_id } }, { idempotencyKey: 'compass:customer:' + row.account_id }));
    if (!stripeId(value?.id, 'cus') || value.livemode !== false) reject(502, 'invalid_stripe_test_customer');
    transaction(() => {
      const current = db.prepare('SELECT * FROM billing_customer WHERE owner=?').get(owner);
      if (current.customer_id && current.customer_id !== value.id) reject(409, 'stripe_customer_conflict');
      db.prepare('UPDATE billing_customer SET customer_id=? WHERE owner=?').run(value.id, owner);
    });
    return value.id;
  }
  function assertPrice(price, offer) {
    if (!price || price.id !== offer.priceId || price.livemode !== false || price.active !== true || price.currency !== offer.currency || price.unit_amount !== offer.unitAmount
      || (offer.kind === 'credits' ? Boolean(price.recurring) : price.recurring?.interval !== offer.interval || price.recurring?.interval_count !== offer.intervalCount)) reject(409, 'stripe_price_policy_mismatch');
  }
  async function checkout(owner, { offerId, requestKey: keyValue } = {}) {
    requireReady();
    if (!requestKey(keyValue)) reject(400, 'billing_idempotency_key_required');
    const offer = offerFor(offerId);
    const intent = transaction(() => {
      ensureAccount(owner);
      const previous = db.prepare('SELECT * FROM billing_checkout WHERE owner=? AND request_key=?').get(owner, keyValue);
      if (previous) {
        if (JSON.parse(previous.offer_json).id !== offer.id) reject(409, 'billing_idempotency_conflict');
        if (['failed','expired','ended'].includes(previous.status)) reject(409, 'checkout_closed');
        return previous;
      }
      if (offer.kind === 'subscription' && db.prepare("SELECT 1 AS n FROM billing_checkout WHERE owner=? AND kind='subscription' AND status IN ('pending','open','complete')").get(owner)) reject(409, 'subscription_already_exists');
      const id = 'bc_' + randomUUID();
      db.prepare('INSERT INTO billing_checkout(id,owner,request_key,kind,offer_json,status,created_at) VALUES (?,?,?,?,?,?,?)').run(id, owner, keyValue, offer.kind, JSON.stringify(offer), 'pending', stamp());
      return db.prepare('SELECT * FROM billing_checkout WHERE id=?').get(id);
    });
    if (intent.checkout_url) return { url: intent.checkout_url, sessionId: intent.session_id, mode: 'test', replay: true };
    // Replaying an existing pending checkout uses its original approved offer.
    const snapshot = JSON.parse(intent.offer_json);
    const customerId = await customer(owner);
    const price = await api(() => stripe.prices.retrieve(snapshot.priceId));
    assertPrice(price, snapshot);
    transaction(() => db.prepare('UPDATE billing_checkout SET customer_id=? WHERE id=? AND owner=?').run(customerId, intent.id, owner));
    const metadata = { compass_checkout_id: intent.id };
    const value = await api(() => stripe.checkout.sessions.create({
      mode: snapshot.kind === 'credits' ? 'payment' : 'subscription', customer: customerId,
      client_reference_id: intent.id, metadata, line_items: [{ price: snapshot.priceId, quantity: 1 }],
      success_url: origin + '/workspace?billing=success', cancel_url: origin + '/workspace?billing=canceled',
      ...(snapshot.kind === 'credits' ? { payment_intent_data: { metadata } } : { subscription_data: { metadata } }),
    }, { idempotencyKey: 'compass:checkout:' + intent.id }));
    const url = externalUrl(value?.url, ['checkout.stripe.com']);
    if (!stripeId(value?.id, 'cs_test') || value.livemode !== false || ref(value.customer) !== customerId || !url) reject(502, 'invalid_stripe_test_checkout');
    transaction(() => {
      const current = db.prepare('SELECT session_id FROM billing_checkout WHERE id=?').get(intent.id);
      if (current.session_id && current.session_id !== value.id) reject(409, 'checkout_session_conflict');
      db.prepare("UPDATE billing_checkout SET session_id=?,checkout_url=?,status=CASE WHEN status='pending' THEN 'open' ELSE status END WHERE id=? AND owner=?").run(value.id, url, intent.id, owner);
    });
    return { url, sessionId: value.id, mode: 'test', replay: false };
  }
  async function portal(owner) {
    requireReady();
    const row = ownedCustomer(owner);
    const value = await api(() => stripe.billingPortal.sessions.create({ customer: row.customer_id, return_url: origin + '/workspace?billing=returned' }));
    const url = externalUrl(value?.url, ['billing.stripe.com']);
    if (!url) reject(502, 'invalid_stripe_test_portal');
    return { url, mode: 'test' };
  }
  function subscriptionContext(value) {
    if (!stripeId(value?.id, 'sub') || value.livemode !== false || !stripeId(ref(value.customer), 'cus')) reject(400, 'invalid_test_subscription');
    const checkoutId = value.metadata?.compass_checkout_id;
    const intent = typeof checkoutId === 'string' ? db.prepare('SELECT * FROM billing_checkout WHERE id=?').get(checkoutId) : null;
    if (!intent || intent.kind !== 'subscription' || intent.customer_id !== ref(value.customer)) reject(409, 'unrecognized_subscription');
    const offer = JSON.parse(intent.offer_json);
    const items = value.items?.data;
    if (!Array.isArray(items) || items.length !== 1 || ref(items[0].price) !== offer.priceId || items[0].quantity !== 1) reject(409, 'subscription_price_mismatch');
    const periodEnd = items[0].current_period_end ?? value.current_period_end;
    if (!integer(periodEnd)) reject(409, 'subscription_period_required');
    if (!['active','trialing','past_due','canceled','unpaid','paused','incomplete','incomplete_expired'].includes(value.status)) reject(409, 'unsupported_subscription_status');
    return { intent, offer, periodEnd };
  }
  function applySubscription(value, created) {
    const { intent, offer, periodEnd } = subscriptionContext(value);
    const previous = db.prepare('SELECT * FROM billing_subscription WHERE id=?').get(value.id);
    if (previous && (previous.owner !== intent.owner || previous.customer_id !== intent.customer_id || previous.checkout_id !== intent.id)) reject(409, 'subscription_identity_conflict');
    if (previous && created < previous.event_created) return previous;
    db.prepare(`INSERT INTO billing_subscription(id,owner,checkout_id,customer_id,offer_json,status,paid_through,current_period_end,cancel_at_period_end,event_created,updated_at)
      VALUES (?,?,?,?,?,?,0,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,current_period_end=excluded.current_period_end,
      cancel_at_period_end=excluded.cancel_at_period_end,event_created=excluded.event_created,updated_at=excluded.updated_at`)
      .run(value.id, intent.owner, intent.id, intent.customer_id, JSON.stringify(offer), value.status, periodEnd, value.cancel_at_period_end === true ? 1 : 0, created, stamp());
    db.prepare('UPDATE billing_checkout SET subscription_id=? WHERE id=?').run(value.id, intent.id);
    if (terminal.includes(value.status)) db.prepare("UPDATE billing_checkout SET status='ended' WHERE id=?").run(intent.id);
    return db.prepare('SELECT * FROM billing_subscription WHERE id=?').get(value.id);
  }
  async function cancel(owner, { subscriptionId, requestKey: keyValue } = {}) {
    requireReady();
    if (!stripeId(subscriptionId, 'sub') || !requestKey(keyValue)) reject(400, 'invalid_subscription_cancellation');
    const row = db.prepare('SELECT * FROM billing_subscription WHERE id=? AND owner=?').get(subscriptionId, owner);
    if (!row) reject(404, 'subscription_not_found');
    if (terminal.includes(row.status) || row.cancel_at_period_end) return { subscriptionId, cancelAtPeriodEnd: Boolean(row.cancel_at_period_end), status: row.status, replay: true };
    const value = await api(() => stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true }, { idempotencyKey: 'compass:cancel:' + sha(owner + '\0' + keyValue + '\0' + subscriptionId) }));
    const context = subscriptionContext(value);
    if (context.intent.owner !== owner || value.cancel_at_period_end !== true) reject(502, 'invalid_subscription_cancellation');
    transaction(() => applySubscription(value, row.event_created));
    return { subscriptionId, cancelAtPeriodEnd: true, status: value.status, replay: false };
  }
  function savePayment({ id, owner, customerId, paymentIntent, invoiceId = null, subscriptionId = null, periodEnd = 0, offer, amount }) {
    const previous = db.prepare('SELECT * FROM billing_payment WHERE id=? OR payment_intent_id=? OR invoice_id=?').get(id, paymentIntent, invoiceId);
    if (previous) {
      if (previous.id !== id || previous.owner !== owner || previous.customer_id !== customerId || previous.amount_minor !== amount || previous.currency !== offer.currency || previous.credits !== offer.credits
        || previous.subscription_id !== subscriptionId || previous.period_end !== periodEnd) reject(409, 'payment_idempotency_conflict');
      return { replay: true, paymentId: previous.id };
    }
    addEntry(owner, { delta: offer.credits, kind: 'purchase', reference: id, key: 'stripe:purchase:' + id });
    db.prepare('INSERT INTO billing_payment(id,owner,customer_id,payment_intent_id,invoice_id,subscription_id,period_end,offer_json,amount_minor,currency,credits,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, owner, customerId, paymentIntent, invoiceId, subscriptionId, periodEnd, JSON.stringify(offer), amount, offer.currency, offer.credits, 'paid', stamp());
    return { replay: false, paymentId: id };
  }
  function applyCheckout(value) {
    const id = value.metadata?.compass_checkout_id;
    const intent = typeof id === 'string' ? db.prepare('SELECT * FROM billing_checkout WHERE id=?').get(id) : null;
    if (!intent) reject(409, 'unrecognized_checkout');
    const offer = JSON.parse(intent.offer_json);
    if (value.livemode !== false || !stripeId(value.id, 'cs_test') || (intent.session_id && intent.session_id !== value.id) || ref(value.customer) !== intent.customer_id
      || value.client_reference_id !== intent.id || value.mode !== (offer.kind === 'credits' ? 'payment' : 'subscription')) reject(409, 'checkout_owner_or_policy_mismatch');
    if (value.status === 'expired') { db.prepare("UPDATE billing_checkout SET status='expired',session_id=? WHERE id=? AND status<>'complete'").run(value.id, intent.id); return { status: 'expired' }; }
    if (value.payment_status !== 'paid' || value.status !== 'complete') return { status: 'pending_payment' };
    if (value.amount_total !== offer.unitAmount || value.currency !== offer.currency) reject(409, 'checkout_amount_mismatch');
    db.prepare("UPDATE billing_checkout SET status='complete',session_id=? WHERE id=?").run(value.id, intent.id);
    if (offer.kind === 'subscription') return { status: 'awaiting_paid_invoice' };
    const paymentIntent = ref(value.payment_intent);
    if (!stripeId(paymentIntent, 'pi')) reject(409, 'checkout_payment_intent_required');
    const result = savePayment({ id: value.id, owner: intent.owner, customerId: intent.customer_id, paymentIntent, offer, amount: value.amount_total });
    db.prepare('UPDATE billing_checkout SET payment_id=? WHERE id=?').run(paymentIntent, intent.id);
    return { status: 'paid', ...result };
  }
  function invoiceSubscription(value) { return ref(value.subscription) || ref(value.parent?.subscription_details?.subscription); }
  function invoicePayment(value) { return ref(value.payment_intent) || ref(value.payments?.data?.find(item => item.status === 'paid')?.payment?.payment_intent); }
  function applyInvoice(invoice, subscription, created, paid) {
    const current = applySubscription(subscription, created);
    if (invoice.livemode !== false || ref(invoice.customer) !== current.customer_id || invoiceSubscription(invoice) !== subscription.id) reject(409, 'invoice_owner_mismatch');
    if (!paid) {
      if (created >= current.event_created) db.prepare("UPDATE billing_subscription SET status='payment_failed',event_created=?,updated_at=? WHERE id=?").run(created, stamp(), subscription.id);
      return { status: 'payment_failed' };
    }
    const offer = JSON.parse(current.offer_json), lines = invoice.lines?.data;
    const line = Array.isArray(lines) && lines.length === 1 ? lines[0] : null;
    const price = line && (ref(line.price) || ref(line.pricing?.price_details?.price));
    const periodEnd = line?.period?.end;
    if (invoice.status !== 'paid' || invoice.amount_paid !== offer.unitAmount || invoice.amount_remaining !== 0 || invoice.currency !== offer.currency || price !== offer.priceId || line.quantity !== 1
      || !integer(periodEnd) || !integer(line.period?.start) || line.period.start >= periodEnd || line.proration === true || invoice.lines?.has_more) reject(409, 'invoice_policy_mismatch');
    const paymentIntent = invoicePayment(invoice);
    if (!stripeId(paymentIntent, 'pi')) reject(409, 'invoice_payment_intent_required');
    const result = savePayment({ id: invoice.id, owner: current.owner, customerId: current.customer_id, paymentIntent, invoiceId: invoice.id, subscriptionId: subscription.id, periodEnd, offer, amount: invoice.amount_paid });
    // Payment history remains valid after cancellation, but a paid invoice does
    // not reactivate a canceled/failed subscription or override current status.
    const paidThrough = db.prepare("SELECT COALESCE(MAX(period_end),0) AS through FROM billing_payment WHERE subscription_id=? AND status<>'refunded'").get(subscription.id).through;
    db.prepare('UPDATE billing_subscription SET paid_through=?,updated_at=? WHERE id=?').run(paidThrough, stamp(), subscription.id);
    return { status: 'paid', ...result };
  }
  function applyRefund(value) {
    if (!stripeId(value?.id, 're') || value.livemode === true || !integer(value.amount) || !['pending','requires_action','succeeded','failed','canceled'].includes(value.status)) reject(400, 'invalid_test_refund');
    const paymentIntent = ref(value.payment_intent);
    if (!stripeId(paymentIntent, 'pi')) reject(409, 'refund_payment_intent_required');
    const payment = db.prepare('SELECT * FROM billing_payment WHERE payment_intent_id=?').get(paymentIntent);
    if (!payment) reject(409, 'refund_payment_not_reconciled');
    if (value.currency !== payment.currency || value.amount > payment.amount_minor) reject(409, 'refund_amount_mismatch');
    const previous = db.prepare('SELECT * FROM billing_refund WHERE id=?').get(value.id);
    if (previous && (previous.payment_id !== payment.id || previous.amount_minor !== value.amount)) reject(409, 'refund_idempotency_conflict');
    db.prepare('INSERT INTO billing_refund(id,payment_id,amount_minor,status,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at')
      .run(value.id, payment.id, value.amount, value.status, stamp());
    const refunded = db.prepare("SELECT COALESCE(SUM(amount_minor),0) AS amount FROM billing_refund WHERE payment_id=? AND status='succeeded'").get(payment.id).amount;
    if (refunded > payment.amount_minor) reject(409, 'refund_total_exceeds_payment');
    const revoked = Number(ceil(BigInt(payment.credits) * BigInt(refunded), BigInt(payment.amount_minor)));
    const delta = payment.revoked_credits - revoked;
    if (delta) addEntry(payment.owner, { delta, kind: delta < 0 ? 'refund_revoke' : 'refund_restore', reference: value.id, key: 'stripe:refund-state:' + payment.id + ':' + (payment.refund_version + 1) });
    db.prepare('UPDATE billing_payment SET revoked_credits=?,refund_version=?,status=? WHERE id=?').run(revoked, payment.refund_version + (delta ? 1 : 0), refunded === payment.amount_minor ? 'refunded' : refunded ? 'partially_refunded' : 'paid', payment.id);
    if (payment.subscription_id) {
      const remaining = db.prepare("SELECT COALESCE(MAX(period_end),0) AS through FROM billing_payment WHERE subscription_id=? AND status<>'refunded'").get(payment.subscription_id).through;
      db.prepare('UPDATE billing_subscription SET paid_through=?,updated_at=? WHERE id=?').run(remaining, stamp(), payment.subscription_id);
    }
    return { status: value.status, revokedCredits: revoked, paymentId: payment.id };
  }
  async function webhook(rawBody, signature) {
    requireReady();
    if ((!Buffer.isBuffer(rawBody) && typeof rawBody !== 'string') || Buffer.byteLength(rawBody) > 512 * 1024 || typeof signature !== 'string' || signature.length > 2048) reject(400, 'invalid_stripe_webhook');
    const timestamps = signature.split(',').filter(item => item.startsWith('t=')).map(item => Number(item.slice(2)));
    if (timestamps.length !== 1 || !integer(timestamps[0]) || Math.abs(Math.floor(now() / 1000) - timestamps[0]) > 300) reject(400, 'stripe_webhook_timestamp_invalid');
    let event;
    try { event = Stripe.webhooks.constructEvent(rawBody, signature, signingSecret, 300, undefined, now()); }
    catch { reject(400, 'stripe_webhook_signature_invalid'); }
    if (!stripeId(event.id, 'evt') || event.livemode !== false || event.account || !integer(event.created) || typeof event.type !== 'string' || event.type.length > 100 || !event.data?.object) reject(400, 'stripe_test_event_required');
    const hash = sha(rawBody);
    const previous = db.prepare('SELECT * FROM billing_event WHERE id=?').get(event.id);
    if (previous) { if (previous.payload_hash !== hash) reject(409, 'stripe_event_id_conflict'); return { ...JSON.parse(previous.result_json), replay: true }; }
    const object = event.data.object;
    let execute = () => ({ status: 'ignored' });
    if (['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired'].includes(event.type)) {
      if (!stripeId(object.id, 'cs_test')) reject(400, 'invalid_checkout_event');
      const current = await api(() => stripe.checkout.sessions.retrieve(object.id));
      if (current?.id !== object.id) reject(502, 'stripe_resource_id_mismatch');
      execute = () => applyCheckout(current);
    } else if (['customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','customer.subscription.paused','customer.subscription.resumed'].includes(event.type)) {
      if (!stripeId(object.id, 'sub')) reject(400, 'invalid_subscription_event');
      const current = await api(() => stripe.subscriptions.retrieve(object.id));
      if (current?.id !== object.id) reject(502, 'stripe_resource_id_mismatch');
      execute = () => ({ status: applySubscription(current, event.created).status });
    } else if (['invoice.paid','invoice.payment_failed'].includes(event.type)) {
      if (!stripeId(object.id, 'in')) reject(400, 'invalid_invoice_event');
      const current = await api(() => stripe.invoices.retrieve(object.id));
      if (current?.id !== object.id) reject(502, 'stripe_resource_id_mismatch');
      const subscriptionId = invoiceSubscription(current);
      if (!stripeId(subscriptionId, 'sub')) reject(409, 'invoice_subscription_required');
      const subscription = await api(() => stripe.subscriptions.retrieve(subscriptionId));
      if (subscription?.id !== subscriptionId) reject(502, 'stripe_resource_id_mismatch');
      execute = () => applyInvoice(current, subscription, event.created, current.status === 'paid');
    } else if (['refund.created','refund.updated','refund.failed'].includes(event.type)) {
      if (!stripeId(object.id, 're')) reject(400, 'invalid_refund_event');
      const current = await api(() => stripe.refunds.retrieve(object.id));
      if (current?.id !== object.id) reject(502, 'stripe_resource_id_mismatch');
      execute = () => applyRefund(current);
    } else if (event.type === 'charge.refunded') {
      if (!stripeId(object.id, 'ch')) reject(400, 'invalid_charge_refund_event');
      const refunds = await api(() => stripe.refunds.list({ charge: object.id, limit: 100 }));
      if (!Array.isArray(refunds.data) || refunds.has_more) reject(503, 'refund_reconciliation_required');
      execute = () => ({ status: 'refunds_reconciled', refunds: refunds.data.map(applyRefund) });
    }
    return transaction(() => {
      const duplicate = db.prepare('SELECT * FROM billing_event WHERE id=?').get(event.id);
      if (duplicate) { if (duplicate.payload_hash !== hash) reject(409, 'stripe_event_id_conflict'); return { ...JSON.parse(duplicate.result_json), replay: true }; }
      const result = { ...execute(), mode: 'test', replay: false };
      db.prepare('INSERT INTO billing_event(id,type,payload_hash,result_json,created_at) VALUES (?,?,?,?,?)').run(event.id, event.type, hash, JSON.stringify(result), stamp());
      return result;
    });
  }
  function subscriptions(owner) {
    ensureAccount(owner);
    return db.prepare('SELECT * FROM billing_subscription WHERE owner=? ORDER BY updated_at DESC').all(owner).map(row => ({
      id: row.id, status: row.status, offerId: JSON.parse(row.offer_json).id, paidThrough: row.paid_through,
      cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
      features: row.status === 'active' && row.paid_through > Math.floor(now() / 1000) ? JSON.parse(row.offer_json).features : [],
    }));
  }
  function history(owner) {
    ensureAccount(owner);
    return db.prepare('SELECT id,status,amount_minor AS amountMinor,currency,credits,revoked_credits AS revokedCredits,created_at AS at FROM billing_payment WHERE owner=? ORDER BY rowid DESC LIMIT 100').all(owner);
  }
  return { enabled, blocked, origin, checkout, portal, cancel, webhook, subscriptions, history };
}
