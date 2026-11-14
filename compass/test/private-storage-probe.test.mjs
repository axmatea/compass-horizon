import test from 'node:test';
import assert from 'node:assert/strict';
import {stat} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {Readable} from 'node:stream';
import {spawnSync} from 'node:child_process';
import {verifyPrivateStorage} from '../scripts/verify-private-storage.mjs';

function fixture({corrupt = false, providerFailure = false, extraByte = false} = {}) {
  const env = {
    COMPASS_BACKUP_MODE: 'encrypted-s3', COMPASS_BACKUP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    COMPASS_BACKUP_S3_ENDPOINT: 'https://t3.storageapi.dev', COMPASS_BACKUP_S3_BUCKET: 'compass-probe-fixture',
    COMPASS_BACKUP_S3_ACCESS_KEY_ID: 'fixture-access', COMPASS_BACKUP_S3_SECRET_ACCESS_KEY: 'fixture-secret',
    COMPASS_ACCOUNT_DATABASE: '/must-not-open-account-data/accounts.sqlite',
  };
  const objects = new Map([['unrelated-existing-object', Buffer.from('Preserve this object')]]), calls = [];
  let directory, destroyed = false;
  const client = {async send(command) {
    const {Key, Body} = command.input;
    calls.push(command.constructor.name);
    assert.equal(command.input.Bucket, env.COMPASS_BACKUP_S3_BUCKET);
    assert.match(Key, /^accounts\/v1\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9-]{36}\.aesgcm$/);
    if (command.constructor.name === 'PutObjectCommand') {
      assert.equal(command.input.IfNoneMatch, '*');
      assert.equal(objects.has(Key), false);
      directory = dirname(Body.path);
      assert.equal((await stat(directory)).mode & 0o777, 0o700);
      for (const name of ['probe.sqlite', 'encrypted']) assert.equal((await stat(join(directory, name))).mode & 0o777, 0o600);
      if (providerFailure) throw new Error('Synthetic provider response includes fixture-secret and token-bearing URL');
      const chunks = [];
      for await (const chunk of Body) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      assert.equal(bytes.length, command.input.ContentLength);
      assert.equal(bytes.includes(Buffer.from('SQLite format 3')), false);
      assert.equal(bytes.includes(Buffer.from('COMPASS private storage probe')), false);
      objects.set(Key, bytes);
      return {};
    }
    if (command.constructor.name === 'GetObjectCommand') {
      const bytes = Buffer.from(objects.get(Key));
      if (corrupt) bytes[40] ^= 1;
      return {ContentLength: bytes.length, Body: Readable.from(extraByte ? [bytes, Buffer.from([0])] : [bytes])};
    }
    if (command.constructor.name === 'DeleteObjectCommand') {
      assert.ok(objects.has(Key));
      objects.delete(Key);
      return {};
    }
    throw new Error('The probe must not list or inspect other objects');
  }, destroy() { destroyed = true; }};
  return {env, client, calls, objects, get directory() { return directory; }, get destroyed() { return destroyed; }};
}

test('operator probe encrypts, downloads, restores, and deletes only its own synthetic object', async () => {
  const f = fixture();
  assert.deepEqual(await verifyPrivateStorage(f), {encryptedUpload: true, downloaded: true, restored: true, deletedProbe: true});
  assert.deepEqual(f.calls, ['PutObjectCommand', 'GetObjectCommand', 'DeleteObjectCommand']);
  assert.deepEqual([...f.objects.keys()], ['unrelated-existing-object']);
  assert.equal(f.destroyed, true);
  await assert.rejects(stat(f.directory), {code: 'ENOENT'});
});

test('corruption, excessive download bytes, and provider errors fail safely with private temporary files removed', async t => {
  for (const options of [{corrupt: true}, {extraByte: true}, {providerFailure: true}]) await t.test(JSON.stringify(options), async () => {
    const f = fixture(options);
    await assert.rejects(verifyPrivateStorage(f), error => {
      assert.equal(error.code, 'private_storage_verification_failed');
      assert.equal(error.message, 'Private storage verification failed.');
      assert.equal(String(error).includes('fixture-secret'), false);
      return true;
    });
    assert.ok(!f.calls.includes('DeleteObjectCommand'), 'a failed probe must not delete an object');
    assert.ok(f.objects.has('unrelated-existing-object'));
    assert.equal(f.destroyed, true);
    await assert.rejects(stat(f.directory), {code: 'ENOENT'});
  });
});

test('untrusted or incomplete configuration cannot make provider calls', async () => {
  for (const extra of [{COMPASS_BACKUP_MODE: undefined}, {COMPASS_BACKUP_S3_ENDPOINT: 'https://attacker.example'},
    {COMPASS_BACKUP_S3_ENDPOINT: 'http://t3.storageapi.dev'}, {COMPASS_BACKUP_ENCRYPTION_KEY: 'invalid'}]) {
    const f = fixture();
    await assert.rejects(verifyPrivateStorage({env: {...f.env, ...extra}, client: f.client}), {code: 'private_storage_verification_failed'});
    assert.deepEqual(f.calls, []);
  }
});

test('CLI errors print one sanitized JSON record without environment or provider values', () => {
  const f = fixture();
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/verify-private-storage.mjs', import.meta.url))],
    {env: {...f.env, COMPASS_BACKUP_S3_ENDPOINT: 'https://attacker.example/fixture-secret'}, encoding: 'utf8'});
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '{"error":"private_storage_verification_failed"}\n');
  assert.equal(result.stderr, '');
});
