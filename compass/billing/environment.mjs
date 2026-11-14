import { realpath } from 'node:fs/promises';
import { inspectStorage } from '../account/storage.mjs';

export const stripeId = (value, prefix) => typeof value === 'string' && new RegExp('^' + prefix + '_[A-Za-z0-9_]{1,160}$').test(value);

export function billingOrigin(env, mode) {
  try {
    const url = new URL(env.COMPASS_BILLING_ORIGIN);
    const account = new URL(env.COMPASS_ACCOUNT_ORIGIN);
    for (const value of [url, account]) {
      if (value.username || value.password || value.search || value.hash || value.pathname !== '/') return null;
    }
    if (url.origin !== account.origin) return null;
    const host = url.hostname.replace(/\.+$/, '');
    if (mode === 'live') {
      if (env.COMPASS_ACCOUNT_MODE !== 'production' || url.origin !== 'https://mycompass.world' || url.hostname !== 'mycompass.world') return null;
      return url.origin;
    }
    if (['mycompass.world', 'www.mycompass.world'].includes(host)) return null;
    if (url.protocol === 'https:') return url.origin;
    if (env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(host)) return url.origin;
  } catch {}
  return null;
}

// This fingerprint belongs to the database, not a process or environment file.
// A financial database may never silently become another mode or merchant.
export function bindBillingEnvironment(db, mode, merchantId, now = () => Date.now()) {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='billing_environment'").get();
  const financialTables = ['billing_account', 'billing_ledger', 'billing_reservation', 'billing_customer', 'billing_checkout', 'billing_payment', 'billing_subscription', 'billing_refund', 'billing_event'];
  const hasData = () => financialTables.some(table => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table) && db.prepare('SELECT 1 FROM ' + table + ' LIMIT 1').get());
  if (!exists && hasData()) return { blocked: ['billing_environment_migration_required'] };
  db.exec(`CREATE TABLE IF NOT EXISTS billing_environment (id INTEGER PRIMARY KEY CHECK(id=1), mode TEXT NOT NULL CHECK(mode IN ('test','live')),
    merchant_id TEXT, verified_at TEXT, created_at TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS billing_environment_identity_immutable BEFORE UPDATE ON billing_environment
      WHEN NEW.id<>OLD.id OR NEW.mode<>OLD.mode OR (OLD.merchant_id IS NOT NULL AND (NEW.merchant_id IS NULL OR NEW.merchant_id<>OLD.merchant_id))
      BEGIN SELECT RAISE(ABORT,'immutable_billing_environment'); END;
    CREATE TRIGGER IF NOT EXISTS billing_environment_no_delete BEFORE DELETE ON billing_environment
      BEGIN SELECT RAISE(ABORT,'immutable_billing_environment'); END;`);
  let row = db.prepare('SELECT * FROM billing_environment WHERE id=1').get();
  if (!row) {
    db.prepare('INSERT INTO billing_environment(id,mode,merchant_id,created_at) VALUES (1,?,?,?)').run(mode, merchantId || null, new Date(now()).toISOString());
    row = db.prepare('SELECT * FROM billing_environment WHERE id=1').get();
  }
  if (row.mode !== mode) return { blocked: ['billing_environment_mode_mismatch'] };
  if (row.merchant_id !== (merchantId || null)) {
    if (!row.merchant_id && merchantId && !hasData()) db.prepare('UPDATE billing_environment SET merchant_id=? WHERE id=1').run(merchantId);
    else return { blocked: ['billing_environment_merchant_mismatch'] };
  }
  return { blocked: [], verified: () => db.prepare('UPDATE billing_environment SET verified_at=? WHERE id=1 AND mode=? AND merchant_id=?').run(new Date(now()).toISOString(), mode, merchantId) };
}

export async function verifyBillingStorage(database, env, storageInspector = inspectStorage) {
  try {
    if ((await storageInspector(env)).mode !== 'durable') return false;
    const actual = database.prepare('PRAGMA database_list').all().find(item => item.name === 'main')?.file;
    return Boolean(actual && await realpath(actual) === await realpath(env.COMPASS_ACCOUNT_DATABASE));
  } catch { return false; }
}
