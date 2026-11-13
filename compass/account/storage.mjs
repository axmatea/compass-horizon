import {constants} from 'node:fs';
import {access,realpath,stat,readFile,open,chmod,unlink} from 'node:fs/promises';
import {resolve,relative,isAbsolute,sep,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

const within=(root,path)=>{const part=relative(root,path);return part!=='' && part!=='..' && !part.startsWith('..'+sep) && !isAbsolute(part)};
const absolute=value=>typeof value==='string'&&isAbsolute(value)&&resolve(value)!==sep;
const privateError=code=>Object.assign(new Error('Private storage operation is unavailable.'),{code});
const staticPath=env=>resolve(env.STATIC_ROOT || fileURLToPath(new URL('../dist/',import.meta.url)));
const canonical=async path=>{try{return await realpath(path)}catch{return resolve(path)}};
const unescapeMount=value=>value.replace(/\\([0-7]{3})/g,(_,octal)=>String.fromCharCode(parseInt(octal,8)));

/** No data is provisioned here. A configured directory alone is not a volume. */
export async function inspectStorage(env=process.env,{readMountInfo=()=>readFile('/proc/self/mountinfo','utf8')}={}) {
  const dependencies=[];
  if(env.COMPASS_STORAGE_MODE!=='persistent-volume')return {mode:'ephemeral-preview',dependencies:['persistent_volume_not_enabled']};
  if(typeof env.BETTER_AUTH_SECRET!=='string'||env.BETTER_AUTH_SECRET.trim().length<32)dependencies.push('fixed_auth_secret_required');
  if(!absolute(env.RAILWAY_VOLUME_MOUNT_PATH))dependencies.push('volume_mount_missing');
  if(!absolute(env.COMPASS_ACCOUNT_DATABASE))dependencies.push('database_path_invalid');
  if(dependencies.length)return {mode:'ephemeral-preview',dependencies};
  let mount,database;
  try {
    mount=await realpath(env.RAILWAY_VOLUME_MOUNT_PATH);
    if(mount===sep || !(await stat(mount)).isDirectory())throw Error();
  } catch {return {mode:'ephemeral-preview',dependencies:['volume_mount_missing']};}
  try {
    const info=await readMountInfo();
    const mounted=info.split('\n').some(line=>{const fields=line.split(' ');return fields.length>6 && unescapeMount(fields[4])===mount});
    if(!mounted)dependencies.push('volume_mount_unverified');
  } catch {dependencies.push('volume_mount_unverified');}
  try {
    database=await realpath(env.COMPASS_ACCOUNT_DATABASE);
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

/** Explicit operator-only backup. Never call from public/user routes or startup. */
export async function backupAccountDatabase({env=process.env,database}={}) {
  if(!database?.isOpen || !absolute(env.COMPASS_ACCOUNT_DATABASE) || !absolute(env.COMPASS_BACKUP_DIRECTORY))throw privateError('backup_configuration_required');
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
    if((await stat(source)).size>64*1024*1024)throw privateError('backup_database_too_large');
  } catch(error){throw privateError(error?.code?.startsWith('backup_')?error.code:'backup_directory_unavailable_or_not_private');}
  const filename='compass-backup-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID()+'.sqlite';
  const destination=join(directory,filename);
  let created=false;
  try {
    const file=await open(destination,'wx',0o600);created=true;await file.close();
    const {backup,DatabaseSync}=await import('node:sqlite');
    await backup(database,destination);
    await chmod(destination,0o600);
    const snapshot=new DatabaseSync(destination,{readOnly:true});
    try {if(snapshot.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw privateError('backup_integrity_failed');}
    finally{snapshot.close();}
    const bytes=(await stat(destination)).size;
    return {filename,path:destination,bytes,createdAt:new Date().toISOString()};
  } catch(error){if(created)try{await unlink(destination)}catch{}throw privateError(error?.code?.startsWith('backup_')?error.code:'backup_failed');}
}
