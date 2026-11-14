import {randomUUID} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import {mkdtemp, chmod, writeFile, stat, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand} from '@aws-sdk/client-s3';
import {encryptSnapshot, decryptSnapshot} from '../account/backup.mjs';

const MAX_BYTES = 1024 * 1024;
const failure = () => Object.assign(new Error('Private storage verification failed.'), {code: 'private_storage_verification_failed'});

function configuration(env) {
  if (env.COMPASS_BACKUP_MODE !== 'encrypted-s3') throw failure();
  const endpoint = new URL(env.COMPASS_BACKUP_S3_ENDPOINT);
  const key = Buffer.from(env.COMPASS_BACKUP_ENCRYPTION_KEY || '', 'base64');
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.port
    || endpoint.pathname !== '/' || endpoint.search || endpoint.hash
    || !/^[a-z0-9.-]+\.storageapi\.dev$/.test(endpoint.hostname)
    || key.length !== 32 || key.toString('base64') !== env.COMPASS_BACKUP_ENCRYPTION_KEY) throw failure();
  for (const name of ['COMPASS_BACKUP_S3_BUCKET', 'COMPASS_BACKUP_S3_ACCESS_KEY_ID', 'COMPASS_BACKUP_S3_SECRET_ACCESS_KEY']) {
    if (typeof env[name] !== 'string' || !env[name].trim() || env[name].length > 4096) throw failure();
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.COMPASS_BACKUP_S3_BUCKET)) throw failure();
  return {endpoint: endpoint.origin, key, bucket: env.COMPASS_BACKUP_S3_BUCKET};
}

/** Explicit operator probe. Never opens an account database, lists a bucket, or loads .env files. */
export async function verifyPrivateStorage({env = process.env, client} = {}) {
  let directory, s3, key, failed = false;
  try {
    const config = configuration(env);
    key = config.key;
    s3 = client || new S3Client({endpoint: config.endpoint, region: env.COMPASS_BACKUP_S3_REGION || 'auto',
      credentials: {accessKeyId: env.COMPASS_BACKUP_S3_ACCESS_KEY_ID, secretAccessKey: env.COMPASS_BACKUP_S3_SECRET_ACCESS_KEY},
      requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED', maxAttempts: 2});
    const send = command => s3.send(command, {abortSignal: AbortSignal.timeout(120000)});
    directory = await mkdtemp(join(tmpdir(), 'compass-private-storage-probe-'));
    await chmod(directory, 0o700);
    const source = join(directory, 'probe.sqlite'), encrypted = join(directory, 'encrypted');
    const downloaded = join(directory, 'downloaded'), restored = join(directory, 'restored.sqlite');
    const marker = 'COMPASS private storage probe ' + randomUUID();
    await writeFile(source, '', {flag: 'wx', mode: 0o600});
    const {DatabaseSync} = await import('node:sqlite');
    const database = new DatabaseSync(source);
    try {
      database.exec('PRAGMA max_page_count = 128; CREATE TABLE compass_storage_probe(marker TEXT NOT NULL)');
      database.prepare('INSERT INTO compass_storage_probe(marker) VALUES (?)').run(marker);
    } finally { database.close(); }

    const objectKey = 'accounts/v1/' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID() + '.aesgcm';
    await encryptSnapshot(source, encrypted, key, objectKey);
    const bytes = (await stat(encrypted)).size;
    if (bytes >= MAX_BYTES) throw failure();
    const body = createReadStream(encrypted);
    try {
      await send(new PutObjectCommand({Bucket: config.bucket, Key: objectKey, Body: body, ContentLength: bytes,
        ContentType: 'application/octet-stream', IfNoneMatch: '*'}));
    } finally { body.destroy(); }

    const remote = await send(new GetObjectCommand({Bucket: config.bucket, Key: objectKey}));
    if (remote.ContentLength !== bytes || !remote.Body) {
      remote.Body?.destroy?.();
      throw failure();
    }
    let received = 0;
    const bound = new Transform({transform(chunk, encoding, done) {
      received += chunk.length;
      done(received > bytes || received >= MAX_BYTES ? failure() : null, chunk);
    }});
    await pipeline(Readable.from(remote.Body), bound, createWriteStream(downloaded, {flags: 'wx', mode: 0o600}),
      {signal: AbortSignal.timeout(120000)});
    if (received !== bytes) throw failure();
    await decryptSnapshot(downloaded, restored, key, objectKey, MAX_BYTES - 36);
    const verified = new DatabaseSync(restored, {readOnly: true});
    try {
      if (verified.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok'
        || verified.prepare('SELECT marker FROM compass_storage_probe').get()?.marker !== marker) throw failure();
    } finally { verified.close(); }
    // This random key was created above and successfully restored. No other
    // object is ever inspected or deleted, even if a probe fails.
    await send(new DeleteObjectCommand({Bucket: config.bucket, Key: objectKey}));
  } catch { failed = true; }
  finally {
    try { if (directory) await rm(directory, {recursive: true, force: true}); } catch { failed = true; }
    try { s3?.destroy?.(); } catch { failed = true; }
    key?.fill(0);
  }
  if (failed) throw failure();
  return {encryptedUpload: true, downloaded: true, restored: true, deletedProbe: true};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.stdout.write(JSON.stringify(await verifyPrivateStorage()) + '\n'); }
  catch { process.stdout.write(JSON.stringify({error: 'private_storage_verification_failed'}) + '\n'); process.exitCode = 1; }
}
