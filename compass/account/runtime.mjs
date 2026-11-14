// This entry point deliberately imports only Node built-ins until its root
// provisioning work is finished and the process has become the image's node user.
import {constants} from 'node:fs';
import * as filesystem from 'node:fs/promises';
import {dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

const paths=Object.freeze({mount:'/data',directory:'/data/compass',database:'/data/compass/accounts.sqlite',backups:'/data/compass/backups'});
const nodeIdentity=Object.freeze({uid:1000,gid:1000});
const temporaryFilesystems=new Set(['tmpfs','ramfs','overlay','proc','sysfs','devtmpfs','devpts','cgroup','cgroup2','mqueue','securityfs','tracefs','debugfs','fusectl','hugetlbfs','nsfs','squashfs']);
const failure=code=>Object.assign(new Error('COMPASS runtime initialization failed.'),{code});
const sameFile=(left,right)=>left.dev===right.dev&&left.ino===right.ino;
const privateDirectory=info=>info.isDirectory()&&(info.mode&0o7777)===0o700;
const unescapeMount=value=>value.replace(/\\([0-7]{3})/g,(_,octal)=>String.fromCharCode(parseInt(octal,8)));

/**
 * Provision exactly one absent directory. Existing directories, files and links
 * are inspected only. The root-owned parent must prevent unprivileged renames.
 * A file descriptor confines chown to the newly created directory itself.
 */
export async function preparePrivateRuntimeDirectory(directory,{uid=nodeIdentity.uid,gid=nodeIdentity.gid,fs=filesystem}={}) {
  const parent=await fs.lstat(dirname(directory));
  if(!parent.isDirectory()||parent.uid!==process.geteuid()||(parent.mode&0o022)!==0
    ||await fs.realpath(dirname(directory))!==dirname(directory))throw failure('runtime_parent_unsafe');
  let created=false;
  try{await fs.mkdir(directory,{mode:0o700});created=true}
  catch(error){if(error?.code!=='EEXIST')throw failure('runtime_directory_unavailable')}
  const named=await fs.lstat(directory);
  if(!privateDirectory(named)||named.isSymbolicLink()||await fs.realpath(directory)!==directory)throw failure('runtime_directory_unsafe');
  if(created&&named.uid!==process.geteuid())throw failure('runtime_directory_changed');
  if(!created&&(named.uid!==uid||named.gid!==gid))throw failure('runtime_directory_unsafe');
  const handle=await fs.open(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{
    const opened=await handle.stat();
    if(!sameFile(named,opened)||!privateDirectory(opened))throw failure('runtime_directory_changed');
    if(created)await handle.chown(uid,gid);
    const final=await handle.stat(),current=await fs.lstat(directory);
    if(!sameFile(final,current)||!privateDirectory(final)||final.uid!==uid||final.gid!==gid
      ||current.isSymbolicLink()||await fs.realpath(directory)!==directory)throw failure('runtime_directory_unsafe');
  }finally{await handle.close()}
}

/** A configured path is never sufficient evidence of a mounted durable volume. */
export async function prepareRuntimeVolume(env=process.env,{fs=filesystem,readMountInfo=()=>filesystem.readFile('/proc/self/mountinfo','utf8'),prepareDirectory=preparePrivateRuntimeDirectory}={}) {
  if(env.COMPASS_STORAGE_MODE!=='persistent-volume')return {configured:false};
  if(env.RAILWAY_VOLUME_MOUNT_PATH!==paths.mount||env.COMPASS_ACCOUNT_DATABASE!==paths.database
    ||env.COMPASS_BACKUP_DIRECTORY!==paths.backups)throw failure('runtime_storage_paths_invalid');
  try{
    const mount=await fs.lstat(paths.mount);
    if(!mount.isDirectory()||mount.isSymbolicLink()||mount.uid!==0||(mount.mode&0o022)!==0
      ||await fs.realpath(paths.mount)!==paths.mount)throw failure('runtime_mount_unsafe');
    const mounted=(await readMountInfo()).split('\n').some(line=>{
      const [location,device]=line.split(' - '),fields=location.split(' '),filesystem=device?.split(' ')[0];
      return fields.length>=6&&unescapeMount(fields[4])===paths.mount&&fields[5].split(',').includes('rw')
        &&filesystem&&!temporaryFilesystems.has(filesystem);
    });
    if(!mounted)throw failure('runtime_mount_unverified');
    await prepareDirectory(paths.directory);
    return {configured:true};
  }catch(error){throw failure(error?.code?.startsWith('runtime_')?error.code:'runtime_storage_unavailable')}
}

/** Keep PID 1, with no root supervisor or application imports before setuid. */
export async function startCompassRuntime({env=process.env,runtime=process,prepareStorage=prepareRuntimeVolume,loadServer=()=>import('../server.mjs'),log=message=>console.log(message)}={}) {
  if((typeof runtime.getuid==='function'&&runtime.getuid()===0)
    ||(typeof runtime.geteuid==='function'&&runtime.geteuid()===0)){
    const storage=await prepareStorage(env);
    if(storage.configured)log('COMPASS runtime storage ready');
    runtime.setgroups([]);
    runtime.setgid('node');
    runtime.setuid('node');
    if(runtime.getuid()!==nodeIdentity.uid||runtime.getgid()!==nodeIdentity.gid
      ||runtime.geteuid()!==nodeIdentity.uid||runtime.getegid()!==nodeIdentity.gid
      ||runtime.getgroups().some(group=>group!==nodeIdentity.gid))throw failure('runtime_privilege_drop_failed');
    log('COMPASS runtime unprivileged');
  }
  const {startCompassServer}=await loadServer();
  return startCompassServer();
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  startCompassRuntime().catch(()=>{console.error('COMPASS runtime initialization failed.');process.exitCode=1});
}
