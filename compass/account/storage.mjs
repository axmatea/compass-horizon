import {constants} from 'node:fs';
import {access,realpath,stat,lstat,readFile,readdir,open,chmod,unlink,mkdir} from 'node:fs/promises';
import {resolve,relative,isAbsolute,sep,join,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

const within=(root,path)=>{const part=relative(root,path);return part!=='' && part!=='..' && !part.startsWith('..'+sep) && !isAbsolute(part)};
const absolute=value=>typeof value==='string'&&isAbsolute(value)&&resolve(value)!==sep;
const privateError=code=>Object.assign(new Error('Private storage operation is unavailable.'),{code});
const staticPath=env=>resolve(env.STATIC_ROOT || fileURLToPath(new URL('../dist/',import.meta.url)));
// Keep missing descendants relative to their real existing ancestor. Resolving
// the string alone would miss a symlinked parent that leads into public assets.
const canonical=async path=>{
  let current=isAbsolute(path)?path:resolve(path);const suffix=[];
  while(true){
    try{return resolve(await realpath(current),...suffix.reverse())}
    catch(error){
      if(!['ENOENT','ENOTDIR'].includes(error?.code)||dirname(current)===current)throw error;
      suffix.push(basename(current));current=dirname(current);
    }
  }
};
const unescapeMount=value=>value.replace(/\\([0-7]{3})/g,(_,octal)=>String.fromCharCode(parseInt(octal,8)));
const mountInfo=()=>readFile('/proc/self/mountinfo','utf8');
const temporaryFilesystems=new Set(['tmpfs','ramfs','overlay','proc','sysfs','devtmpfs','devpts','cgroup','cgroup2','mqueue','securityfs','tracefs','debugfs','fusectl','hugetlbfs','nsfs','squashfs']);

/** A bounded technical storage limit, independent of plans or payment status. */
export function accountDatabaseLimit(env=process.env) {
  if(env.COMPASS_ACCOUNT_MODE!=='production')return 64*1024*1024;
  if(env.COMPASS_ACCOUNT_MAX_DATABASE_BYTES===undefined)return 256*1024*1024;
  const value=Number(env.COMPASS_ACCOUNT_MAX_DATABASE_BYTES);
  if(!Number.isSafeInteger(value)||value<64*1024*1024||value>1024*1024*1024)throw privateError('database_limit_invalid');
  return value;
}

function backupRetention(env) {
  const value=env.COMPASS_BACKUP_RETENTION===undefined?7:Number(env.COMPASS_BACKUP_RETENTION);
  if(!Number.isSafeInteger(value)||value<1||value>30)throw privateError('backup_retention_invalid');
  return value;
}

async function pruneSnapshots(directory,destination,limit) {
  const pattern=/^compass-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.sqlite$/;
  const snapshots=[];
  for(const entry of await readdir(directory,{withFileTypes:true})){
    if(!entry.isFile()||!pattern.test(entry.name))continue;
    const path=join(directory,entry.name),info=await lstat(path);
    // Only this helper's regular private files are eligible. Leave unrelated
    // files, symlinks and unsafe permissions for an operator to inspect.
    if(!info.isFile()||(info.mode&0o077)!==0||await realpath(path)!==path)continue;
    snapshots.push(path);
  }
  const excess=Math.max(0,snapshots.length-limit);
  const remove=snapshots.filter(path=>path!==destination).sort().slice(0,excess);
  for(const path of remove){
    const info=await lstat(path);
    if(!info.isFile()||(info.mode&0o077)!==0||await realpath(path)!==path)throw privateError('backup_retention_failed');
    await unlink(path);
  }
  return remove.length;
}

async function storageLocation(env,readMountInfo) {
  const dependencies=[];
  if(env.COMPASS_STORAGE_MODE!=='persistent-volume')return {dependencies:['persistent_volume_not_enabled']};
  if(typeof env.BETTER_AUTH_SECRET!=='string'||env.BETTER_AUTH_SECRET.trim().length<32)dependencies.push('fixed_auth_secret_required');
  if(!absolute(env.RAILWAY_VOLUME_MOUNT_PATH))dependencies.push('volume_mount_missing');
  if(!absolute(env.COMPASS_ACCOUNT_DATABASE))dependencies.push('database_path_invalid');
  try{accountDatabaseLimit(env)}catch{dependencies.push('database_limit_invalid')}
  if(dependencies.length)return {dependencies};
  let mount;
  try {
    mount=await realpath(env.RAILWAY_VOLUME_MOUNT_PATH);
    if(mount===sep || !(await stat(mount)).isDirectory())throw Error();
  } catch {return {dependencies:['volume_mount_missing']};}
  try {
    const info=await readMountInfo();
    const mounted=info.split('\n').some(line=>{
      const [location,device]=line.split(' - '),fields=location.split(' '),filesystem=device?.split(' ')[0];
      return fields.length>=6 && unescapeMount(fields[4])===mount && filesystem && !temporaryFilesystems.has(filesystem);
    });
    if(!mounted)dependencies.push('volume_mount_unverified');
  } catch {dependencies.push('volume_mount_unverified');}
  return {mount,dependencies};
}

/** No data is provisioned here. A configured directory alone is not a volume. */
export async function inspectStorage(env=process.env,{readMountInfo=mountInfo}={}) {
  const {mount,dependencies}=await storageLocation(env,readMountInfo);
  if(!mount)return {mode:'ephemeral-preview',dependencies};
  try {
    const database=await realpath(env.COMPASS_ACCOUNT_DATABASE);
    const info=await stat(database);
    if(!info.isFile())throw Error();
    if(!within(mount,database))dependencies.push('database_outside_volume');
    const publicRoot=await canonical(staticPath(env));
    if(database===publicRoot||within(publicRoot,database))dependencies.push('database_in_static_root');
    if(info.mode&0o077)dependencies.push('database_permissions_unsafe');
    await access(mount,constants.W_OK);await access(dirname(database),constants.W_OK|constants.X_OK);
    await access(database,constants.R_OK|constants.W_OK);
  } catch {dependencies.push('database_unavailable_or_not_writable');}
  return {mode:dependencies.length?'ephemeral-preview':'durable',dependencies};
}

/**
 * Create only an absent, empty private database on an independently verified
 * production mount. Existing files are inspected, never truncated or chmodded.
 * Schema migrations happen later, after the full readiness check succeeds.
 */
export async function prepareProductionStorage(env=process.env,{readMountInfo=mountInfo}={}) {
  const {mount,dependencies}=await storageLocation(env,readMountInfo);
  if(env.COMPASS_ACCOUNT_MODE!=='production')dependencies.push('production_mode_required');
  if(dependencies.length)return {mode:'ephemeral-preview',dependencies};
  try {
    const database=await canonical(env.COMPASS_ACCOUNT_DATABASE),publicRoot=await canonical(staticPath(env));
    if(!within(mount,database))return {mode:'ephemeral-preview',dependencies:['database_outside_volume']};
    if(database===publicRoot||within(publicRoot,database))return {mode:'ephemeral-preview',dependencies:['database_in_static_root']};
    await access(mount,constants.W_OK|constants.X_OK);
    await mkdir(dirname(database),{recursive:true,mode:0o700});
    // Recheck after mkdir, including any pre-existing symlink in the path.
    if(await realpath(dirname(env.COMPASS_ACCOUNT_DATABASE))!==dirname(database))throw Error();
    try {
      const file=await open(database,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
      await file.close();
    } catch(error){if(error?.code!=='EEXIST')throw error}
  } catch {return {mode:'ephemeral-preview',dependencies:['database_unavailable_or_not_writable']};}
  return inspectStorage(env,{readMountInfo});
}

/** Explicit operator-only backup. Never call from public/user routes or startup. */
export async function backupAccountDatabase({env=process.env,database}={}) {
  if(!database?.isOpen || !absolute(env.COMPASS_ACCOUNT_DATABASE) || !absolute(env.COMPASS_BACKUP_DIRECTORY))throw privateError('backup_configuration_required');
  const retention=env.COMPASS_ACCOUNT_MODE==='production'?backupRetention(env):null;
  let directory,source;
  try {
    directory=await realpath(env.COMPASS_BACKUP_DIRECTORY);
    const info=await stat(directory);
    if(!info.isDirectory() || (info.mode&0o077)!==0)throw Error();
    await access(directory,constants.R_OK|constants.W_OK|constants.X_OK);
    const publicRoot=await canonical(staticPath(env));
    if(directory===publicRoot||within(publicRoot,directory))throw privateError('backup_directory_is_public');
    source=await realpath(env.COMPASS_ACCOUNT_DATABASE);
    const actual=database.prepare('PRAGMA database_list').all().find(item=>item.name==='main')?.file;
    if(!actual||await realpath(actual)!==source)throw privateError('backup_database_mismatch');
    if((await stat(source)).size>accountDatabaseLimit(env))throw privateError('backup_database_too_large');
  } catch(error){throw privateError(error?.code?.startsWith('backup_')?error.code:'backup_directory_unavailable_or_not_private');}
  const filename='compass-backup-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID()+'.sqlite';
  const destination=join(directory,filename);
  let created=false,verified=false;
  try {
    const file=await open(destination,'wx',0o600);created=true;await file.close();
    const {backup,DatabaseSync}=await import('node:sqlite');
    await backup(database,destination);
    await chmod(destination,0o600);
    const snapshot=new DatabaseSync(destination,{readOnly:true});
    try {if(snapshot.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw privateError('backup_integrity_failed');}
    finally{snapshot.close();}
    const bytes=(await stat(destination)).size;
    verified=true;
    const pruned=retention===null?0:await pruneSnapshots(directory,destination,retention);
    return {filename,path:destination,bytes,createdAt:new Date().toISOString(),...(retention===null?{}:{retention,pruned})};
  } catch(error){if(created&&!verified)try{await unlink(destination)}catch{}throw privateError(error?.code?.startsWith('backup_')?error.code:'backup_failed');}
}
