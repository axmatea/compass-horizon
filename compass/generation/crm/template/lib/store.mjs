import {randomUUID} from 'node:crypto';
import {crmEntities, crmReferences, parseCrmRecord} from './records.mjs';

const recordId = /^crm_[a-z0-9-]{36}$/;
const capacity = 160;
const fail = (status, code) => { throw Object.assign(new Error(code), {status, code}); };
const publicRecord = row => ({id:row.id, data:JSON.parse(row.data), version:row.version, updatedAt:row.updated_at});

export function createCrmStore(database, {getApplication, atomic}) {
  database.exec(`CREATE TABLE IF NOT EXISTS compass_crm_record (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, app_id TEXT NOT NULL, entity TEXT NOT NULL,
    data TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS compass_crm_record_scope ON compass_crm_record(owner,app_id,entity,updated_at)`);
  const rows=database.prepare('SELECT id,data,version,updated_at FROM compass_crm_record WHERE owner=? AND app_id=? AND entity=? ORDER BY updated_at DESC,id');
  const one=database.prepare('SELECT id,data,version,updated_at FROM compass_crm_record WHERE owner=? AND app_id=? AND entity=? AND id=?');
  const count=database.prepare('SELECT count(*) AS n FROM compass_crm_record WHERE owner=? AND app_id=? AND entity=?');
  const insert=database.prepare('INSERT INTO compass_crm_record(id,owner,app_id,entity,data,version,updated_at) VALUES(?,?,?,?,?,1,?)');
  const update=database.prepare('UPDATE compass_crm_record SET data=?,version=version+1,updated_at=? WHERE owner=? AND app_id=? AND entity=? AND id=? AND version=?');
  const remove=database.prepare('DELETE FROM compass_crm_record WHERE owner=? AND app_id=? AND entity=? AND id=? AND version=?');
  const removeAll=database.prepare('DELETE FROM compass_crm_record WHERE owner=? AND app_id=?');
  const money=database.prepare("SELECT 1 FROM compass_crm_record WHERE owner=? AND app_id=? AND entity IN ('deals','proposals') LIMIT 1");

  function verify(owner,appId,entity,appVersion) {
    const current=getApplication(owner,appId);
    if (!current.manifest.crm || !crmEntities.includes(entity)) fail(404,'not_found');
    if (current.version!==appVersion) fail(409,'version_conflict');
  }
  function get(owner,appId,entity,id) {
    if (typeof id!=='string' || !recordId.test(id)) fail(404,'not_found');
    const record=one.get(owner,appId,entity,id);
    if (!record) fail(404,'not_found');
    return publicRecord(record);
  }
  function list(owner,appId,entity,appVersion) {
    verify(owner,appId,entity,appVersion);
    return rows.all(owner,appId,entity).map(publicRecord);
  }
  function compareRecord(owner,appId,entity,id,version) {
    if (!Number.isSafeInteger(version) || version<1) fail(400,'record_version_required');
    if (get(owner,appId,entity,id).version!==version) fail(409,'record_version_conflict');
  }
  function save(owner,appId,entity,appVersion,input,id,version) {
    return atomic(()=>{
      verify(owner,appId,entity,appVersion);
      if (id!==undefined) compareRecord(owner,appId,entity,id,version);
      const checked=parseCrmRecord(entity,input);
      if (!checked.ok) fail(400,checked.error);
      for (const ref of crmReferences(entity,checked.data)) {
        if (!one.get(owner,appId,ref.entity,ref.id)) fail(409,'crm_reference_missing');
      }
      const payload=JSON.stringify(checked.data), at=new Date().toISOString();
      if (id===undefined) {
        if (count.get(owner,appId,entity).n>=capacity) fail(409,'crm_record_limit');
        id='crm_'+randomUUID();
        insert.run(id,owner,appId,entity,payload,at);
      } else {
        if (!update.run(payload,at,owner,appId,entity,id,version).changes) fail(409,'record_version_conflict');
      }
      return get(owner,appId,entity,id);
    });
  }
  function deleteRecord(owner,appId,entity,appVersion,id,version) {
    return atomic(()=>{
      verify(owner,appId,entity,appVersion);
      compareRecord(owner,appId,entity,id,version);
      const dependants=entity==='clients'?['contacts','deals','tasks']:entity==='deals'?['proposals']:[];
      for (const dependant of dependants) {
        const linked=rows.all(owner,appId,dependant).some(row=>crmReferences(dependant,JSON.parse(row.data)).some(ref=>ref.entity===entity&&ref.id===id));
        if (linked) fail(409,'crm_record_in_use');
      }
      if (!remove.run(owner,appId,entity,id,version).changes) fail(409,'record_version_conflict');
    });
  }
  return {list,save,deleteRecord,hasRevenueRecords:(owner,appId)=>Boolean(money.get(owner,appId)),removeAll:(owner,appId)=>removeAll.run(owner,appId)};
}
