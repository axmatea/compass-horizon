import test from 'node:test'
import assert from 'node:assert/strict'
import {once} from 'node:events'
import {createHash} from 'node:crypto'
import {createCompassServer} from '../server.mjs'
import {TEMPLATE_CATALOG} from '../marketplace/catalog.mjs'
import {templatePreviewScript} from '../marketplace/preview.mjs'

async function fixture(t,env={}) {
  let calls=0
  const app=createCompassServer({env,fetchImpl:async()=>{calls++;throw Error('External requests are forbidden while browsing')}})
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening')
  t.after(()=>app.close())
  return {origin:'http://127.0.0.1:'+app.server.address().port,get calls(){return calls}}
}

test('template catalog is read-only, real, and independent of account/model/billing providers',async t=>{
  const f=await fixture(t),response=await fetch(f.origin+'/api/templates')
  assert.equal(response.status,200);assert.equal(response.headers.get('set-cookie'),null)
  assert.deepEqual(await response.json(),{templates:TEMPLATE_CATALOG,purchasesEnabled:false})
  for(const item of TEMPLATE_CATALOG) {
    const detail=await fetch(f.origin+'/api/templates/'+item.id)
    assert.equal(detail.status,200)
    assert.deepEqual(await detail.json(),{template:item,purchasesEnabled:false})
  }
  assert.equal(f.calls,0)
})

test('all public previews ship exact trusted script hashes and block network, forms and external framing',async t=>{
  const f=await fixture(t)
  for(const item of TEMPLATE_CATALOG) {
    const response=await fetch(f.origin+'/api/templates/'+item.id+'/preview')
    assert.equal(response.status,200,item.id)
    assert.match(response.headers.get('content-type'),/^text\/html/)
    assert.equal(response.headers.get('x-frame-options'),'SAMEORIGIN')
    assert.equal(response.headers.get('set-cookie'),null)
    assert.equal(response.headers.get('permissions-policy'),'camera=(), microphone=(), geolocation=()')
    const body=await response.text(),csp=response.headers.get('content-security-policy')
    assert.match(body,/<!doctype html>/i)
    assert.match(csp,/connect-src 'none'; form-action 'none'; base-uri 'none'/)
    assert.match(csp,/frame-ancestors 'self'/)
    const script=templatePreviewScript(item.id)
    const scripts=[...body.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(match=>match[1])
    if(script) {
      assert.deepEqual(scripts,[script],item.id)
      assert.ok(csp.includes("script-src 'sha256-"+createHash('sha256').update(script).digest('base64')+"'"))
    } else {assert.deepEqual(scripts,[]);assert.match(csp,/script-src 'none'/)}
    const head=await fetch(response.url,{method:'HEAD'})
    assert.equal(head.status,200);assert.equal(await head.text(),'')
    assert.equal(Number(head.headers.get('content-length')),Buffer.byteLength(body))
    const cached=await fetch(response.url,{headers:{'If-None-Match':response.headers.get('etag')}})
    assert.equal(cached.status,304);assert.equal(await cached.text(),'')
  }
  assert.equal(f.calls,0)
})

test('checkout remains closed to supplied prices, payment flags and external origins',async t=>{
  const f=await fixture(t,{COMPASS_BILLING_MODE:'live',COMPASS_BILLING_ENABLED:'true'})
  for(const item of TEMPLATE_CATALOG) {
    const response=await fetch(f.origin+'/api/templates/'+item.id+'/checkout',{method:'POST',headers:{'content-type':'application/json',origin:'https://other.invalid'},body:JSON.stringify({price:1,paid:true,format:'ios-android',success_url:'https://other.invalid'})})
    assert.equal(response.status,503)
    assert.deepEqual(await response.json(),{error:'purchases_not_enabled',message:'Purchases open soon.'})
    assert.equal(response.headers.get('location'),null)
    assert.equal(response.headers.get('set-cookie'),null)
  }
  assert.equal(f.calls,0)
})

test('source downloads, unknown products and method changes cannot bypass the public catalog boundary',async t=>{
  const f=await fixture(t)
  for(const path of ['/api/templates/unknown','/api/templates/__proto__/preview','/api/templates/atlas/download','/api/templates/pulse/source?paid=true','/api/templates/pulse/bundle','/api/templates/atlas%2Fpreview','/marketplace/templates/pulse/App.jsx']) {
    assert.equal((await fetch(f.origin+path)).status,404,path)
  }
  for(const path of ['/api/templates','/api/templates/atlas','/api/templates/atlas/preview']) {
    const response=await fetch(f.origin+path,{method:'POST'})
    assert.equal(response.status,405);assert.equal(response.headers.get('allow'),'GET, HEAD')
  }
  const checkout=await fetch(f.origin+'/api/templates/atlas/checkout')
  assert.equal(checkout.status,405);assert.equal(checkout.headers.get('allow'),'POST')
  const legacy=await fetch(f.origin+'/?start=app',{redirect:'manual'})
  assert.equal(legacy.status,302);assert.equal(legacy.headers.get('location'),'/demo?start=app')
  assert.equal(f.calls,0)
})
