import { randomUUID } from 'node:crypto';
import { reject, integer, identifier, measuredCost, validateCreditPolicy } from './policy.mjs';

const MAX = Number.MAX_SAFE_INTEGER;
const ownerId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const operationId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const counts = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'cacheWrite5mTokens', 'cacheWrite1hTokens', 'reasoningTokens', 'totalTokens'];
const statuses = ['accepted', 'rejected_shape', 'parse_error', 'http_error', 'network_error', 'timeout', 'aborted', 'completed', 'incomplete', 'error'];
const safeModel = value => typeof value === 'string' && /^[A-Za-z0-9_./:+-]{1,120}$/.test(value) ? value : null;
const identity = owner => { if (!ownerId(owner)) reject(400, 'invalid_billing_owner'); };

function receipt(value) {
  if (!value || !operationId(value.id) || !['anthropic', 'generalcompute', 'nebius', 'unknown'].includes(value.provider) || !statuses.includes(value.status)
    || !['includes_cache', 'excludes_cache'].includes(value.inputTokenBasis)) reject(400, 'invalid_usage_receipt');
  const clean = { id: value.id, provider: value.provider, model: safeModel(value.model), reportedModel: safeModel(value.reportedModel), status: value.status,
    inputTokenBasis: value.inputTokenBasis, httpStatus: integer(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599 ? value.httpStatus : null,
    durationMs: integer(value.durationMs) ? value.durationMs : null, usageComplete: typeof value.usageComplete === 'boolean' ? value.usageComplete : null };
  for (const field of counts) clean[field] = integer(value[field]) ? value[field] : null;
  return clean;
}

/** Server-only, owner-scoped SQLite ledger. No method accepts a client balance. */
export function createCreditLedger(database, policy, now = () => Date.now()) {
  if (!database?.exec || !database?.prepare) throw new TypeError('Billing requires an existing SQLite database');
  database.exec(`
    CREATE TABLE IF NOT EXISTS billing_account (owner TEXT PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0, held INTEGER NOT NULL DEFAULT 0 CHECK(held>=0), created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS billing_ledger (id TEXT PRIMARY KEY, owner TEXT NOT NULL, delta INTEGER NOT NULL, held_delta INTEGER NOT NULL, kind TEXT NOT NULL,
      reference TEXT NOT NULL, external_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS billing_ledger_owner ON billing_ledger(owner, created_at);
    CREATE TRIGGER IF NOT EXISTS billing_ledger_no_update BEFORE UPDATE ON billing_ledger BEGIN SELECT RAISE(ABORT,'immutable_billing_ledger'); END;
    CREATE TRIGGER IF NOT EXISTS billing_ledger_no_delete BEFORE DELETE ON billing_ledger BEGIN SELECT RAISE(ABORT,'immutable_billing_ledger'); END;
    CREATE TABLE IF NOT EXISTS billing_reservation (operation_id TEXT PRIMARY KEY, owner TEXT NOT NULL, hold_credits INTEGER NOT NULL, status TEXT NOT NULL,
      policy_json TEXT NOT NULL, settlement_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS billing_reservation_owner ON billing_reservation(owner, created_at);
    CREATE TABLE IF NOT EXISTS billing_usage (id TEXT PRIMARY KEY, operation_id TEXT NOT NULL, owner TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS billing_usage_operation ON billing_usage(owner, operation_id);
    CREATE TRIGGER IF NOT EXISTS billing_usage_no_update BEFORE UPDATE ON billing_usage BEGIN SELECT RAISE(ABORT,'immutable_billing_usage'); END;
    CREATE TRIGGER IF NOT EXISTS billing_usage_no_delete BEFORE DELETE ON billing_usage BEGIN SELECT RAISE(ABORT,'immutable_billing_usage'); END;
    CREATE TRIGGER IF NOT EXISTS billing_reservation_terms_no_update BEFORE UPDATE OF operation_id,owner,hold_credits,policy_json ON billing_reservation BEGIN SELECT RAISE(ABORT,'immutable_billing_reservation_terms'); END;
  `);
  const stamp = () => new Date(now()).toISOString();
  function transaction(run) {
    // The caller may deliberately compose multiple stores in the same atomic
    // transaction. Only the layer that opens it owns COMMIT/ROLLBACK.
    const outer = Boolean(database.isTransaction);
    const point = outer ? 'billing_' + randomUUID().replaceAll('-', '') : '';
    database.exec(outer ? 'SAVEPOINT ' + point : 'BEGIN IMMEDIATE');
    try { const value = run(); database.exec(outer ? 'RELEASE SAVEPOINT ' + point : 'COMMIT'); return value; }
    catch (error) {
      if (outer) { database.exec('ROLLBACK TO SAVEPOINT ' + point); database.exec('RELEASE SAVEPOINT ' + point); }
      else database.exec('ROLLBACK');
      throw error;
    }
  }
  function ensureAccount(owner) {
    identity(owner);
    database.prepare('INSERT INTO billing_account(owner,created_at) VALUES (?,?) ON CONFLICT(owner) DO NOTHING').run(owner, stamp());
    return database.prepare('SELECT balance,held FROM billing_account WHERE owner=?').get(owner);
  }
  function addEntry(owner, { delta, heldDelta = 0, kind, reference, key }) {
    identity(owner);
    if (!Number.isSafeInteger(delta) || !Number.isSafeInteger(heldDelta) || !identifier(kind) || !identifier(reference) || typeof key !== 'string' || key.length > 240) reject(400, 'invalid_credit_transaction');
    const prior = database.prepare('SELECT * FROM billing_ledger WHERE external_key=?').get(key);
    if (prior) {
      if (prior.owner !== owner || prior.delta !== delta || prior.held_delta !== heldDelta || prior.kind !== kind || prior.reference !== reference) reject(409, 'credit_idempotency_conflict');
      return { id: prior.id, replay: true };
    }
    const account = ensureAccount(owner);
    const balance = account.balance + delta, held = account.held + heldDelta;
    if (!Number.isSafeInteger(balance) || !Number.isSafeInteger(held) || Math.abs(balance) > MAX || held < 0) reject(409, 'credit_balance_overflow');
    const id = 'cr_' + randomUUID();
    database.prepare('UPDATE billing_account SET balance=?,held=? WHERE owner=?').run(balance, held, owner);
    database.prepare('INSERT INTO billing_ledger(id,owner,delta,held_delta,kind,reference,external_key,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, owner, delta, heldDelta, kind, reference, key, stamp());
    return { id, replay: false };
  }
  function reservation(owner, operation) {
    identity(owner);
    if (!operationId(operation)) reject(400, 'invalid_billing_operation');
    const row = database.prepare('SELECT * FROM billing_reservation WHERE operation_id=? AND owner=?').get(operation, owner);
    if (!row) reject(404, 'billing_operation_not_found');
    return row;
  }
  function grant(owner, { credits, key, reason = 'test_admin_grant' }) {
    if (!integer(credits) || credits < 1 || !identifier(key) || !identifier(reason)) reject(400, 'invalid_credit_grant');
    return transaction(() => addEntry(owner, { delta: credits, kind: 'grant', reference: reason, key: 'grant:' + key }));
  }
  function reserve(owner, operation) {
    identity(owner);
    if (!operationId(operation)) reject(400, 'invalid_billing_operation');
    return transaction(() => {
      const prior = database.prepare('SELECT * FROM billing_reservation WHERE operation_id=?').get(operation);
      if (prior) {
        if (prior.owner !== owner) reject(404, 'billing_operation_not_found');
        return { operationId: operation, status: prior.status, heldCredits: prior.hold_credits, replay: true };
      }
      if (database.prepare("SELECT 1 AS n FROM billing_reservation WHERE owner=? AND status IN ('pending_review','overage_review')").get(owner)) reject(409, 'usage_reconciliation_required');
      const account = ensureAccount(owner);
      if (account.balance - account.held < policy.reserveCredits) reject(402, 'insufficient_credits');
      addEntry(owner, { delta: 0, heldDelta: policy.reserveCredits, kind: 'reserve', reference: operation, key: 'reserve:' + operation });
      database.prepare('INSERT INTO billing_reservation(operation_id,owner,hold_credits,status,policy_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
        .run(operation, owner, policy.reserveCredits, 'reserved', JSON.stringify(policy), stamp(), stamp());
      return { operationId: operation, status: 'reserved', heldCredits: policy.reserveCredits, replay: false };
    });
  }
  function recordUsage(owner, operation, value) {
    const event = receipt(value);
    return transaction(() => {
      const held = reservation(owner, operation);
      const prior = database.prepare('SELECT * FROM billing_usage WHERE id=?').get(event.id);
      const details = JSON.stringify(event);
      if (prior) {
        if (prior.owner !== owner || prior.operation_id !== operation || prior.details !== details) reject(409, 'usage_idempotency_conflict');
        return { replay: true };
      }
      if (!['reserved', 'pending_review', 'overage_review'].includes(held.status)) reject(409, 'billing_operation_closed');
      database.prepare('INSERT INTO billing_usage(id,operation_id,owner,details,created_at) VALUES (?,?,?,?,?)').run(event.id, operation, owner, details, stamp());
      return { replay: false };
    });
  }
  function measured(owner, operation, settings) {
    const held = reservation(owner, operation);
    const snapshot = validateCreditPolicy(JSON.parse(held.policy_json));
    const events = database.prepare('SELECT details FROM billing_usage WHERE owner=? AND operation_id=? ORDER BY created_at,id').all(owner, operation).map(row => JSON.parse(row.details));
    return { held, cost: measuredCost(snapshot, events, settings), snapshot };
  }
  function settle(owner, operation, { success, infrastructureCostMicros = null } = {}) {
    if (typeof success !== 'boolean') reject(400, 'generation_outcome_required');
    return transaction(() => {
      const { held, cost, snapshot } = measured(owner, operation, { infrastructureCostMicros });
      if (['settled', 'released', 'reversed'].includes(held.status)) return { ...JSON.parse(held.settlement_json), replay: true };
      let status;
      let chargedCredits = null;
      if (!success) {
        status = 'released'; chargedCredits = 0;
        addEntry(owner, { delta: 0, heldDelta: -held.hold_credits, kind: 'generation_failed', reference: operation, key: 'settle:' + operation });
      } else if (!cost.known) status = 'pending_review';
      else if (cost.costMicros > snapshot.maxOperationCostMicros || cost.credits > held.hold_credits) status = 'overage_review';
      else {
        status = 'settled'; chargedCredits = cost.credits;
        addEntry(owner, { delta: -chargedCredits, heldDelta: -held.hold_credits, kind: 'consume', reference: operation, key: 'settle:' + operation });
      }
      const result = { operationId: operation, status, chargedCredits, cost, replay: false };
      database.prepare('UPDATE billing_reservation SET status=?,settlement_json=?,updated_at=? WHERE operation_id=? AND owner=?')
        .run(status, JSON.stringify(result), stamp(), operation, owner);
      return result;
    });
  }
  // Trusted server/admin correction only. Never expose a client-selected credit
  // reversal endpoint. A Stripe money refund is accounted separately.
  function reverse(owner, operation, reason = 'generation_failed') {
    if (!['generation_failed', 'admin_correction', 'customer_refund'].includes(reason)) reject(400, 'invalid_reversal_reason');
    return transaction(() => {
      const held = reservation(owner, operation);
      if (['released', 'reversed'].includes(held.status)) return { ...JSON.parse(held.settlement_json), replay: true };
      const previous = held.settlement_json ? JSON.parse(held.settlement_json) : null;
      const credits = held.status === 'settled' ? previous.chargedCredits : 0;
      addEntry(owner, { delta: credits, heldDelta: held.status === 'settled' ? 0 : -held.hold_credits, kind: 'reverse', reference: operation, key: 'reverse:' + operation });
      const result = { operationId: operation, status: 'reversed', chargedCredits: 0, restoredCredits: credits, reason, cost: previous?.cost ?? null, replay: false };
      database.prepare("UPDATE billing_reservation SET status='reversed',settlement_json=?,updated_at=? WHERE operation_id=? AND owner=?").run(JSON.stringify(result), stamp(), operation, owner);
      return result;
    });
  }
  function account(owner) {
    const value = ensureAccount(owner);
    return { balance: value.balance, held: value.held, available: Math.max(0, value.balance - value.held),
      transactions: database.prepare('SELECT id,delta,held_delta AS heldDelta,kind,reference,created_at AS at FROM billing_ledger WHERE owner=? ORDER BY rowid DESC LIMIT 100').all(owner),
      operations: database.prepare('SELECT operation_id AS operationId,status,hold_credits AS heldCredits,settlement_json FROM billing_reservation WHERE owner=? ORDER BY rowid DESC LIMIT 100').all(owner)
        .map(row => ({ operationId: row.operationId, status: row.status, heldCredits: row.heldCredits, settlement: row.settlement_json ? JSON.parse(row.settlement_json) : null })) };
  }
  function monitor() {
    return { accounts: database.prepare('SELECT count(*) AS count FROM billing_account').get().count,
      reservations: database.prepare('SELECT status,count(*) AS count FROM billing_reservation GROUP BY status').all(),
      attempts: database.prepare('SELECT count(*) AS count FROM billing_usage').get().count,
      transactions: database.prepare('SELECT kind,count(*) AS count FROM billing_ledger GROUP BY kind').all() };
  }
  return { database, transaction, addEntry, ensureAccount, reserve, recordUsage, settle, reverse, grant, account, monitor, now, policy };
}
