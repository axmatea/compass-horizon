import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,chmod,rm,readFile,writeFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {DatabaseSync} from 'node:sqlite';
import {createBackupService,decryptSnapshot,encryptSnapshot} from '../account/backup.mjs';

async function fixture(t,options={}){
  const directory=await mkdtemp(join(tmpdir(),'compass-backup-test-'));
  const source=join(directory,'accounts.sqlite');
  const database=new DatabaseSync(source);
  database.exec("CREATE TABLE private_test(value TEXT); INSERT INTO private_test VALUES ('Private account and project data')");
  await chmod(source,0o600);
  const key=randomBytes(32),objects=new Map(),deleted=[];
  const env={COMPASS_ACCOUNT_MODE:'production',COMPASS_ACCOUNT_DATABASE:source,COMPASS_BACKUP_DIRECTORY:join(directory,'snapshots'),
    COMPASS_BACKUP_RETENTION:'1',COMPASS_BACKUP_MODE:'encrypted-s3',COMPASS_BACKUP_ENCRYPTION_KEY:key.toString('base64'),
    COMPASS_BACKUP_S3_ENDPOINT:'https://t3.storageapi.dev',COMPASS_BACKUP_S3_REGION:'auto',
    COMPASS_BACKUP_S3_BUCKET:'compass-private-test',COMPASS_BACKUP_S3_ACCESS_KEY_ID:'fixture-access',COMPASS_BACKUP_S3_SECRET_ACCESS_KEY:'fixture-secret'};
  const client={async send(command){const {Key,Body}=command.input;
    if(command.constructor.name==='PutObjectCommand'){const chunks=[];for await(const part of Body)chunks.push(part);objects.set(Key,Buffer.concat(chunks));return {}}
    if(command.constructor.name==='GetObjectCommand'){const bytes=objects.get(Key);return {ContentLength:bytes.length,Body:Readable.from([bytes])}}
    if(command.constructor.name==='ListObjectsV2Command')return {Contents:[...objects.keys()].map(Key=>({Key})),IsTruncated:false};
    if(command.constructor.name==='DeleteObjectCommand'){deleted.push(Key);objects.delete(Key);return {}}
    throw Error('Unexpected storage command');
  }};
  const service=createBackupService({env,database,client,storageInspector:async()=>({mode:'durable'}),...options});
  t.after(async()=>{await service.close();database.close();await rm(directory,{recursive:true,force:true})});
  return {directory,source,database,key,objects,deleted,env,client,service};
}

test('encrypted remote backup verifies actual download and restored SQLite content',async t=>{
  const f=await fixture(t);
  assert.equal(f.service.status().ready,false);
  const result=await f.service.run();
  assert.equal(result.verified,true);assert.equal(f.service.status().ready,true);
  const [objectKey,bytes]=[...f.objects][0];
  assert.equal(bytes.includes(Buffer.from('Private account and project data')),false);
  assert.equal(bytes.includes(Buffer.from('SQLite format 3')),false);
  const downloaded=join(f.directory,'downloaded'),restored=join(f.directory,'restored.sqlite');
  await writeFile(downloaded,bytes,{mode:0o600});
  await decryptSnapshot(downloaded,restored,f.key,objectKey,64*1024*1024);
  assert.equal((await stat(restored)).mode&0o777,0o600);
  const db=new DatabaseSync(restored,{readOnly:true});
  try{assert.equal(db.prepare('SELECT value FROM private_test').get().value,'Private account and project data')}finally{db.close()}
  assert.equal(JSON.stringify(f.service.status()).includes(f.env.COMPASS_BACKUP_S3_SECRET_ACCESS_KEY),false);
});

test('tampered ciphertext, renamed object and wrong encryption key fail without leaving restored data',async t=>{
  const f=await fixture(t),objectKey='accounts/v1/2026-11-14T00-00-00-000Z-'+randomUUID()+'.aesgcm';
  const encrypted=join(f.directory,'encrypted');await encryptSnapshot(f.source,encrypted,f.key,objectKey);
  const original=await readFile(encrypted),tampered=Buffer.from(original);tampered[40]^=1;
  const bad=join(f.directory,'bad');await writeFile(bad,tampered,{mode:0o600});
  for(const [source,key,name]of [[bad,f.key,objectKey],[encrypted,randomBytes(32),objectKey],[encrypted,f.key,objectKey.replace('2026','2025')]]){
    const output=join(f.directory,'failed-'+randomUUID());
    await assert.rejects(decryptSnapshot(source,output,key,name,64*1024*1024),{code:'backup_restore_verification_failed'});
    await assert.rejects(stat(output),{code:'ENOENT'});
  }
});

test('restore never overwrites an existing file',async t=>{
  const f=await fixture(t),objectKey='accounts/v1/2026-11-14T00-00-00-000Z-'+randomUUID()+'.aesgcm';
  const encrypted=join(f.directory,'encrypted'),existing=join(f.directory,'keep');
  await encryptSnapshot(f.source,encrypted,f.key,objectKey);await writeFile(existing,'Keep existing data',{mode:0o600});
  await assert.rejects(decryptSnapshot(encrypted,existing,f.key,objectKey,64*1024*1024));
  assert.equal(await readFile(existing,'utf8'),'Keep existing data');
});

test('retention removes only older module-owned snapshots after successful remote restore',async t=>{
  const f=await fixture(t);
  for(let day=1;day<=7;day++)f.objects.set('accounts/v1/2025-01-0'+day+'T00-00-00-000Z-'+randomUUID()+'.aesgcm',Buffer.from('old encrypted snapshot'));
  f.objects.set('unrelated/report.csv',Buffer.from('Keep'));
  f.objects.set('accounts/v1/operator-note.txt',Buffer.from('Keep'));
  await f.service.run();
  assert.equal(f.deleted.length,1);
  assert.equal(f.objects.has('unrelated/report.csv'),true);assert.equal(f.objects.has('accounts/v1/operator-note.txt'),true);
  assert.equal(f.objects.size,9);
});

test('remote corruption fails readiness and preserves older snapshots',async t=>{
  const f=await fixture(t),original=f.client.send.bind(f.client);
  f.client.send=async command=>{const response=await original(command);if(command.constructor.name==='GetObjectCommand')response.Body=Readable.from([Buffer.alloc(response.ContentLength)]);return response};
  await assert.rejects(f.service.run(),{code:'backup_failed'});
  assert.equal(f.service.status().ready,false);assert.equal(f.service.status().error,'backup_failed');assert.equal(f.deleted.length,0);
});

test('unconfigured storage performs no remote calls, and incomplete or untrusted endpoints fail closed',async()=>{
  for(const env of [{},{COMPASS_BACKUP_MODE:'encrypted-s3'},{COMPASS_BACKUP_MODE:'encrypted-s3',COMPASS_BACKUP_S3_ENDPOINT:'https://attacker.example.com'}]){
    let calls=0;const service=createBackupService({env,client:{send(){calls++;throw Error()}}});
    assert.equal(service.status().configured,false);await assert.rejects(service.run());assert.equal(calls,0);await service.close();
  }
});

test('backup runs coalesce and readiness expires when no verified backup is recent',async t=>{
  let time=Date.UTC(2026,10,14);
  const f=await fixture(t,{now:()=>new Date(time)});
  const first=f.service.run(),second=f.service.run();assert.equal(first,second);
  await first;assert.equal(f.objects.size,1);assert.equal(f.service.status().ready,true);
  time+=49*60*60*1000;assert.equal(f.service.status().ready,false);
});
