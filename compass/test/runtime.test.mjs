import test from 'node:test';
import assert from 'node:assert/strict';
import * as filesystem from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {preparePrivateRuntimeDirectory,prepareRuntimeVolume,startCompassRuntime} from '../account/runtime.mjs';
import {inspectStorage,prepareProductionStorage} from '../account/storage.mjs';

async function fixture(t) {
  const parent=await filesystem.realpath(await filesystem.mkdtemp(join(tmpdir(),'compass-runtime-test-')));
  await filesystem.chmod(parent,0o700);
  t.after(()=>filesystem.rm(parent,{recursive:true,force:true}));
  return {parent,directory:join(parent,'compass'),uid:process.geteuid(),gid:process.getegid()};
}

test('runtime provisioning creates only an absent private directory and changes only that new inode ownership',async t=>{
  const {parent,directory,uid,gid}=await fixture(t);
  const parentBefore=await filesystem.lstat(parent),changed=[];
  const fs={...filesystem,open:async(...args)=>{
    const handle=await filesystem.open(...args);
    return {stat:()=>handle.stat(),close:()=>handle.close(),chown:async(...identity)=>{
      changed.push({path:args[0],identity});return handle.chown(...identity);
    }};
  }};
  await preparePrivateRuntimeDirectory(directory,{uid,gid,fs});
  const created=await filesystem.lstat(directory),parentAfter=await filesystem.lstat(parent);
  assert.equal(created.isDirectory(),true);assert.equal(created.mode&0o7777,0o700);
  assert.equal(created.uid,uid);assert.equal(created.gid,gid);
  assert.deepEqual(changed,[{path:directory,identity:[uid,gid]}]);
  assert.deepEqual(await filesystem.readdir(directory),[]);
  assert.equal(parentAfter.mode,parentBefore.mode);assert.equal(parentAfter.uid,parentBefore.uid);assert.equal(parentAfter.gid,parentBefore.gid);
});

test('a safe existing directory and its data pass without any ownership or permission changes',async t=>{
  const {directory,uid,gid}=await fixture(t);
  await filesystem.mkdir(directory,{mode:0o700});
  const data=join(directory,'existing.sqlite');await filesystem.writeFile(data,'Synthetic existing account bytes',{mode:0o600});
  const before=await filesystem.lstat(directory),beforeData=await filesystem.lstat(data);
  const fs={...filesystem,chown:()=>assert.fail('Existing paths must not be chowned'),chmod:()=>assert.fail('Existing paths must not be chmodded'),open:async(...args)=>{
    const handle=await filesystem.open(...args);
    return {stat:()=>handle.stat(),close:()=>handle.close(),chown:()=>assert.fail('Existing directory must not be chowned')};
  }};
  await preparePrivateRuntimeDirectory(directory,{uid,gid,fs});
  const after=await filesystem.lstat(directory),afterData=await filesystem.lstat(data);
  for(const field of ['ino','dev','uid','gid','mode'])assert.equal(after[field],before[field]);
  for(const field of ['ino','dev','uid','gid','mode','size','mtimeMs'])assert.equal(afterData[field],beforeData[field]);
  assert.equal(await filesystem.readFile(data,'utf8'),'Synthetic existing account bytes');
});

test('unsafe existing directories and files fail without repairing permissions or replacing their data',async t=>{
  const {parent,directory,uid,gid}=await fixture(t);
  await filesystem.mkdir(directory,{mode:0o755});await filesystem.chmod(directory,0o755);
  const marker=join(directory,'keep.txt');await filesystem.writeFile(marker,'Keep this existing data',{mode:0o600});
  await assert.rejects(preparePrivateRuntimeDirectory(directory,{uid,gid}),error=>error.code==='runtime_directory_unsafe');
  assert.equal((await filesystem.lstat(directory)).mode&0o7777,0o755);
  assert.equal(await filesystem.readFile(marker,'utf8'),'Keep this existing data');
  await filesystem.chmod(directory,0o700);
  await assert.rejects(preparePrivateRuntimeDirectory(directory,{uid:uid+1,gid}),error=>error.code==='runtime_directory_unsafe');
  assert.equal((await filesystem.lstat(directory)).uid,uid);
  const file=join(parent,'existing-file');await filesystem.writeFile(file,'Do not replace',{mode:0o600});
  await assert.rejects(preparePrivateRuntimeDirectory(file,{uid,gid}),error=>error.code==='runtime_directory_unsafe');
  assert.equal(await filesystem.readFile(file,'utf8'),'Do not replace');
});

test('a symlink or writable parent fails without following or modifying the target',async t=>{
  const {parent,directory,uid,gid}=await fixture(t);
  const target=join(parent,'existing-target');await filesystem.mkdir(target,{mode:0o700});
  const data=join(target,'keep.txt');await filesystem.writeFile(data,'Preserve symlink target',{mode:0o600});
  const before=await filesystem.lstat(target);await filesystem.symlink(target,directory);
  await assert.rejects(preparePrivateRuntimeDirectory(directory,{uid,gid}),error=>error.code==='runtime_directory_unsafe');
  assert.equal((await filesystem.lstat(directory)).isSymbolicLink(),true);
  assert.equal(await filesystem.readFile(data,'utf8'),'Preserve symlink target');
  const after=await filesystem.lstat(target);
  for(const field of ['ino','uid','gid','mode'])assert.equal(after[field],before[field]);
  await filesystem.chmod(parent,0o777);
  const absent=join(parent,'absent');
  await assert.rejects(preparePrivateRuntimeDirectory(absent,{uid,gid}),error=>error.code==='runtime_parent_unsafe');
  await assert.rejects(filesystem.lstat(absent),error=>error.code==='ENOENT');
});

test('storage initializes inside a writable private child while its mount root remains non-writable',async t=>{
  const {parent,directory}=await fixture(t);
  const mount=join(parent,'mount'),privatePath=join(mount,'compass'),database=join(privatePath,'accounts.sqlite');
  await filesystem.mkdir(mount,{mode:0o700});await filesystem.mkdir(privatePath,{mode:0o700});
  await filesystem.chmod(mount,0o555);
  const env={COMPASS_ACCOUNT_MODE:'production',COMPASS_STORAGE_MODE:'persistent-volume',RAILWAY_VOLUME_MOUNT_PATH:mount,
    COMPASS_ACCOUNT_DATABASE:database,STATIC_ROOT:directory,BETTER_AUTH_SECRET:'Synthetic fixed runtime storage test secret with sufficient length'};
  const verified={readMountInfo:async()=>mountInfo('ext4','rw',mount)};
  // Root ignores permission bits; the normal developer/test identity proves the
  // distinction between traversing the mount and writing its private child.
  try{
    if(process.geteuid()!==0)await assert.rejects(filesystem.access(mount,constants.W_OK));
    assert.deepEqual(await prepareProductionStorage(env,verified),{mode:'durable',dependencies:[]});
    assert.deepEqual(await inspectStorage(env,verified),{mode:'durable',dependencies:[]});
    assert.equal((await filesystem.stat(database)).mode&0o777,0o600);
    assert.equal((await filesystem.stat(mount)).mode&0o777,0o555);
    const unavailable={...env,COMPASS_ACCOUNT_DATABASE:join(mount,'absent','accounts.sqlite')};
    if(process.geteuid()!==0){
      assert.equal((await prepareProductionStorage(unavailable,verified)).mode,'ephemeral-preview');
      await assert.rejects(filesystem.lstat(join(mount,'absent')),error=>error.code==='ENOENT');
    }
  }finally{await filesystem.chmod(mount,0o700)}
});

const volumeEnvironment=()=>({COMPASS_STORAGE_MODE:'persistent-volume',RAILWAY_VOLUME_MOUNT_PATH:'/data',
  COMPASS_ACCOUNT_DATABASE:'/data/compass/accounts.sqlite',COMPASS_BACKUP_DIRECTORY:'/data/compass/backups'});
const mountInfo=(filesystem='ext4',options='rw,relatime',mount='/data')=>`29 23 8:1 / ${mount} ${options} - ${filesystem} /dev/private-volume rw\n`;
const mountDependencies=overrides=>({
  fs:{lstat:async()=>({isDirectory:()=>true,isSymbolicLink:()=>false,uid:0,mode:0o40755}),realpath:async()=>'/data'},
  readMountInfo:async()=>mountInfo(),prepareDirectory:async()=>{},...overrides,
});

test('only the fixed explicitly configured durable mount permits directory provisioning, including before account activation',async()=>{
  const provisioned=[];
  assert.deepEqual(await prepareRuntimeVolume(volumeEnvironment(),mountDependencies({prepareDirectory:async directory=>provisioned.push(directory)})),{configured:true});
  assert.deepEqual(provisioned,['/data/compass']);
  for(const key of ['RAILWAY_VOLUME_MOUNT_PATH','COMPASS_ACCOUNT_DATABASE','COMPASS_BACKUP_DIRECTORY']){
    for(const value of [undefined,'/tmp/elsewhere','/data/compass/../compass/accounts.sqlite']){
      await assert.rejects(prepareRuntimeVolume({...volumeEnvironment(),[key]:value},mountDependencies({prepareDirectory:()=>assert.fail('Invalid paths must not provision')})),error=>error.code==='runtime_storage_paths_invalid');
    }
  }
  assert.deepEqual(await prepareRuntimeVolume({},mountDependencies({fs:{lstat:()=>assert.fail('Default preview must not access storage')},readMountInfo:()=>assert.fail('Default preview must not inspect mounts')})),{configured:false});
});

test('temporary, read-only, missing, symlinked and writable-parent mounts fail before provisioning',async()=>{
  const unprovisioned=()=>assert.fail('Unverified mounts must not provision');
  for(const info of ['',mountInfo('tmpfs'),mountInfo('ramfs'),mountInfo('overlay'),mountInfo('ext4','ro'),mountInfo('ext4','rw','/data/compass')]){
    await assert.rejects(prepareRuntimeVolume(volumeEnvironment(),mountDependencies({readMountInfo:async()=>info,prepareDirectory:unprovisioned})),error=>error.code==='runtime_mount_unverified');
  }
  for(const info of [
    {isDirectory:()=>false,isSymbolicLink:()=>true,uid:0,mode:0o40755},
    {isDirectory:()=>true,isSymbolicLink:()=>false,uid:1000,mode:0o40755},
    {isDirectory:()=>true,isSymbolicLink:()=>false,uid:0,mode:0o40777},
  ]){
    await assert.rejects(prepareRuntimeVolume(volumeEnvironment(),mountDependencies({fs:{lstat:async()=>info,realpath:async()=>'/data'},prepareDirectory:unprovisioned})),error=>error.code==='runtime_mount_unsafe');
  }
  await assert.rejects(prepareRuntimeVolume(volumeEnvironment(),mountDependencies({fs:{...mountDependencies().fs,realpath:async()=>'/some-other-mount'},prepareDirectory:unprovisioned})),error=>error.code==='runtime_mount_unsafe');
});

function rootRuntime(calls) {
  let uid=0,gid=0,groups=[0,27];
  return {getuid:()=>uid,geteuid:()=>uid,getgid:()=>gid,getegid:()=>gid,getgroups:()=>groups,
    setgroups:value=>{calls.push(['groups',value]);groups=value},
    setgid:value=>{calls.push(['gid',value]);gid=1000},setuid:value=>{calls.push(['uid',value]);uid=1000}};
}

test('root provisioning precedes dropping every group and identity; server imports and startup happen only afterward',async()=>{
  const calls=[],runtime=rootRuntime(calls),messages=[],app={synthetic:true};
  const result=await startCompassRuntime({env:volumeEnvironment(),runtime,log:message=>messages.push(message),
    prepareStorage:async env=>{assert.equal(env.COMPASS_STORAGE_MODE,'persistent-volume');assert.equal(runtime.getuid(),0);calls.push(['prepare']);return {configured:true}},
    loadServer:async()=>{assert.equal(runtime.getuid(),1000);assert.equal(runtime.getgid(),1000);assert.deepEqual(runtime.getgroups(),[]);calls.push(['import']);
      return {startCompassServer:()=>{calls.push(['start']);return app}}},
  });
  assert.equal(result,app);
  assert.deepEqual(calls,[['prepare'],['groups',[]],['gid','node'],['uid','node'],['import'],['start']]);
  assert.deepEqual(messages,['COMPASS runtime storage ready','COMPASS runtime unprivileged']);
});

test('failed provisioning or an incomplete privilege drop prevents any server import',async()=>{
  const loadServer=()=>assert.fail('Server must not be imported before a safe identity exists');
  await assert.rejects(startCompassRuntime({runtime:rootRuntime([]),prepareStorage:async()=>{throw Error('Synthetic unsafe mount')},loadServer,log:()=>{}}));
  for(const getter of ['getuid','geteuid','getgid','getegid']){
    const runtime=rootRuntime([]);runtime[getter]=()=>0;
    await assert.rejects(startCompassRuntime({runtime,prepareStorage:async()=>({configured:false}),loadServer,log:()=>{}}),error=>error.code==='runtime_privilege_drop_failed');
  }
  const runtime=rootRuntime([]);runtime.getgroups=()=>[0,1000];
  await assert.rejects(startCompassRuntime({runtime,prepareStorage:async()=>({configured:false}),loadServer,log:()=>{}}),error=>error.code==='runtime_privilege_drop_failed');
});

test('default preview still drops root privileges; an existing unprivileged development runtime starts without provisioning',async()=>{
  const calls=[],runtime=rootRuntime(calls);
  await startCompassRuntime({env:{},runtime,log:()=>{},loadServer:async()=>({startCompassServer:()=>calls.push(['start'])})});
  assert.deepEqual(calls,[['groups',[]],['gid','node'],['uid','node'],['start']]);
  const unprivileged={getuid:()=>501,geteuid:()=>501};
  assert.equal(await startCompassRuntime({runtime:unprivileged,env:volumeEnvironment(),prepareStorage:()=>assert.fail('Unprivileged development must not provision as root'),
    loadServer:async()=>({startCompassServer:()=>true})}),true);
});
