import {validateApplicationRecord} from '../../generation/templates/lib/schema.mjs'
const ID = /^[A-Za-z0-9_-]{1,80}$/
const REQUEST_ID = /^[A-Za-z0-9_-]{1,120}$/
const plain = value => value && typeof value === 'object' && !Array.isArray(value)

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
