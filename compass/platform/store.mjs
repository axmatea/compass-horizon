import {randomUUID} from 'node:crypto';
import {createApplicationFileMetadata,validateApplicationManifest,validateApplicationRecord} from '../generation/index.mjs';
import {validateEditableHtml} from '../html/edit.mjs';
import {inspectImage,ASSET_LIMITS} from '../generation/image.mjs';
const fail=(status,code)=>{throw Object.assign(new Error(code),{status,code});};
const id=prefix=>prefix+'_'+randomUUID();
const stamp=()=>new Date().toISOString();
const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value);

export function createPlatformStore(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS compass_application(id TEXT PRIMARY KEY,owner TEXT NOT NULL,manifest TEXT NOT NULL,version INTEGER NOT NULL,source TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS compass_application_owner ON compass_application(owner,updated_at);
    CREATE TABLE IF NOT EXISTS compass_application_revision(app_id TEXT NOT NULL,version INTEGER NOT NULL,manifest TEXT NOT NULL,prompt TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(app_id,version));
    CREATE TABLE IF NOT EXISTS compass_application_record(id TEXT PRIMARY KEY,app_id TEXT NOT NULL,owner TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS compass_application_record_owner ON compass_application_record(app_id,owner);
    CREATE TABLE IF NOT EXISTS compass_application_asset(id TEXT PRIMARY KEY,app_id TEXT NOT NULL,owner TEXT NOT NULL,mime TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,bytes INTEGER NOT NULL,sha256 TEXT NOT NULL,data BLOB NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS compass_application_asset_owner ON compass_application_asset(owner,app_id,active);
    CREATE TABLE IF NOT EXISTS compass_application_revision_files(app_id TEXT NOT NULL,version INTEGER NOT NULL,snapshot TEXT NOT NULL,PRIMARY KEY(app_id,version));
    CREATE TABLE IF NOT EXISTS compass_publication(id TEXT PRIMARY KEY,owner TEXT NOT NULL,project_id TEXT NOT NULL,title TEXT NOT NULL,html TEXT NOT NULL,created_at TEXT NOT NULL,revoked_at TEXT);
    CREATE INDEX IF NOT EXISTS compass_publication_owner ON compass_publication(owner,created_at);
    CREATE TABLE IF NOT EXISTS compass_system_event(id TEXT PRIMARY KEY,owner TEXT,category TEXT NOT NULL,code TEXT NOT NULL,created_at TEXT NOT NULL);
  `);
  let transactionDepth=0;
  function atomic(run) {
    if(transactionDepth)return run();
    database.exec('BEGIN IMMEDIATE');transactionDepth++;
    try {const result=run();database.exec('COMMIT');return result;}
    catch(error){database.exec('ROLLBACK');throw error;}
    finally{transactionDepth--;}
  }
  const map=row=>row?{id:row.id,manifest:JSON.parse(row.manifest),version:row.version,source:row.source,createdAt:row.created_at,updatedAt:row.updated_at}:null;
  function getApplication(owner,appId) {
    if(!validId(appId))fail(404,'not_found');
    const app=map(database.prepare('SELECT * FROM compass_application WHERE id=? AND owner=?').get(appId,owner));
    if(!app)fail(404,'not_found');return app;
  }
  function listApplications(owner) {
    return database.prepare('SELECT * FROM compass_application WHERE owner=? ORDER BY updated_at DESC LIMIT 12').all(owner).map(map);
  }
  function assertApplicationCapacity(owner) {
    if(database.prepare('SELECT count(*) AS n FROM compass_application WHERE owner=?').get(owner).n>=12)fail(409,'application_limit');
  }
  const assetMetadata=row=>({id:row.id,mime:row.mime,width:row.width,height:row.height,bytes:row.bytes,sha256:row.sha256,createdAt:row.created_at});
  function activeAssets(owner,appId) {
    return database.prepare('SELECT * FROM compass_application_asset WHERE owner=? AND app_id=? AND active=1 ORDER BY id').all(owner,appId).map(row=>({...assetMetadata(row),data:Buffer.from(row.data)}));
  }
  function assertAssetReferences(owner,appId,manifest) {
    for(const assetId of Object.values(manifest.assets||{}))if(!database.prepare('SELECT id FROM compass_application_asset WHERE id=? AND owner=? AND app_id=? AND active=1').get(assetId,owner,appId))fail(409,'asset_reference_missing');
  }
  function fileChanges(previous,next) {
    const before=new Map(previous.map(file=>[file.path,file])),after=new Map(next.map(file=>[file.path,file])),changes=[];
    for(const path of [...new Set([...before.keys(),...after.keys()])].sort()){
      const old=before.get(path),current=after.get(path);if(old?.sha256===current?.sha256)continue;
      changes.push({path,type:!old?'added':!current?'removed':'modified',sha256:current?.sha256||null,previousSha256:old?.sha256||null});
    }return changes;
  }
  function saveRevisionFiles(owner,appId,version,manifest) {
    const assets=activeAssets(owner,appId),files=createApplicationFileMetadata(manifest,{assets,trustedAssets:true});
    const prior=database.prepare('SELECT snapshot FROM compass_application_revision_files WHERE app_id=? AND version<? ORDER BY version DESC LIMIT 1').get(appId,version);
    const previous=prior?JSON.parse(prior.snapshot).files:[];
    const snapshot={assetIds:assets.map(asset=>asset.id),files,changes:fileChanges(previous,files)};
    database.prepare('INSERT INTO compass_application_revision_files VALUES(?,?,?)').run(appId,version,JSON.stringify(snapshot));
    return snapshot;
  }
  function pruneRevisionAssets(owner,appId,version) {
    database.prepare('DELETE FROM compass_application_revision_files WHERE app_id=? AND version<=?').run(appId,version-16);
    const retained=new Set(database.prepare('SELECT id FROM compass_application_asset WHERE owner=? AND app_id=? AND active=1').all(owner,appId).map(asset=>asset.id));
    for(const row of database.prepare('SELECT snapshot FROM compass_application_revision_files WHERE app_id=?').all(appId))for(const assetId of JSON.parse(row.snapshot).assetIds)retained.add(assetId);
    for(const row of database.prepare('SELECT id FROM compass_application_asset WHERE owner=? AND app_id=? AND active=0').all(owner,appId))if(!retained.has(row.id))database.prepare('DELETE FROM compass_application_asset WHERE id=? AND owner=? AND app_id=?').run(row.id,owner,appId);
  }
  function assetQuota(owner,appId) {
    const application=database.prepare('SELECT count(*) AS retainedFiles,COALESCE(SUM(bytes),0) AS applicationBytes,COALESCE(SUM(active),0) AS activeFiles FROM compass_application_asset WHERE owner=? AND app_id=?').get(owner,appId);
    return {...application,ownerBytes:database.prepare('SELECT COALESCE(SUM(bytes),0) AS n FROM compass_application_asset WHERE owner=?').get(owner).n,limits:ASSET_LIMITS};
  }
  function listAssets(owner,appId){getApplication(owner,appId);return{assets:database.prepare('SELECT id,mime,width,height,bytes,sha256,created_at FROM compass_application_asset WHERE owner=? AND app_id=? AND active=1 ORDER BY id').all(owner,appId).map(assetMetadata),quota:assetQuota(owner,appId)}}
  function getAsset(owner,appId,assetId) {
    getApplication(owner,appId);if(!validId(assetId))fail(404,'not_found');
    const row=database.prepare('SELECT * FROM compass_application_asset WHERE id=? AND app_id=? AND owner=? AND active=1').get(assetId,appId,owner);
    if(!row)fail(404,'not_found');return{...assetMetadata(row),data:Buffer.from(row.data)};
  }
  function saveAsset(owner,appId,raw,mime,expectedVersion) {
    getApplication(owner,appId);const image=inspectImage(raw,mime);
    if(!Number.isSafeInteger(expectedVersion))fail(400,'version_required');
    return atomic(()=>{
      const current=getApplication(owner,appId);if(current.version!==expectedVersion)fail(409,'version_conflict');
      const quota=assetQuota(owner,appId);
      if(quota.activeFiles>=ASSET_LIMITS.activeFiles)fail(409,'asset_file_limit');
      if(quota.applicationBytes+image.bytes>ASSET_LIMITS.applicationBytes)fail(409,'asset_application_quota');
      if(quota.ownerBytes+image.bytes>ASSET_LIMITS.ownerBytes)fail(409,'asset_owner_quota');
      const assetId=id('asset'),at=stamp();
      database.prepare('INSERT INTO compass_application_asset VALUES(?,?,?,?,?,?,?,?,?,1,?)').run(assetId,appId,owner,image.mime,image.width,image.height,image.bytes,image.sha256,image.data,at);
      const application=updateApplication(owner,appId,current.manifest,'Upload project image','prepared',current.version,{force:true});
      const {data,...asset}=getAsset(owner,appId,assetId);return{asset,application,changed:true};
    });
  }
  function deleteAsset(owner,appId,assetId,expectedVersion) {
    getAsset(owner,appId,assetId);if(!Number.isSafeInteger(expectedVersion))fail(400,'version_required');
    return atomic(()=>{
      const current=getApplication(owner,appId);if(current.version!==expectedVersion)fail(409,'version_conflict');
      if(Object.values(current.manifest.assets||{}).includes(assetId))fail(409,'asset_in_use');
      database.prepare('UPDATE compass_application_asset SET active=0 WHERE id=? AND app_id=? AND owner=?').run(assetId,appId,owner);
      return{ok:true,application:updateApplication(owner,appId,current.manifest,'Remove project image','prepared',current.version,{force:true}),changed:true};
    });
  }
  function createApplication(owner,value,prompt,source='prepared') {
    const manifest=validateApplicationManifest(value);if(!manifest)fail(400,'invalid_manifest');
    const appId=id('app'),at=stamp();
    return atomic(()=>{
      assertApplicationCapacity(owner);
      assertAssetReferences(owner,appId,manifest);
      database.prepare('INSERT INTO compass_application VALUES(?,?,?,?,?,?,?)').run(appId,owner,JSON.stringify(manifest),1,source==='model'?'model':'prepared',at,at);
      database.prepare('INSERT INTO compass_application_revision VALUES(?,?,?,?,?)').run(appId,1,JSON.stringify(manifest),String(prompt||'').slice(0,2000),at);
      saveRevisionFiles(owner,appId,1,manifest);
      return getApplication(owner,appId);
    });
  }
  function updateApplication(owner,appId,value,prompt,source='prepared',expectedVersion,{force=false}={}) {
    const manifest=validateApplicationManifest(value);if(!manifest)fail(400,'invalid_manifest');
    return atomic(()=>{
      const current=getApplication(owner,appId);
      if(expectedVersion!==undefined&&expectedVersion!==current.version)fail(409,'version_conflict');
      assertAssetReferences(owner,appId,manifest);
      if(!force&&JSON.stringify(current.manifest)===JSON.stringify(manifest))return current;
      const version=current.version+1,at=stamp();
      database.prepare('UPDATE compass_application SET manifest=?,version=?,source=?,updated_at=? WHERE id=? AND owner=?')
        .run(JSON.stringify(manifest),version,source==='model'?'model':'prepared',at,appId,owner);
      database.prepare('INSERT INTO compass_application_revision VALUES(?,?,?,?,?)').run(appId,version,JSON.stringify(manifest),String(prompt||'').slice(0,2000),at);
      saveRevisionFiles(owner,appId,version,manifest);
      database.prepare('DELETE FROM compass_application_revision WHERE app_id=? AND version<=?').run(appId,version-16);
      pruneRevisionAssets(owner,appId,version);
      return getApplication(owner,appId);
    });
  }
  function deleteApplication(owner,appId) {
    getApplication(owner,appId);return atomic(()=>{
      database.prepare('DELETE FROM compass_application_record WHERE app_id=? AND owner=?').run(appId,owner);
      database.prepare('DELETE FROM compass_application_revision WHERE app_id=?').run(appId);
      database.prepare('DELETE FROM compass_application_revision_files WHERE app_id=?').run(appId);
      database.prepare('DELETE FROM compass_application_asset WHERE app_id=? AND owner=?').run(appId,owner);
      database.prepare('DELETE FROM compass_application WHERE id=? AND owner=?').run(appId,owner);
    });
  }
  function revisions(owner,appId) {
    getApplication(owner,appId);
    return database.prepare('SELECT version,manifest,prompt,created_at FROM compass_application_revision WHERE app_id=? ORDER BY version DESC LIMIT 16').all(appId)
      .map(row=>{const saved=database.prepare('SELECT snapshot FROM compass_application_revision_files WHERE app_id=? AND version=?').get(appId,row.version);const snapshot=saved?JSON.parse(saved.snapshot):{files:[],changes:[]};return{receiptAvailable:Boolean(saved),version:row.version,manifest:JSON.parse(row.manifest),prompt:row.prompt,createdAt:row.created_at,files:snapshot.files,changes:snapshot.changes}});
  }
  function restore(owner,appId,version) {
    if(!Number.isSafeInteger(version)||version<1)fail(400,'invalid_revision');
    return atomic(()=>{
      const current=getApplication(owner,appId),row=database.prepare('SELECT manifest FROM compass_application_revision WHERE app_id=? AND version=?').get(appId,version);
      if(!row)fail(404,'not_found');
      const saved=database.prepare('SELECT snapshot FROM compass_application_revision_files WHERE app_id=? AND version=?').get(appId,version),assetIds=saved?JSON.parse(saved.snapshot).assetIds:[];
      for(const assetId of assetIds)if(!database.prepare('SELECT id FROM compass_application_asset WHERE id=? AND app_id=? AND owner=?').get(assetId,appId,owner))fail(409,'revision_asset_missing');
      const before=activeAssets(owner,appId).map(asset=>asset.id).sort();
      database.prepare('UPDATE compass_application_asset SET active=0 WHERE app_id=? AND owner=?').run(appId,owner);
      for(const assetId of assetIds)database.prepare('UPDATE compass_application_asset SET active=1 WHERE id=? AND app_id=? AND owner=?').run(assetId,appId,owner);
      return updateApplication(owner,appId,JSON.parse(row.manifest),'Restore revision '+version,'prepared',current.version,{force:JSON.stringify(before)!==JSON.stringify([...assetIds].sort())});
    });
  }
  const record=row=>({id:row.id,data:JSON.parse(row.data),createdAt:row.created_at,updatedAt:row.updated_at});
  function listRecords(owner,appId) {
    getApplication(owner,appId);
    return database.prepare('SELECT * FROM compass_application_record WHERE app_id=? AND owner=? ORDER BY created_at DESC LIMIT 200').all(appId,owner).map(record);
  }
  function saveRecord(owner,appId,value,recordId) {
    const app=getApplication(owner,appId);
    const checked=validateApplicationRecord(app.manifest,value);
    if(!checked.ok)fail(400,'invalid_record');
    let previous=null;
    if(recordId){
      if(!validId(recordId))fail(404,'not_found');
      previous=database.prepare('SELECT * FROM compass_application_record WHERE id=? AND app_id=? AND owner=?').get(recordId,appId,owner);
      if(!previous)fail(404,'not_found');
    }
    const at=stamp(),rowId=previous?.id||id('record');
    if(!previous&&database.prepare('SELECT count(*) AS n FROM compass_application_record WHERE app_id=? AND owner=?').get(appId,owner).n>=200)fail(409,'record_limit');
    // Fields hidden by a design revision are retained until explicitly deleted.
    // Restoring the older design never requires overwriting business records.
    const visible=new Set(app.manifest.entity.fields.map(field=>field.key));
    const hidden=Object.fromEntries(Object.entries(previous?JSON.parse(previous.data):{}).filter(([key])=>!visible.has(key)));
    const data={...hidden,...checked.value};
    if(Object.keys(data).length>32||Buffer.byteLength(JSON.stringify(data))>16384)fail(409,'record_retention_limit');
    database.prepare('INSERT INTO compass_application_record VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at WHERE compass_application_record.owner=excluded.owner AND compass_application_record.app_id=excluded.app_id')
      .run(rowId,appId,owner,JSON.stringify(data),previous?.created_at||at,at);
    return record(database.prepare('SELECT * FROM compass_application_record WHERE id=? AND app_id=? AND owner=?').get(rowId,appId,owner));
  }
  function deleteRecord(owner,appId,recordId) {
    getApplication(owner,appId);
    const result=database.prepare('DELETE FROM compass_application_record WHERE id=? AND app_id=? AND owner=?').run(recordId,appId,owner);
    if(!result.changes)fail(404,'not_found');
  }
  function publish(owner,project) {
    const document=validateEditableHtml(project?.revisions?.at(-1)?.render?.html);
    if(!document.ok)fail(400,'invalid_project_html');
    database.prepare('DELETE FROM compass_publication WHERE revoked_at IS NOT NULL AND revoked_at<?').run(new Date(Date.now()-7*86400000).toISOString());
    if(database.prepare('SELECT count(*) AS n FROM compass_publication WHERE owner=?').get(owner).n>=50)fail(429,'publication_retention_limit');
    if(database.prepare('SELECT count(*) AS n FROM compass_publication WHERE owner=? AND revoked_at IS NULL').get(owner).n>=12)fail(409,'publication_limit');
    const publicationId=id('page');
    database.prepare('INSERT INTO compass_publication VALUES(?,?,?,?,?,?,NULL)').run(publicationId,owner,project.id,project.name,document.html,stamp());
    return {id:publicationId,title:project.name,path:'/published/'+publicationId,createdAt:stamp()};
  }
  function publications(owner) {
    return database.prepare('SELECT id,title,created_at FROM compass_publication WHERE owner=? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 12').all(owner)
      .map(row=>({id:row.id,title:row.title,path:'/published/'+row.id,createdAt:row.created_at}));
  }
  function revokePublication(owner,publicationId) {
    const result=database.prepare('UPDATE compass_publication SET revoked_at=? WHERE id=? AND owner=? AND revoked_at IS NULL').run(stamp(),publicationId,owner);
    if(!result.changes)fail(404,'not_found');
  }
  function publicPage(publicationId) {
    return database.prepare('SELECT html FROM compass_publication WHERE id=? AND revoked_at IS NULL').get(publicationId)?.html||null;
  }
  function event(owner,category,code) {
    if(!/^[a-z_]{1,40}$/.test(category)||!/^[a-z_]{1,60}$/.test(code))return;
    database.prepare('DELETE FROM compass_system_event WHERE id IN (SELECT id FROM compass_system_event ORDER BY created_at DESC LIMIT -1 OFFSET 4999)').run();
    database.prepare('INSERT INTO compass_system_event VALUES(?,?,?,?,?)').run(id('event'),owner||null,category,code,stamp());
    database.prepare('DELETE FROM compass_system_event WHERE created_at<?').run(new Date(Date.now()-7*86400000).toISOString());
  }
  function overview() {
    const count=table=>database.prepare('SELECT count(*) AS n FROM '+table).get().n;
    const tokens=['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens','reasoningTokens','totalTokens'];
    const columns=tokens.flatMap(key=>[
      `SUM(CASE WHEN json_type(details,'$.${key}')='integer' THEN json_extract(details,'$.${key}')*1.0 ELSE NULL END) AS ${key}`,
      `SUM(CASE WHEN json_type(details,'$.${key}')='integer' THEN 0 ELSE 1 END) AS ${key}UnknownAttempts`
    ]).join(',');
    const aiUsage=database.prepare(`SELECT json_extract(details,'$.provider') AS provider,COALESCE(json_extract(details,'$.reportedModel'),json_extract(details,'$.model'),'unknown') AS model,COUNT(*) AS attempts,
      SUM(CASE WHEN json_extract(details,'$.usageComplete')=0 THEN 1 ELSE 0 END) AS incompleteUsageAttempts,${columns}
      FROM compass_usage WHERE created_at>=? GROUP BY provider,model ORDER BY attempts DESC LIMIT 40`).all(new Date(Date.now()-7*86400000).toISOString()).map(row=>{
        for(const key of tokens){
          const sum=row[key];row[key+'KnownSum']=Number.isSafeInteger(sum)?sum:null;
          if(sum!==null&&!Number.isSafeInteger(sum))row[key+'Overflow']=true;
          // A partial sum is useful operationally but is never a complete
          // token total when another attempt omitted/finalized no counter.
          if(row[key+'UnknownAttempts']>0||row.incompleteUsageAttempts>0||row[key+'Overflow'])row[key]=null;
        }return {...row};
      });
    return {applications:count('compass_application'),records:count('compass_application_record'),savedPages:count('compass_project'),
      activePublications:database.prepare('SELECT count(*) AS n FROM compass_publication WHERE revoked_at IS NULL').get().n,
      aiUsage,usageWindowDays:7,failedOperations:database.prepare("SELECT count(*) AS n FROM compass_operation WHERE status='failed'").get().n,
      applicationErrors:database.prepare("SELECT count(*) AS n FROM compass_system_event WHERE category='application' AND code='build_failed'").get().n,
      operations:database.prepare('SELECT status,count(*) AS count FROM compass_operation GROUP BY status').all(),
      events:database.prepare('SELECT category,code,MAX(created_at) AS at,count(*) AS count FROM compass_system_event GROUP BY category,code ORDER BY at DESC LIMIT 40').all()};
  }
  return {atomic,listAssets,getAsset,saveAsset,deleteAsset,activeAssets,assertApplicationCapacity,getApplication,listApplications,createApplication,updateApplication,deleteApplication,revisions,restore,listRecords,saveRecord,deleteRecord,publish,publications,revokePublication,publicPage,event,overview};
}
