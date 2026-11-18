import {createHash} from 'node:crypto'
import {TEMPLATE_CATALOG,getTemplate} from './catalog.mjs'
import {renderTemplatePreview,templatePreviewScript} from './preview.mjs'

// Read-only browsing is independent of identity, model providers and billing.
// Prices, commercial terms and paid delivery must be approved before checkout.
export function handleTemplateRequest(req,res,url) {
  const path=url.pathname
  if(path!=='/api/templates' && !path.startsWith('/api/templates/'))return false
  const json=(status,body,headers={})=>{
    const bytes=Buffer.from(JSON.stringify(body))
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Content-Length':bytes.length,...headers})
    res.end(req.method==='HEAD'?undefined:bytes)
    return true
  }
  const readOnly=()=>['GET','HEAD'].includes(req.method)
  if(path==='/api/templates') {
    if(!readOnly())return json(405,{error:'method_not_allowed'},{Allow:'GET, HEAD'})
    return json(200,{templates:TEMPLATE_CATALOG,purchasesEnabled:false})
  }
  const match=path.match(/^\/api\/templates\/([a-z][a-z0-9-]{0,39})(?:\/(preview|checkout))?$/)
  const template=match && getTemplate(match[1])
  if(!template)return json(404,{error:'template_not_found'})
  if(match[2]==='checkout') {
    if(req.method!=='POST')return json(405,{error:'method_not_allowed'},{Allow:'POST'})
    // This remains closed even if other COMPASS billing settings change.
    // No price supplied by a client can create a charge or grant a download.
    return json(503,{error:'purchases_not_enabled',message:'Purchases open soon.'})
  }
  if(!readOnly())return json(405,{error:'method_not_allowed'},{Allow:'GET, HEAD'})
  if(!match[2])return json(200,{template,purchasesEnabled:false})
  const html=renderTemplatePreview(template.id)
  if(typeof html!=='string')return json(404,{error:'template_not_found'})
  const script=templatePreviewScript(template.id)
  const policy=script?`'sha256-${createHash('sha256').update(script).digest('base64')}'`:"'none'"
  const bytes=Buffer.from(html),etag='"'+createHash('sha256').update(bytes).digest('hex')+'"'
  res.setHeader('Content-Security-Policy',`default-src 'none'; script-src ${policy}; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'`)
  res.setHeader('X-Frame-Options','SAMEORIGIN')
  res.setHeader('X-Robots-Tag','noindex,nofollow')
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()')
  const headers={'Content-Type':'text/html; charset=utf-8','Cache-Control':'public, max-age=0, must-revalidate',ETag:etag}
  if(req.headers['if-none-match']===etag){res.writeHead(304,headers);res.end();return true}
  res.writeHead(200,{...headers,'Content-Length':bytes.length})
  res.end(req.method==='HEAD'?undefined:bytes)
  return true
}
