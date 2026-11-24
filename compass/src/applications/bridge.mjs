import {validateApplicationRecord} from '../../generation/templates/lib/schema.mjs'
import {crmEntities,parseCrmRecord} from '../../generation/crm/template/lib/records.mjs'
const ID = /^[A-Za-z0-9_-]{1,80}$/
const REQUEST_ID = /^[A-Za-z0-9_-]{1,120}$/
const plain = value => value && typeof value === 'object' && !Array.isArray(value)

export function validateCrmBridgeMessage(value) {
  if (!plain(value) || value.type!=='compass-crm-request' || typeof value.requestId!=='string' || !REQUEST_ID.test(value.requestId) ||
      !crmEntities.includes(value.entity) || !['list','save','delete'].includes(value.operation) ||
      Object.keys(value).some(key=>!['type','requestId','operation','entity','id','data','version'].includes(key))) return null
  const {requestId,operation,entity,id,version}=value
  if (id!==undefined && (typeof id!=='string' || !/^crm_[a-z0-9-]{36}$/.test(id) || !Number.isSafeInteger(version) || version<1)) return null
  if (id===undefined && version!==undefined) return null
  if (operation==='save') {
    const checked=parseCrmRecord(entity,value.data)
    if (!checked.ok) return null
    return {requestId,entity,id,version,action:id?'update':'create',data:checked.data}
  }
  if (value.data!==undefined || (operation==='list' ? id!==undefined : id===undefined)) return null
  return {requestId,entity,id,version,action:operation}
}

export function validateApplicationBridgeMessage(value,manifest) {
  if (!plain(value) || value.type !== 'compass-app-request' || !REQUEST_ID.test(value.requestId || '') || !['list','create','update','delete','asset'].includes(value.action)) return null
  if (Object.keys(value).some(key => !['type','requestId','action','id','data','assetId'].includes(key))) return null
  try {if (JSON.stringify(value).length > 20000) return null} catch {return null}
  if(value.action==='asset'){
    if(!ID.test(value.assetId || '') || !Object.values(manifest?.assets || {}).includes(value.assetId) || value.id!==undefined || value.data!==undefined)return null
    return {requestId:value.requestId,action:'asset',assetId:value.assetId}
  }
  if(value.assetId!==undefined)return null
  if (['update','delete'].includes(value.action) && !ID.test(value.id || '')) return null
  if (['create','update'].includes(value.action)) {
    if (value.action === 'create' && value.id !== undefined) return null
    const checked = validateApplicationRecord(manifest,value.data)
    if (!checked.ok) return null
    return {requestId:value.requestId,action:value.action,...(value.action === 'update' ? {id:value.id} : {}),data:checked.value}
  }
  if (value.data !== undefined || (value.action === 'list' && value.id !== undefined)) return null
  return {requestId:value.requestId,action:value.action,...(value.action === 'delete' ? {id:value.id} : {})}
}
