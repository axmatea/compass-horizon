import {createCipheriv,createDecipheriv,randomBytes,randomUUID} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {mkdtemp,mkdir,writeFile,appendFile,open,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {Transform,Readable} from 'node:stream';
import {S3Client,PutObjectCommand,GetObjectCommand,ListObjectsV2Command,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {backupAccountDatabase,accountDatabaseLimit,inspectStorage} from './storage.mjs';

const magic=Buffer.from('COMPASS1');
const prefix='accounts/v1/';
const objectPattern=/^accounts\/v1\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9-]{36}\.aesgcm$/;
const error=code=>Object.assign(new Error('Account backup is unavailable.'),{code});
const aad=key=>Buffer.from('COMPASS account backup v1\0'+key);

function configuration(env){
  if(env.COMPASS_BACKUP_MODE!=='encrypted-s3')return null;
  try{
    const endpoint=new URL(env.COMPASS_BACKUP_S3_ENDPOINT);
    const key=Buffer.from(env.COMPASS_BACKUP_ENCRYPTION_KEY||'','base64');
    if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.port||endpoint.pathname!=='/'||endpoint.search||endpoint.hash
      || !/^[a-z0-9.-]+\.storageapi\.dev$/.test(endpoint.hostname)
      ||key.length!==32||key.toString('base64')!==env.COMPASS_BACKUP_ENCRYPTION_KEY)throw Error();
    for(const name of ['COMPASS_BACKUP_S3_BUCKET','COMPASS_BACKUP_S3_ACCESS_KEY_ID','COMPASS_BACKUP_S3_SECRET_ACCESS_KEY']){
      if(typeof env[name]!=='string'||!env[name].trim()||env[name].length>4096)throw Error();
    }
    if(!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.COMPASS_BACKUP_S3_BUCKET))throw Error();
    return {endpoint:endpoint.origin,key,bucket:env.COMPASS_BACKUP_S3_BUCKET};
  }catch{throw error('backup_configuration_invalid')}
}

/** Streaming encryption. The authenticated object key prevents renaming a snapshot. */
export async function encryptSnapshot(source,destination,key,objectKey){
  if(!Buffer.isBuffer(key)||key.length!==32||!objectPattern.test(objectKey))throw error('backup_configuration_invalid');
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);
  cipher.setAAD(aad(objectKey));
  await writeFile(destination,Buffer.concat([magic,nonce]),{flag:'wx',mode:0o600});
  await pipeline(createReadStream(source),cipher,createWriteStream(destination,{flags:'a',mode:0o600}));
  await appendFile(destination,cipher.getAuthTag());
}

/** Writes only an absent private destination; never replaces a running database. */
export async function decryptSnapshot(source,destination,key,objectKey,maxBytes){
  if(!Buffer.isBuffer(key)||key.length!==32||!objectPattern.test(objectKey)||!Number.isSafeInteger(maxBytes)||maxBytes<1)throw error('backup_configuration_invalid');
  const info=await stat(source);
  if(info.size<=36||info.size>maxBytes+36)throw error('backup_size_invalid');
  const handle=await open(source,'r');
  const header=Buffer.alloc(20),tag=Buffer.alloc(16);
  try{await handle.read(header,0,20,0);await handle.read(tag,0,16,info.size-16)}finally{await handle.close()}
  if(!header.subarray(0,8).equals(magic))throw error('backup_format_invalid');
  const decipher=createDecipheriv('aes-256-gcm',key,header.subarray(8));
  decipher.setAAD(aad(objectKey));decipher.setAuthTag(tag);
  let created=false;
  try{
    const output=await open(destination,'wx',0o600);created=true;await output.close();
    await pipeline(createReadStream(source,{start:20,end:info.size-17}),decipher,createWriteStream(destination,{flags:'a',mode:0o600}));
    const {DatabaseSync}=await import('node:sqlite');
    const restored=new DatabaseSync(destination,{readOnly:true});
    try{if(restored.prepare('PRAGMA quick_check').get()?.quick_check!=='ok')throw Error()}finally{restored.close()}
  }catch{
    if(created)await rm(destination,{force:true});
    throw error('backup_restore_verification_failed');
  }
}

export function createBackupService({env=process.env,database,client,storageInspector=inspectStorage,now=()=>new Date()}={}){
  let config;
  try{config=configuration(env)}catch{return {run:async()=>{throw error('backup_configuration_invalid')},status:()=>({configured:false,ready:false,error:'backup_configuration_invalid'}),close:async()=>{}}}
  if(!config)return {run:async()=>{throw error('backup_not_configured')},status:()=>({configured:false,ready:false,error:'backup_not_configured'}),close:async()=>{}};
  const s3=client||new S3Client({endpoint:config.endpoint,region:env.COMPASS_BACKUP_S3_REGION||'auto',
    credentials:{accessKeyId:env.COMPASS_BACKUP_S3_ACCESS_KEY_ID,secretAccessKey:env.COMPASS_BACKUP_S3_SECRET_ACCESS_KEY},
    requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED',maxAttempts:2});
  let active=null,closed=false,lastSuccessAt=null,lastError=null;
  async function execute(){
    if(closed)throw error('backup_closed');
    if((await storageInspector(env)).mode!=='durable')throw error('backup_storage_unavailable');
    await mkdir(env.COMPASS_BACKUP_DIRECTORY,{recursive:true,mode:0o700});
    const snapshot=await backupAccountDatabase({env,database});
    const directory=await mkdtemp(join(tmpdir(),'compass-encrypted-backup-'));
    const objectKey=prefix+now().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID()+'.aesgcm';
    const encrypted=join(directory,'encrypted'),downloaded=join(directory,'downloaded'),restored=join(directory,'restored.sqlite');
    const send=command=>s3.send(command,{abortSignal:AbortSignal.timeout(120000)});
    try{
      await encryptSnapshot(snapshot.path,encrypted,config.key,objectKey);
      const bytes=(await stat(encrypted)).size;
      await send(new PutObjectCommand({Bucket:config.bucket,Key:objectKey,Body:createReadStream(encrypted),ContentLength:bytes,ContentType:'application/octet-stream',IfNoneMatch:'*'}));
      // Verify actual remote bytes and the restored SQLite database before success.
      const remote=await send(new GetObjectCommand({Bucket:config.bucket,Key:objectKey}));
      if(remote.ContentLength!==bytes||!remote.Body)throw error('backup_remote_size_invalid');
      let received=0;
      const bound=new Transform({transform(chunk,encoding,done){received+=chunk.length;done(received>bytes?error('backup_remote_size_invalid'):null,chunk)}});
      await pipeline(Readable.from(remote.Body),bound,createWriteStream(downloaded,{flags:'wx',mode:0o600}),{signal:AbortSignal.timeout(120000)});
      if(received!==bytes)throw error('backup_remote_size_invalid');
      await decryptSnapshot(downloaded,restored,config.key,objectKey,accountDatabaseLimit(env));
      // Delete only this module's older snapshots after the newest passed restore.
      const listed=await send(new ListObjectsV2Command({Bucket:config.bucket,Prefix:prefix,MaxKeys:1000}));
      if(listed.IsTruncated)throw error('backup_retention_review_required');
      const keys=(listed.Contents||[]).map(item=>item.Key).filter(key=>typeof key==='string'&&objectPattern.test(key)).sort();
      for(const key of keys.filter(key=>key!==objectKey).slice(0,Math.max(0,keys.length-7)))await send(new DeleteObjectCommand({Bucket:config.bucket,Key:key}));
      lastSuccessAt=now().toISOString();lastError=null;
      return {ok:true,verified:true,createdAt:lastSuccessAt,bytes};
    }finally{await rm(directory,{recursive:true,force:true})}
  }
  return {
    run(){if(active)return active;active=execute().catch(()=>{lastError='backup_failed';throw error('backup_failed')}).finally(()=>{active=null});return active},
    status(){const age=lastSuccessAt?now().getTime()-Date.parse(lastSuccessAt):Infinity;return {configured:true,ready:age>=0&&age<=48*60*60*1000,lastSuccessAt,error:lastError}},
    async close(){closed=true;if(active)await active.catch(()=>{});s3.destroy?.();config.key.fill(0)},
  };
}
