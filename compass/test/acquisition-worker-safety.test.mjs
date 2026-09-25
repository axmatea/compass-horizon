import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createWorker } from '../server/acquisition/worker.mjs';
import { createStore, migrate } from '../server/acquisition/store.mjs';
import { createAcquisitionVoiceRuntime } from '../server/acquisition/voice.mjs';
import { mergeEvidence, snapshotKey } from '../server/acquisition/domain.mjs';

// All provider responses below are TEST MOCKS, not sponsor integration receipts.
// Only the explicitly configured localhost synthetic PostgreSQL may be contacted.
const databaseUrl = process.env.ACQUISITION_TEST_DATABASE_URL;
const testReceipt = () => ({
  provider: 'TEST_MOCK_TINYBIRD', operation: 'metrics', status: 'completed',
  at: new Date().toISOString(), durationMs: 0,
});

function workerHarness({ dispatchRows = 1, resultRows = 1, ownedRows = 1, checkpoint = 'queued' } = {}) {
  const tenant = randomUUID();
  const leads = [{ id: randomUUID(), version: 1, experimentId: null, mode: 'LIVE', qualification: { status: 'QUALIFIED' } }];
  const result = { source: 'Tinybird', totalLeads: 1, qualified: 1, unresolved: 0, notIcp: 0,
    unknownAttribution: 1, sampleStatus: 'insufficient_evidence', experiments: [] };
  const run = { id: randomUUID(), tenant_id: tenant, operation: 'metrics', checkpoint,
    input: { metricsSnapshot: snapshotKey(leads) }, result: checkpoint === 'provider_done' ? result : null };
  const seen = { providerCalls: 0, dispatches: 0, resultWrites: 0, transactions: 0, decisions: [], completions: 0, failures: [], unknownSql: [] };
  const pool = { async query(sql, parameters = []) {
    if (sql.includes('RETURNING *')) return { rows: [run], rowCount: 1 };
    if (sql.startsWith('UPDATE acq_runs SET input=')) return { rows: [], rowCount: 1 };
    if (sql.includes("SET checkpoint='dispatching'")) {
      seen.dispatches++;
      return { rows: [], rowCount: dispatchRows };
    }
    if (sql.startsWith('UPDATE acq_runs SET result=')) {
      seen.resultWrites++;
      return { rows: [], rowCount: resultRows };
    }
    if (sql.startsWith('SELECT id FROM acq_runs')) return { rows: ownedRows ? [{ id: run.id }] : [], rowCount: ownedRows };
    if (sql.startsWith('SELECT rules_version')) return { rows: [{ rules_version: 1 }], rowCount: 1 };
    if (sql.includes("SET status='completed'")) { seen.completions++; return { rows: [], rowCount: 1 }; }
    if (sql.startsWith('SELECT checkpoint')) return { rows: [{ checkpoint: run.checkpoint }], rowCount: 1 };
    if (sql.startsWith('UPDATE acq_runs SET status=$1')) { seen.failures.push(parameters); return { rows: [], rowCount: 1 }; }
    if (sql.includes('lease_until<now()')) return { rows: [], rowCount: 0 };
    seen.unknownSql.push(sql);
    return { rows: [], rowCount: 0 };
  } };
  const store = {
    pool, state: async () => ({ leads }),
    transaction: async (_tenant, fn) => { seen.transactions++; return fn(pool); },
    decision: async (...args) => { seen.decisions.push(args); },
  };
  const providers = { metrics: async () => {
    seen.providerCalls++;
    return { result, receipt: testReceipt() };
  } };
  return { worker: createWorker({ store, providers, enabled: true }), seen, result, leads, run };
}

test('TEST MOCK: zero-row dispatch fence makes NO provider call and NO decision', async () => {
  const { worker, seen } = workerHarness({ dispatchRows: 0 });
  assert.equal(await worker.tick(), true);
  assert.equal(seen.dispatches, 1);
  assert.equal(seen.providerCalls, 0);
  assert.equal(seen.resultWrites, 0);
  assert.equal(seen.transactions, 0);
  assert.deepEqual(seen.decisions, []);
  assert.equal(seen.completions, 0);
  assert.deepEqual(seen.failures, []);
  assert.deepEqual(seen.unknownSql, []);
});

test('TEST MOCK: zero-row result fence stops before decision or completion', async () => {
  const { worker, seen } = workerHarness({ resultRows: 0 });
  await worker.tick();
  assert.equal(seen.providerCalls, 1);
  assert.equal(seen.resultWrites, 1);
  assert.equal(seen.transactions, 0);
  assert.deepEqual(seen.decisions, []);
  assert.equal(seen.completions, 0);
  assert.deepEqual(seen.failures, []);
  assert.deepEqual(seen.unknownSql, []);
});

for (const checkpoint of ['queued', 'provider_done']) {
  test(`TEST MOCK: lost transaction lease blocks decisions at ${checkpoint}`, async () => {
    const { worker, seen } = workerHarness({ ownedRows: 0, checkpoint });
    await worker.tick();
    assert.equal(seen.providerCalls, checkpoint === 'provider_done' ? 0 : 1);
    assert.equal(seen.transactions, 1);
    assert.deepEqual(seen.decisions, []);
    assert.equal(seen.completions, 0);
    assert.deepEqual(seen.failures, []);
    assert.deepEqual(seen.unknownSql, []);
  });
}

test('TEST MOCK: owned lease passes exact provider metrics and snapshot into the decision', async () => {
  const { worker, seen, result, leads, run } = workerHarness();
  await worker.tick();
  assert.equal(seen.providerCalls, 1);
  assert.equal(seen.decisions.length, 1);
  assert.deepEqual(seen.decisions[0].slice(1), [run.tenant_id, 1, [`run:${run.id}`], result, snapshotKey(leads)]);
  assert.equal(seen.completions, 1);
  assert.deepEqual(seen.failures, []);
  assert.deepEqual(seen.unknownSql, []);
});

test('equal-time delimiter-bearing event IDs converge regardless of arrival order', () => {
  const occurredAt = '2026-09-25T00:00:00.000Z';
  const a = { occurredAt, source: 'a|b', externalId: 'c' };
  const b = { occurredAt, source: 'a', externalId: 'b|c' };
  const apply = (first, second) => {
    const before = mergeEvidence({ budget: null }, {}, { budget: first[1] }, first[0]);
    return mergeEvidence(before.fields, before.clocks, { budget: second[1] }, second[0]);
  };
  const forward = apply([a, 100], [b, 200]);
  const reverse = apply([b, 200], [a, 100]);
  assert.deepEqual(forward.fields, reverse.fields);
  assert.deepEqual(forward.clocks, reverse.clocks);
  assert.notEqual(JSON.stringify([occurredAt, a.source, a.externalId]), JSON.stringify([occurredAt, b.source, b.externalId]));
  assert.equal(JSON.parse(forward.clocks.budget).length, 3);
});

async function voiceHarness(isAuthorized) {
  const tenantId = randomUUID(), leadId = randomUUID();
  const writes = [], events = [];
  const runtime = await createAcquisitionVoiceRuntime({
    identity: { tenantId }, leadId, isAuthorized,
    store: {
      state: async () => ({ leads: [{ id: leadId }] }),
      addRun: async (...args) => { writes.push(args); return { id: randomUUID(), status: 'queued' }; },
    },
  });
  const session = runtime.createSession();
  runtime.subscribe(session.id, event => events.push(event));
  return { runtime, session, writes, events };
}

test('voice: revoked session makes no addRun call and emits no saved-run event', async () => {
  let authorizationChecks = 0;
  const { runtime, session, writes, events } = await voiceHarness(async () => { authorizationChecks++; return false; });
  const output = await runtime.runTurn(session.id, 'Synthetic private intake', { turnId: 'test-revoked-turn' });
  assert.equal(authorizationChecks, 1);
  assert.deepEqual(writes, []);
  assert.equal(output.run, undefined);
  assert.ok(!events.some(event => event.type === 'acquisition_run'));
  assert.ok(!JSON.stringify(events).includes('Synthetic private intake'));
});

test('voice: authorization is checked again after an accepted turn', async () => {
  let authorized = true, checks = 0;
  const { runtime, session, writes, events } = await voiceHarness(async () => { checks++; return authorized; });
  await runtime.runTurn(session.id, 'Synthetic first turn');
  assert.equal(writes.length, 1);
  authorized = false;
  const output = await runtime.runTurn(session.id, 'Synthetic turn after revocation');
  assert.equal(checks, 2);
  assert.equal(writes.length, 1);
  assert.equal(output.run, undefined);
  assert.equal(events.filter(event => event.type === 'acquisition_run').length, 1);
});

test('voice: authorization lookup failure is fail-closed and sanitized', async () => {
  const { runtime, session, writes, events } = await voiceHarness(async () => { throw new Error('TEST_ONLY_INTERNAL_AUTH_ERROR'); });
  await runtime.runTurn(session.id, 'Synthetic turn');
  assert.deepEqual(writes, []);
  assert.ok(!JSON.stringify(events).includes('TEST_ONLY_INTERNAL_AUTH_ERROR'));
});

function assertLocalTestDatabase() {
  let parsed;
  try { parsed = new URL(databaseUrl); } catch { throw new Error('Set a valid local synthetic test DSN.'); }
  assert.ok(['postgres:', 'postgresql:'].includes(parsed.protocol)
    && ['127.0.0.1', 'localhost'].includes(parsed.hostname) && parsed.port === '55438'
    && parsed.pathname === '/compass_test' && parsed.username === 'compass_test'
    && !parsed.search && !parsed.hash, 'Safety tests require the designated localhost:55438 synthetic database.');
}

async function databaseFixture(t) {
  assertLocalTestDatabase();
  const schema = `acq_worker_safety_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 3000 });
  let pool, created = false;
  t.after(async () => {
    try {
      await pool?.end();
      if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    } finally { await admin.end(); }
  });
  // Isolate the global worker queue from concurrently running tests in public.
  await admin.query(`CREATE SCHEMA ${schema}`);
  created = true;
  pool = new pg.Pool({ connectionString: databaseUrl, max: 6, connectionTimeoutMillis: 3000,
    options: `-c search_path=${schema},pg_catalog -c statement_timeout=10000` });
  await migrate(pool);
  const store = createStore(pool), tenant = randomUUID();
  await store.saveProject(tenant, { name: 'TEST synthetic workspace', goal: 'TEST safety regression' });
  return { pool, store, tenant };
}

async function metricsFixture(t) {
  const fixture = await databaseFixture(t);
  const { store, tenant } = fixture;
  const experiment = await store.addExperiment(tenant, {
    name: 'TEST experiment', hypothesis: 'TEST intake', audience: 'Synthetic owners', message: 'Synthetic message',
  });
  const lead = await store.addLead(tenant, {
    name: 'TEST qualified lead', experimentId: experiment.id, problem: 'Synthetic intake',
    decisionMaker: true, businessFit: true, budget: 8000, timelineDays: 30,
  });
  await store.addLead(tenant, { name: 'TEST unresolved lead', problem: 'Synthetic unknown context' });
  const before = await store.state(tenant);
  const result = { source: 'Tinybird', totalLeads: 2, qualified: 1, unresolved: 1, notIcp: 0,
    unknownAttribution: 1, sampleStatus: 'insufficient_evidence',
    experiments: [{ experimentId: experiment.id, total: 1, qualified: 1 }] };
  return { ...fixture, lead, experiment, before, result };
}

function testMetricsProvider(result, beforeReturn = async () => {}) {
  const calls = [];
  return {
    calls,
    providers: { metrics: async args => {
      calls.push(structuredClone(args));
      await beforeReturn(args);
      return { result: structuredClone(result), receipt: testReceipt() };
    } },
  };
}

async function runRecord(pool, id) {
  return (await pool.query('SELECT * FROM acq_runs WHERE id=$1', [id])).rows[0];
}

async function runDecisions(pool, tenant, id) {
  return (await pool.query('SELECT * FROM acq_decisions WHERE tenant_id=$1 AND evidence_ids @> $2::jsonb',
    [tenant, JSON.stringify([`run:${id}`])])).rows;
}

async function blockedRun(store, pool, tenant) {
  const run = await store.addRun(tenant, { operation: 'metrics' });
  await pool.query("UPDATE acq_runs SET status='blocked',checkpoint='blocked' WHERE id=$1", [run.id]);
  return run;
}

test('PostgreSQL safety regressions (local synthetic DB; TEST MOCK providers)', { skip: !databaseUrl, timeout: 30000 }, async t => {
  await t.test('reassigned DB lease before dispatch makes no provider call or decision', async t => {
    const { store, pool, tenant, before, result } = await metricsFixture(t);
    const run = await store.addRun(tenant, { operation: 'metrics' });
    const nextOwner = randomUUID();
    const fencedStore = { ...store, state: async tenantId => {
      const state = await store.state(tenantId);
      await pool.query('UPDATE acq_runs SET lease_token=$1 WHERE id=$2', [nextOwner, run.id]);
      return state;
    } };
    const mock = testMetricsProvider(result);
    await createWorker({ store: fencedStore, providers: mock.providers, enabled: true }).tick();
    assert.equal(mock.calls.length, 0);
    assert.deepEqual(await runDecisions(pool, tenant, run.id), []);
    const persisted = await runRecord(pool, run.id);
    assert.equal(persisted.lease_token, nextOwner);
    assert.equal(persisted.checkpoint, 'queued');
    assert.equal(persisted.result, null);
    assert.deepEqual((await store.state(tenant)).leads, before.leads);
  });

  await t.test('DB lease lost during TEST MOCK call cannot persist a result or decision', async t => {
    const { store, pool, tenant, before, result } = await metricsFixture(t);
    const run = await store.addRun(tenant, { operation: 'metrics' });
    const mock = testMetricsProvider(result, async () => {
      await pool.query("UPDATE acq_runs SET status='blocked',checkpoint='uncertain',lease_token=NULL WHERE id=$1", [run.id]);
    });
    await createWorker({ store, providers: mock.providers, enabled: true }).tick();
    assert.equal(mock.calls.length, 1);
    assert.deepEqual(await runDecisions(pool, tenant, run.id), []);
    const persisted = await runRecord(pool, run.id);
    assert.equal(persisted.status, 'blocked');
    assert.equal(persisted.checkpoint, 'uncertain');
    assert.equal(persisted.result, null);
    assert.equal(persisted.receipt, null);
    assert.deepEqual((await store.state(tenant)).metrics, before.metrics);
  });

  await t.test('DB lease lost after provider_done cannot create a decision or complete the run', async t => {
    const { store, pool, tenant, before, result } = await metricsFixture(t);
    const run = await store.addRun(tenant, { operation: 'metrics' });
    const fencedStore = { ...store, transaction: async (tenantId, fn) => {
      await pool.query("UPDATE acq_runs SET status='queued',lease_token=NULL WHERE id=$1", [run.id]);
      return store.transaction(tenantId, fn);
    } };
    const mock = testMetricsProvider(result);
    await createWorker({ store: fencedStore, providers: mock.providers, enabled: true }).tick();
    assert.equal(mock.calls.length, 1);
    assert.deepEqual(await runDecisions(pool, tenant, run.id), []);
    const persisted = await runRecord(pool, run.id);
    assert.equal(persisted.status, 'queued');
    assert.equal(persisted.checkpoint, 'provider_done');
    assert.deepEqual(persisted.result, result);
    assert.equal(persisted.receipt.provider, 'TEST_MOCK_TINYBIRD');
    assert.deepEqual((await store.state(tenant)).metrics, before.metrics);
  });

  await t.test('resume enforces five queued/running jobs and preserves the blocked row', async t => {
    const { store, pool, tenant } = await databaseFixture(t);
    const blocked = await blockedRun(store, pool, tenant);
    const active = [];
    for (let i = 0; i < 5; i++) active.push(await store.addRun(tenant, { operation: 'metrics' }));
    await pool.query("UPDATE acq_runs SET status='running',lease_token=$1,lease_until=now()+interval '1 minute' WHERE id=$2", [randomUUID(), active[0].id]);
    await assert.rejects(store.resumeRun(tenant, blocked.id), error => error.status === 429);
    assert.equal((await runRecord(pool, blocked.id)).status, 'blocked');
    const count = await pool.query("SELECT count(*) FROM acq_runs WHERE tenant_id=$1 AND status IN ('queued','running')", [tenant]);
    assert.equal(Number(count.rows[0].count), 5);
    await assert.rejects(store.resumeRun(randomUUID(), blocked.id), error => error.status === 404);
  });

  await t.test('concurrent resumes cannot both consume the fifth slot', async t => {
    const { store, pool, tenant } = await databaseFixture(t);
    const a = await blockedRun(store, pool, tenant), b = await blockedRun(store, pool, tenant);
    for (let i = 0; i < 4; i++) await store.addRun(tenant, { operation: 'metrics' });
    const outcomes = await Promise.allSettled([store.resumeRun(tenant, a.id), store.resumeRun(tenant, b.id)]);
    assert.equal(outcomes.filter(value => value.status === 'fulfilled').length, 1);
    const rejected = outcomes.filter(value => value.status === 'rejected');
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason.status, 429);
    const count = await pool.query("SELECT count(*) FROM acq_runs WHERE tenant_id=$1 AND status IN ('queued','running')", [tenant]);
    assert.equal(Number(count.rows[0].count), 5);
    assert.deepEqual([(await runRecord(pool, a.id)).status, (await runRecord(pool, b.id)).status].sort(), ['blocked', 'queued']);
  });

  await t.test('current TEST MOCK Tinybird result feeds persisted decision and public metrics', async t => {
    const { store, pool, tenant, before, result } = await metricsFixture(t);
    const run = await store.addRun(tenant, { operation: 'metrics' });
    const mock = testMetricsProvider(result);
    await createWorker({ store, providers: mock.providers, enabled: true }).tick();
    assert.equal(mock.calls.length, 1);
    assert.deepEqual(mock.calls[0].rows, before.leads.map(lead => ({ tenantId: tenant, leadId: lead.id,
      version: lead.version, experimentId: lead.experimentId, status: lead.qualification.status, mode: lead.mode })));
    const persisted = await runRecord(pool, run.id);
    assert.equal(persisted.status, 'completed');
    assert.equal(persisted.receipt.provider, 'TEST_MOCK_TINYBIRD');
    assert.deepEqual(persisted.result, result);
    assert.equal(persisted.input.metricsSnapshot, snapshotKey(before.leads));
    const decisions = await runDecisions(pool, tenant, run.id);
    assert.equal(decisions.length, 1);
    assert.deepEqual(decisions[0].metrics, { ...result, _snapshot: snapshotKey(before.leads) });
    const after = await store.state(tenant);
    assert.deepEqual(after.metrics, result);
    assert.equal(Object.hasOwn(after.metrics, '_snapshot'), false);
    assert.deepEqual(after.leads, before.leads, 'analytics must not overwrite canonical lead facts');
    await store.resumeRun(tenant, run.id);
    await createWorker({ store, providers: mock.providers, enabled: true }).tick();
    assert.equal(mock.calls.length, 1, 'completed work must not call even the TEST MOCK twice');
  });

  await t.test('a result made stale during the TEST MOCK call cannot overwrite newer facts or metrics', async t => {
    const { store, pool, tenant, before, lead, result } = await metricsFixture(t);
    const run = await store.addRun(tenant, { operation: 'metrics' });
    const mock = testMetricsProvider(result, async () => {
      await store.applyEvent(tenant, { source: 'test-worker-safety', externalId: randomUUID(), leadId: lead.id,
        occurredAt: new Date(Date.now() + 1000).toISOString(), fields: { budget: 500 } });
    });
    await createWorker({ store, providers: mock.providers, enabled: true }).tick();
    const after = await store.state(tenant);
    assert.notEqual(snapshotKey(after.leads), snapshotKey(before.leads));
    assert.equal(after.leads.find(value => value.id === lead.id).fields.budget, 500);
    assert.equal(after.leads.find(value => value.id === lead.id).qualification.status, 'NOT_ICP');
    assert.equal(after.metrics.source, 'PostgreSQL');
    assert.equal(after.metrics.qualified, 0);
    assert.equal(after.metrics.notIcp, 1);
    const decisions = await runDecisions(pool, tenant, run.id);
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].metrics.source, 'PostgreSQL');
    assert.equal(decisions[0].metrics.notIcp, 1);
    assert.deepEqual((await runRecord(pool, run.id)).result, result, 'keep the old TEST MOCK result only as run history');
    assert.equal(mock.calls.length, 1);
  });

  await t.test('a later rules version invalidates a previously current sponsor snapshot', async t => {
    const { store, tenant, before, result } = await metricsFixture(t);
    await store.addRun(tenant, { operation: 'metrics' });
    const mock = testMetricsProvider(result);
    await createWorker({ store, providers: mock.providers, enabled: true }).tick();
    assert.equal((await store.state(tenant)).metrics.source, 'Tinybird');
    await store.saveProject(tenant, { name: 'TEST synthetic workspace', goal: 'TEST tighter rules',
      rules: { minBudget: 9000, maxTimelineDays: 90 } });
    const after = await store.state(tenant);
    assert.equal(after.project.rulesVersion, 2);
    assert.notEqual(snapshotKey(after.leads), snapshotKey(before.leads));
    assert.ok(after.leads.every(lead => lead.version > before.leads.find(old => old.id === lead.id).version));
    assert.equal(after.metrics.source, 'PostgreSQL');
    assert.equal(after.metrics.qualified, 0);
    assert.equal(after.metrics.notIcp, 1);
    assert.equal(mock.calls.length, 1);
  });

  for (const mismatch of ['totals', 'experiment allocation']) {
    await t.test(`current snapshot rejects mismatched TEST MOCK ${mismatch} without overwriting metrics`, async t => {
      const { store, pool, tenant, before, result } = await metricsFixture(t);
      const invalid = mismatch === 'totals'
        ? { ...result, totalLeads: 3, qualified: 2 }
        : { ...result, experiments: [{ experimentId: randomUUID(), total: 1, qualified: 1 }] };
      const run = await store.addRun(tenant, { operation: 'metrics' });
      const mock = testMetricsProvider(invalid);
      const worker = createWorker({ store, providers: mock.providers, enabled: true });
      await worker.tick();
      const persisted = await runRecord(pool, run.id);
      assert.equal(persisted.status, 'failed');
      assert.equal(persisted.checkpoint, 'provider_done');
      assert.deepEqual(await runDecisions(pool, tenant, run.id), []);
      const after = await store.state(tenant);
      assert.deepEqual(after.leads, before.leads);
      assert.deepEqual(after.metrics, before.metrics);
      assert.equal(after.metrics.source, 'PostgreSQL');
      await store.resumeRun(tenant, run.id);
      await worker.tick();
      assert.equal(mock.calls.length, 1, 'failed application must reuse the saved result, never redispatch');
      assert.deepEqual(await runDecisions(pool, tenant, run.id), []);
    });
  }

  await t.test('manual creation stores tuple clocks and later evidence preserves unrelated facts', async t => {
    const { store, pool, tenant, lead } = await metricsFixture(t);
    const row = (await pool.query('SELECT fields,clocks FROM acq_leads WHERE tenant_id=$1 AND id=$2', [tenant, lead.id])).rows[0];
    const clock = JSON.parse(row.clocks.budget);
    assert.equal(clock.length, 3);
    assert.equal(clock[1], 'manual');
    assert.ok(Number.isFinite(Date.parse(clock[0])));
    await store.applyEvent(tenant, { source: 'test|source', externalId: 'test|external', leadId: lead.id,
      occurredAt: new Date(Date.parse(clock[0]) + 1).toISOString(), fields: { budget: 9000 } });
    const updated = (await store.state(tenant)).leads.find(value => value.id === lead.id);
    assert.equal(updated.fields.budget, 9000);
    for (const key of ['problem', 'decisionMaker', 'businessFit', 'timelineDays']) assert.equal(updated.fields[key], row.fields[key]);
  });
});
