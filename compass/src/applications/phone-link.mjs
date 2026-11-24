const key='compass.phone-project.v1'
const maxAge=15*60*1000
const projectId=/^app_[a-zA-Z0-9_-]{1,76}$/

export function phoneProjectHref(origin,id) {
  if (typeof id!=='string'||!projectId.test(id)) throw Error('Invalid application.')
  const url=new URL('/workspace',origin)
  if (url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw Error('Phone preview needs HTTPS.')
  url.hash='phone='+id
  return url.href
}

export function rememberPhoneProject(hash,{storage,now=Date.now}={}) {
  if (typeof hash!=='string'||!hash.startsWith('#phone=')) return false
  const id=hash.slice(7)
  if (!projectId.test(id)) return false
  try {storage?.setItem(key,JSON.stringify({id,at:now()}));return Boolean(storage)} catch {return false}
}

export function pendingPhoneProject({storage,now=Date.now,consume=false}={}) {
  try {
    const raw=storage?.getItem(key)
    if (!raw) return null
    if (consume) storage.removeItem(key)
    const {id,at}=raw.length<160?JSON.parse(raw):{}
    const elapsed=now()-at
    if (typeof id==='string'&&projectId.test(id)&&Number.isSafeInteger(at)&&elapsed>=0&&elapsed<maxAge) return id
    storage.removeItem(key)
  } catch { /* The authenticated workspace remains usable without storage. */ }
  return null
}

export async function drawPhoneProjectQr(canvas,href) {
  const {default:qr}=await import('qrcode')
  await qr.toCanvas(canvas,href,{errorCorrectionLevel:'M',margin:3,width:232})
}
