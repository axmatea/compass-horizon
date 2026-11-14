import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, chmod, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {Readable} from 'node:stream';
import {DatabaseSync} from 'node:sqlite';
import {createBackupService} from '../account/backup.mjs';
import {startBackupSchedule} from '../account/backup-scheduler.mjs';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

function clock() {
  let timer;
  return {
    setTimer(callback, delay) {
      assert.equal(timer, undefined, 'only one backup timer may be pending');
      timer = {callback, delay, unref() {}};
      return timer;
    },
    clearTimer(value) {
      assert.equal(value, timer);
      timer = undefined;
    },
    get delay() { return timer?.delay; },
    fire() {
      assert.ok(timer, 'a backup must be scheduled');
      const next = timer;
      timer = undefined;
      next.callback();
    },
  };
}

const settled = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

test('a failed first restore retries after one minute, then five, and readiness needs a successful restore', async () => {
  const time = clock();
  let calls = 0, verified = false;
  const schedule = startBackupSchedule({service: {
    async run() {
      calls += 1;
      if (calls < 3) throw new Error('Synthetic provider outage');
      verified = true;
    },
  }, ...time});
  try {
    await schedule.ready;
    assert.equal(calls, 1);
    assert.equal(verified, false);
    assert.equal(time.delay, MINUTE);
    time.fire();
    await settled();
    assert.equal(calls, 2);
    assert.equal(verified, false);
    assert.equal(time.delay, 5 * MINUTE);
    time.fire();
    await settled();
    assert.equal(calls, 3);
    assert.equal(verified, true);
    assert.equal(time.delay, DAY);
  } finally { await schedule.close(); }
  assert.equal(time.delay, undefined);
});

test('a successful backup schedules the next job after completion and never overlaps a slow restore', async () => {
  const time = clock(), initial = deferred(), daily = deferred();
  let calls = 0, concurrent = 0, peak = 0;
  const schedule = startBackupSchedule({service: {
    async run() {
      calls += 1;
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await (calls === 1 ? initial.promise : daily.promise);
      concurrent -= 1;
    },
  }, ...time});
  assert.equal(calls, 1);
  assert.equal(time.delay, undefined);
  initial.resolve();
  await schedule.ready;
  assert.equal(time.delay, DAY);
  time.fire();
  assert.equal(calls, 2);
  assert.equal(time.delay, undefined);
  await settled();
  assert.equal(calls, 2);
  daily.resolve();
  await settled();
  assert.equal(time.delay, DAY);
  assert.equal(peak, 1);
  await schedule.close();
  assert.equal(time.delay, undefined);
});

test('shutdown drains an active restore and never schedules another backup', async () => {
  const time = clock(), restore = deferred();
  let closed = false;
  const schedule = startBackupSchedule({service: {run: () => restore.promise}, ...time});
  const closing = schedule.close().then(() => { closed = true; });
  await settled();
  assert.equal(closed, false);
  restore.resolve();
  await closing;
  await schedule.ready;
  assert.equal(closed, true);
  assert.equal(time.delay, undefined);
});

test('a later provider failure returns to bounded retry and a success restores the daily schedule', async () => {
  const time = clock();
  let calls = 0;
  const schedule = startBackupSchedule({service: {async run() {
    calls += 1;
    if (calls === 2) throw new Error('Synthetic provider outage');
  }}, ...time});
  try {
    await schedule.ready;
    assert.equal(time.delay, DAY);
    time.fire();
    await settled();
    assert.equal(time.delay, MINUTE);
    time.fire();
    await settled();
    assert.equal(calls, 3);
    assert.equal(time.delay, DAY);
  } finally { await schedule.close(); }
});

test('a retry becomes ready only after the actual encrypted upload downloads and restores successfully', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'compass-backup-retry-'));
  const path = join(directory, 'accounts.sqlite'), time = clock(), objects = new Map();
  const database = new DatabaseSync(path);
  database.exec("CREATE TABLE private_test(value TEXT); INSERT INTO private_test VALUES ('Private restore test')");
  await chmod(path, 0o600);
  let attempts = 0, verifiedDownload = false;
  const service = createBackupService({env: {
    COMPASS_ACCOUNT_MODE: 'production', COMPASS_ACCOUNT_DATABASE: path,
    COMPASS_BACKUP_DIRECTORY: join(directory, 'snapshots'), COMPASS_BACKUP_RETENTION: '1',
    COMPASS_BACKUP_MODE: 'encrypted-s3', COMPASS_BACKUP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    COMPASS_BACKUP_S3_ENDPOINT: 'https://t3.storageapi.dev', COMPASS_BACKUP_S3_BUCKET: 'compass-retry-test',
    COMPASS_BACKUP_S3_ACCESS_KEY_ID: 'fixture-access', COMPASS_BACKUP_S3_SECRET_ACCESS_KEY: 'fixture-secret',
  }, database, storageInspector: async () => ({mode: 'durable'}), client: {async send(command) {
    const {Key, Body} = command.input;
    if (command.constructor.name === 'PutObjectCommand') {
      attempts += 1;
      if (attempts === 1) { Body.destroy(); throw new Error('Synthetic provider outage'); }
      const chunks = [];
      for await (const chunk of Body) chunks.push(chunk);
      objects.set(Key, Buffer.concat(chunks));
      return {};
    }
    if (command.constructor.name === 'GetObjectCommand') {
      verifiedDownload = true;
      const bytes = objects.get(Key);
      return {ContentLength: bytes.length, Body: Readable.from([bytes])};
    }
    if (command.constructor.name === 'ListObjectsV2Command') return {Contents: [...objects.keys()].map(Key => ({Key})), IsTruncated: false};
    throw new Error('Unexpected storage command');
  }}});
  const schedule = startBackupSchedule({service, ...time});
  t.after(async () => { await schedule.close(); await service.close(); database.close(); await rm(directory, {recursive: true, force: true}); });
  await schedule.ready;
  assert.equal(service.status().ready, false);
  assert.equal(verifiedDownload, false);
  assert.equal(time.delay, MINUTE);
  time.fire();
  // Coalescing awaits the job started by the injected timer, without real waiting.
  await service.run();
  await settled();
  assert.equal(attempts, 2);
  assert.equal(verifiedDownload, true);
  assert.equal(service.status().ready, true);
  assert.equal(time.delay, DAY);
});
