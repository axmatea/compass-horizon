import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import {resolveCreateEntry} from '../src/create/flow.mjs'

const source=(await readFile(new URL('../src/site/public-navigation.mjs',import.meta.url),'utf8')).replace(/^import .+\n/gm,'').replace('export function','function')
function fixture(pathname) {
  const trigger={hidden:true},account={hidden:false,href:'/create?view=account'},mounted=[]
  const doc={querySelectorAll:selector=>selector==='[data-public-account]'?[account]:selector==='[data-platform-tour-trigger]'?[trigger]:[]}
  const context={mountPlatformTour(){throw Error('Expected an explicit mount seam')}}
  vm.runInNewContext(source+';globalThis.mount=mountPublicNavigation',context)
  let destroyed=0
  const api=context.mount({document:doc,pathname,mountTour:options=>{mounted.push(options);return {destroy(){destroyed++}}}})
  return {trigger,account,mounted,api,get destroyed(){return destroyed}}
}

test('public tour launch mounts without changing account navigation or project state',()=>{
  const ui=fixture('/demo')
  assert.equal(ui.trigger.hidden,false)
  assert.equal(ui.account.hidden,false)
  assert.equal(ui.account.href,'/create?view=account')
  assert.equal(ui.mounted.length,1)
  assert.equal(ui.mounted[0].trigger,ui.trigger)
  assert.deepEqual(Object.keys(ui.mounted[0]),['trigger'])
  ui.api.destroy();assert.equal(ui.destroyed,1)
})

test('authenticated workspace leaves the sidebar in charge of its tour and account entry',()=>{
  for(const pathname of ['/workspace','/workspace/']){
    const ui=fixture(pathname)
    assert.equal(ui.trigger.hidden,true)
    assert.equal(ui.account.hidden,true)
    assert.equal(ui.mounted.length,0)
    ui.api.destroy();assert.equal(ui.destroyed,0)
  }
})

test('explicit public sign-in keeps the account route even when a project draft exists',()=>{
  const entry=new URL(fixture('/demo').account.href,'https://mycompass.world')
  assert.deepEqual(resolveCreateEntry({search:entry.search,hasDraft:true,config:{enabled:true,configured:true},signedIn:false}),{mode:'account',step:'auth'})
  assert.deepEqual(resolveCreateEntry({search:entry.search,hasDraft:true,config:{enabled:true,configured:true},signedIn:true}),{mode:'account',step:'manage'})
})

test('every public page has a labeled tour launch and returning users have a sign-in entry',async()=>{
  for(const page of ['index','demo','studio','plan','create','privacy']){
    const html=await readFile(new URL('../'+page+'.html',import.meta.url),'utf8')
    assert.match(html,/<button[^>]*type="button"[^>]*data-platform-tour-trigger[^>]*hidden>Platform Tour<\/button>/,page)
    assert.equal((html.match(/src="\/src\/site\/public-navigation\.mjs"/g) || []).length,1,page)
    assert.match(html,/href="\/create\?view=account"/,page)
  }
  for(const page of ['index','demo']){
    const html=await readFile(new URL('../'+page+'.html',import.meta.url),'utf8')
    assert.match(html,/href="\/create\?app=1"/,page)
    assert.doesNotMatch(html,/compass-web-preview-production/,page)
  }
})
