import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,chmod,rm,symlink,realpath,stat,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {inspectStorage,backupAccountDatabase} from '../account/storage.mjs';
import {createAccountAuth} from '../account/auth.mjs';
import {createAccountStore} from '../account/store.mjs';

async function fixture(t) {
  const directory=await realpath(await mkdtemp(join(tmpdir(),'compass-storage-test-')));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const mount=join(directory,'volume'),publicRoot=join(directory,'public'),backups=join(directory,'backups');
  await Promise.all([mkdir(mount,{mode:0o700}),mkdir(publicRoot,{mode:0o700}),mkdir(backups,{mode:0o700})]);
  const path=join(mount,'account.sqlite');
  const database=new DatabaseSync(path);
  database.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO probe(value) VALUES (\'synthetic private data\')');
  await chmod(path,0o600);
  t.after(()=>{try{database.close()}catch{}});
  const env={COMPASS_STORAGE_MODE:'persistent-volume',RAILWAY_VOLUME_MOUNT_PATH:mount,COMPASS_ACCOUNT_DATABASE:path,
    STATIC_ROOT:publicRoot,BETTER_AUTH_SECRET:randomBytes(48).toString('base64url'),COMPASS_BACKUP_DIRECTORY:backups};
  const verified={readMountInfo:async()=>`29 23 8:1 / ${mount.replace(/ /g,'\\040')} rw,relatime - ext4 /dev/approved-volume rw\n`};
  return {directory,mount,publicRoot,backups,path,database,env,verified};
}

test('an ordinary writable directory is not advertised as durable cloud storage',async t=>{
  const context=await fixture(t);
  assert.deepEqual(await inspectStorage({}),{mode:'ephemeral-preview',dependencies:['persistent_volume_not_enabled']});
  const unmounted=await inspectStorage(context.env,{readMountInfo:async()=>''});
  assert.equal(unmounted.mode,'ephemeral-preview');assert.ok(unmounted.dependencies.includes('volume_mount_unverified'));
  const unavailable=await inspectStorage(context.env,{readMountInfo:async()=>{throw Error('Not a Linux volume mount')}});
  assert.equal(unavailable.mode,'ephemeral-preview');
  assert.ok(!JSON.stringify(unavailable).includes(context.path));
});

test('a verified mount and private writable database require a fixed signing secret',async t=>{
  const {env,verified}=await fixture(t);
  assert.deepEqual(await inspectStorage(env,verified),{mode:'durable',dependencies:[]});
  const ephemeral=await inspectStorage({...env,BETTER_AUTH_SECRET:undefined,COMPASS_ACCOUNT_EPHEMERAL_SECRET:'1'},verified);
  assert.equal(ephemeral.mode,'ephemeral-preview');assert.ok(ephemeral.dependencies.includes('fixed_auth_secret_required'));
  assert.equal((await inspectStorage({...env,RAILWAY_VOLUME_MOUNT_PATH:'/'},verified)).mode,'ephemeral-preview');
});

test('symlink escapes, public database locations and unsafe permissions fail storage readiness',async t=>{
  const {env,verified,directory,path,mount}=await fixture(t);
  const outside=join(directory,'outside.sqlite');await copyFile(path,outside);await chmod(outside,0o600);
  const escaped=join(mount,'escaped.sqlite');await symlink(outside,escaped);
  assert.ok((await inspectStorage({...env,COMPASS_ACCOUNT_DATABASE:escaped},verified)).dependencies.includes('database_outside_volume'));
  assert.ok((await inspectStorage({...env,STATIC_ROOT:mount},verified)).dependencies.includes('database_in_static_root'));
  await chmod(path,0o644);
  assert.ok((await inspectStorage(env,verified)).dependencies.includes('database_permissions_unsafe'));
});

test('explicit snapshots are private, consistent and cannot be written under the public asset root',async t=>{
  const {env,database,publicRoot,backups,directory}=await fixture(t);
  const snapshot=await backupAccountDatabase({env,database});
  assert.ok(snapshot.path.startsWith(backups+'/'));assert.ok(snapshot.bytes>0);
  assert.equal((await stat(snapshot.path)).mode&0o777,0o600);
  const check=new DatabaseSync(snapshot.path,{readOnly:true});
  assert.equal(check.prepare('SELECT value FROM probe').get().value,'synthetic private data');check.close();
  await assert.rejects(backupAccountDatabase({env:{...env,COMPASS_BACKUP_DIRECTORY:publicRoot},database}),error=>error.code==='backup_directory_is_public');
  const escaped=join(directory,'public-backup-link');await symlink(publicRoot,escaped);
  await assert.rejects(backupAccountDatabase({env:{...env,COMPASS_BACKUP_DIRECTORY:escaped},database}),error=>error.code==='backup_directory_is_public');
  await chmod(backups,0o755);
  await assert.rejects(backupAccountDatabase({env,database}),error=>error.code==='backup_directory_unavailable_or_not_private');
});

test('a real account and its owned project restore from a private snapshot with the fixed session secret',async t=>{
  const context=await fixture(t);context.database.close();
  let auth;
  const server=createServer(async(req,res)=>{if(!await auth.handleNode(req,res)){res.statusCode=404;res.end()}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const env={...context.env,NODE_ENV:'test',COMPASS_ACCOUNT_MODE:'staging',COMPASS_ACCOUNT_ORIGIN:origin};
  auth=createAccountAuth({env});await auth.ready;
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await auth.close()});
  const signup=await fetch(origin+'/api/auth/sign-up/email',{method:'POST',headers:{origin,'content-type':'application/json'},
    body:JSON.stringify({name:'Backup tester',email:'backup@compass.test',password:'Disposable backup verification password 45!'})});
  assert.equal(signup.status,200);
  const cookie=signup.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  const identity=await auth.getIdentity(new Headers({cookie}));assert.ok(identity);
  const store=createAccountStore(auth.database),stamp=new Date().toISOString();
  const project=store.saveProject(identity.userId,{name:'Backup project',revisions:[{id:'revision_backup',at:stamp,prompt:'A private backup test',number:1,
    plan:{intent:{business:'Backup project',kind:'studio'},version:1},render:{html:'<!doctype html><html><body><h1>Private snapshot</h1></body></html>',version:1,pending:[]},source:'prepared',placeholder:true}]});
  const snapshot=await backupAccountDatabase({env,database:auth.database});
  const restoredPath=join(context.mount,'restored.sqlite');await copyFile(snapshot.path,restoredPath);await chmod(restoredPath,0o600);
  const restored=createAccountAuth({env:{...env,COMPASS_ACCOUNT_DATABASE:restoredPath}});await restored.ready;
  t.after(()=>restored.close());
  assert.deepEqual(await restored.getIdentity(new Headers({cookie})),identity);
  const restoredStore=createAccountStore(restored.database);
  assert.deepEqual(restoredStore.getProject(identity.userId,project.id),project);
  assert.throws(()=>restoredStore.getProject('different_user',project.id),error=>error.status===404);
});
