import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import {webcrypto} from 'node:crypto'
import {resolveObjectURL} from 'node:buffer'
import {once} from 'node:events'
import {createCompassServer} from '../server.mjs'
import {createApplicationManifest} from '../generation/manifest.mjs'
import {validateApplicationManifest,MOBILE_PLATFORMS} from '../generation/templates/lib/schema.mjs'
import {validateApplicationBridgeMessage} from '../src/applications/bridge.mjs'
import {applicationResultOutcome,requireApplicationVersion} from '../src/applications/result.mjs'
import {mountPaneLayout} from '../src/builder/pane-layout.mjs'

const contextClient=(await readFile(new URL('../src/applications/project-context.mjs',import.meta.url),'utf8')).replace(/^export /gm,'')
const client=(await readFile(new URL('../src/applications/workspace.mjs',import.meta.url),'utf8')).replace(/^import .+\n/gm,'').replace(/^export \{.+\}.*\n/gm,'').replace('export async function','async function')
class Node {
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.value='';this.dataset={};this.attributes={};this.children=[];this.listeners={};this.hidden=false;this.disabled=false;this._text='';this.style={setProperty(){}};const classes=new Set();this.classList={add:(name)=>classes.add(name),remove:name=>classes.delete(name),toggle:(name,value)=>value?classes.add(name):classes.delete(name)};if(tag==='iframe')this.contentWindow={postMessage:message=>this.messages.push(message)};this.messages=[]}
  set textContent(value){this._text=String(value);this.children=[]}get textContent(){return this._text+this.children.map(child=>child.textContent).join('')}
  get firstChild(){return this.children[0]}get lastChild(){return this.children.at(-1)}
  append(...nodes){this.children.push(...nodes);if(this.tagName==='SELECT' && !this.value)this.value=nodes.find(node=>node.value)?.value || ''}
  prepend(...nodes){this.children.unshift(...nodes)}replaceChildren(...nodes){this._text='';this.children=nodes}remove(){this.removed=true}
  setAttribute(key,value){this.attributes[key]=String(value)}getAttribute(key){return this.attributes[key]}
  addEventListener(type,fn){(this.listeners[type] ||= []).push(fn)}removeEventListener(type,fn){this.listeners[type]=(this.listeners[type] || []).filter(value=>value!==fn)}
  async fire(type,event={}){for(const handler of this.listeners[type] || [])await handler({target:this,preventDefault(){this.defaultPrevented=true},...event})}
  click(){if(!this.disabled)void this.fire('click')}focus(){this.focused=true}getBoundingClientRect(){return {width:1300}}
  all(){return this.children.flatMap(node=>[node,...node.all()])}
  querySelectorAll(selector){if(selector==='[data-resize-pane]')return this.handles || [];const all=this.all();if(selector==='[data-restore-version]')return all.filter(node=>node.dataset.restoreVersion!=null);if(selector==='[data-asset-selected]')return all.filter(node=>node.dataset.assetSelected!=null);return []}
}
const tick=async()=>{for(let n=0;n<8;n++)await new Promise(resolve=>setImmediate(resolve))}
async function fixture({confirm=()=>true,open=true,useContext=false}={}){
  const nodes=new Map(),container=new Node(),body=new Node(),layout=new Node(),events=new Map(),calls=[]
  layout.handles=['projects','conversation'].map(name=>{const node=new Node();node.dataset.resizePane=name;return node})
  Object.defineProperty(container,'innerHTML',{set(value){for(const match of value.matchAll(/<([a-z]+)([^>]*\bdata-aw="([^"]+)"[^>]*)>/g)){const node=new Node(match[1]);node.hidden=/\bhidden\b/.test(match[2]);nodes.set(match[3],node)}nodes.get('composer-label').append(new Node('span'));nodes.get('design-form').elements=Object.fromEntries(['mode','accent','font','density'].map(key=>[key,{value:''}]))}})
  container.querySelector=selector=>selector==='.aw-layout'?layout:nodes.get(selector.match(/data-aw="([^"]+)"/)?.[1])
  container.querySelectorAll=selector=>selector==='button,select,textarea,input'?[...nodes.values(),...container.all()].filter(node=>['BUTTON','SELECT','TEXTAREA','INPUT'].includes(node.tagName)):[...nodes.values()].flatMap(node=>node.querySelectorAll(selector))
  let app={id:'app_fixture',version:1,source:'prepared',manifest:createApplicationManifest('A CRM called Forma')},failManifest=false,failPlanApply='',planError=null
  let revisions=[{version:1,manifest:structuredClone(app.manifest),changes:[]}],assets=[]
  let projectContext={version:0,notes:{},decisions:[],tasks:[],recentChanges:[]}
  let holdContext
  const contextConflict=()=>Object.assign(Error('Context conflict'),{code:'project_context_conflict'})
  const request=async(path,options={})=>{
    calls.push({path,...options});const method=options.method || 'GET'
    if(path.endsWith('/context')){
      assert.equal(path,'apps/app_fixture/context')
      if(method==='GET'){
        const saved=structuredClone(projectContext)
        if(holdContext)await holdContext
        return {context:saved}
      }
      const {version,notes,action,text,id,status}=JSON.parse(options.body)
      if(version!==projectContext.version)throw contextConflict()
      if(method==='PUT')projectContext.notes=notes
      if(action==='decision' || action==='supersede'){
        const decision={id:'decision_'+projectContext.version,text,supersededBy:null}
        if(action==='supersede')projectContext.decisions.find(item=>item.id===id).supersededBy=decision.id
        projectContext.decisions.push(decision)
      }
      if(action==='task')projectContext.tasks.push({id:'task_'+projectContext.version,text,status:'active'})
      if(action==='task-status')projectContext.tasks.find(item=>item.id===id).status=status
      projectContext.version++
      return {context:structuredClone(projectContext)}
    }
    if(path.endsWith('/plan')){
      if(planError)throw planError
      const {text,version=null}=JSON.parse(options.body)
      return {manifest:{...app.manifest,title:text},source:'model',modelUsed:true,baseVersion:version,...(useContext && version ? {contextVersion:projectContext.version} : {})}
    }
    if(path.endsWith('/build-plan')){
      if(failPlanApply)throw Error(failPlanApply)
      const {manifest,version,contextVersion}=JSON.parse(options.body)
      if(useContext && version && contextVersion!==projectContext.version)throw contextConflict()
      if(path!=='apps/build-plan')assert.equal(version,app.version)
      app={...app,version:version ? version+1 : 1,manifest:structuredClone(manifest)}
      revisions.push({version:app.version,manifest:structuredClone(app.manifest),changes:[]})
      return {application:structuredClone(app),source:'prepared',modelUsed:false,changed:true}
    }
    if(path==='apps')return {applications:[structuredClone(app)]}
    if(path==='apps/app_fixture' && method==='GET')return {application:structuredClone(app)}
    if(path.endsWith('/revisions'))return {revisions:structuredClone(revisions)}
    if(path.endsWith('/assets') && method==='GET')return {assets:structuredClone(assets),quota:{applicationBytes:assets.reduce((sum,asset)=>sum+asset.bytes,0)}}
    if(path.endsWith('/manifest')){if(failManifest)throw Error('Network unavailable. Edits kept.');const data=JSON.parse(options.body);assert.equal(data.version,app.version);app={...app,version:app.version+1,manifest:structuredClone(data.manifest)};revisions.push({version:app.version,manifest:structuredClone(app.manifest),changes:[{path:'manifest.json',type:'modified',sha256:'f'.repeat(64)}]});return {application:structuredClone(app),changed:true}}
    if(path.endsWith('/restore')){const {version}=JSON.parse(options.body);app={...app,version:app.version+1,manifest:structuredClone(revisions.find(item=>item.version===version).manifest)};revisions.push({version:app.version,manifest:structuredClone(app.manifest),changes:[]});return {application:structuredClone(app),changed:true}}
    if(path.endsWith('/records'))return {records:[]}
    throw Error('Unexpected request '+method+' '+path)
  }
  const raw=async(path,options={})=>{
    calls.push({path,...options,raw:true});const headers={'X-Compass-App-Version':String(app.version)}
    if(path.endsWith('/preview'))return new Response('<!doctype html><p>'+app.manifest.title+'</p>',{headers})
    if(path.endsWith('/source'))return new Response(JSON.stringify({manifest:app.manifest,files:[{path:'manifest.json',content:JSON.stringify(app.manifest,null,2)},{path:'server.mjs',content:'// reviewed runtime'},{path:'assets/image.png',content:'eA==',encoding:'base64',mime:'image/png'}]}),{headers})
    if(path.endsWith('/assets') && options.method==='POST'){assert.equal(options.headers['x-compass-app-version'],String(app.version));assert.equal(options.headers['content-type'],'image/png');assets.push({id:'asset_fixture',mime:'image/png',bytes:options.body.size,width:1,height:1});app={...app,version:app.version+1};revisions.push({version:app.version,manifest:structuredClone(app.manifest),changes:[]});return new Response(JSON.stringify({asset:assets.at(-1),application:app,changed:true}),{headers})}
    if(path.endsWith('/assets/asset_fixture'))return new Response(new Blob(['image'],{type:'image/png'}),{headers})
    throw Error('Unexpected raw '+path)
  }
  const context={console,document:{body,createElement:tag=>new Node(tag)},window:{addEventListener:(type,fn)=>events.set(type,fn),removeEventListener(){}},crypto:webcrypto,URL,Blob,Response,TextEncoder,AbortController,setTimeout,atob,structuredClone,confirm,navigator:{clipboard:{writeText:async()=>{}}},createDictation:()=>null,draftCanAutoBuild:()=>false,disarmDraft(){},validateApplicationManifest,MOBILE_PLATFORMS,validateApplicationBridgeMessage,applicationResultOutcome,requireApplicationVersion,mountPaneLayout}
  vm.runInNewContext(contextClient+'\n'+client+';globalThis.mount=mountApplicationWorkspace',context)
  const api=await context.mount({container,request,requestRaw:raw,userId:'owner_fixture'});if(open)await api.open(app.id)
  return {api,nodes,calls,events,container,get app(){return app},failManifest(value=true){failManifest=value},failPlanApply(message){failPlanApply=message},failPlanRequest(error){planError=error},updateContext(data){projectContext={...projectContext,...data,version:projectContext.version+1}},holdContext(){let done;holdContext=new Promise(resolve=>{done=resolve});return done},tick}
}

test('new reference planning cannot leave an open application or its pending work without an explicit choice',async()=>{
  const prompts=[],ui=await fixture({confirm:message=>{prompts.push(message);return false}})
  const original=ui.api.currentApplication,before=ui.calls.length
  ui.nodes.get('input').value='Keep this unsent change'
  assert.equal(ui.api.canLeave(),false)
  assert.equal(ui.api.currentApplication,original)
  assert.equal(ui.nodes.get('input').value,'Keep this unsent change')
  assert.equal(ui.calls.length,before);assert.equal(prompts.length,1)
  assert.match(prompts[0],/records are kept/)
})

test('planning a new application saves only after an explicit build of the edited manifest',async()=>{
  const ui=await fixture({open:false})
  const node=key=>ui.nodes.get(key)
  node('input').value='Project tracker for Forma'
  await node('request-plan').fire('click');await tick()
  assert.equal(ui.api.currentApplication,null)
  assert.deepEqual(ui.calls.filter(call=>call.method==='POST').map(call=>call.path),['apps/plan'])
  assert.equal(node('plan').hidden,false)
  assert.equal(node('plan-source').textContent,'AI proposal')
  assert.match(node('plan-fields').textContent,/Name/)
  const manifest=JSON.parse(node('plan-editor').value)
  node('plan-editor').value='{invalid'
  await node('plan-editor').fire('input')
  assert.equal(node('apply-plan').disabled,true)
  assert.equal(node('plan-editor').getAttribute('aria-invalid'),'true')
  manifest.title='Forma Studio'
  node('plan-editor').value=JSON.stringify(manifest)
  await node('plan-editor').fire('input')
  assert.equal(node('plan-title').textContent,'Forma Studio')
  assert.equal(node('apply-plan').disabled,false)
  node('input').value='An unrelated next instruction'
  await node('apply-plan').fire('click');await tick()
  assert.equal(ui.api.currentApplication.manifest.title,'Forma Studio')
  const saved=ui.calls.find(call=>call.path==='apps/build-plan')
  assert.deepEqual(JSON.parse(saved.body),{text:'Project tracker for Forma',manifest})
  assert.equal(node('plan').hidden,true)
  assert.equal(node('input').value,'An unrelated next instruction')
  ui.api.destroy()
})

test('reviewing and retrying an update keeps its base revision, preview and exact operation receipt',async()=>{
  const ui=await fixture({confirm:()=>false})
  const node=key=>ui.nodes.get(key)
  const previousFrame=node('preview').children.at(-1)
  node('input').value='Forma Studio'
  await node('request-plan').fire('click');await tick()
  assert.equal(ui.api.currentApplication.version,1)
  assert.equal(node('preview').children.at(-1),previousFrame)
  assert.deepEqual(JSON.parse(ui.calls.find(call=>call.path.endsWith('/plan')).body),{text:'Forma Studio',version:1})
  await node('new').fire('click');await tick()
  assert.equal(node('plan').hidden,false)
  assert.equal(ui.api.currentApplication.version,1)
  assert.equal(ui.api.canLeave(),false)
  ui.failPlanApply('Connection interrupted.')
  await node('apply-plan').fire('click');await tick()
  assert.equal(node('preview').children.at(-1),previousFrame)
  assert.equal(node('apply-plan').disabled,false)
  ui.failPlanApply('The project changed. Your edits are kept.')
  await node('apply-plan').fire('click');await tick()
  const attempts=ui.calls.filter(call=>call.path.endsWith('/build-plan'))
  assert.equal(attempts.length,2)
  assert.equal(attempts[0].headers['idempotency-key'],attempts[1].headers['idempotency-key'])
  assert.equal(JSON.parse(attempts[0].body).version,1)
  assert.equal(node('apply-plan').disabled,true)
  assert.equal(node('plan').hidden,false)
  assert.match(node('plan-warning').textContent,/project changed/)
  assert.match(node('plan-editor').value,/Forma Studio/)
  assert.equal(node('preview').children.at(-1),previousFrame)
  ui.api.destroy()
})

test('plan retries reuse receipts after connection errors and replace terminally failed receipts',async()=>{
  const ui=await fixture({open:false})
  const node=key=>ui.nodes.get(key)
  node('input').value='Project tracker for Forma'
  const submit=async()=>{await node('request-plan').fire('click');await tick()}
  ui.failPlanRequest(Error('Connection interrupted.'));await submit()
  ui.failPlanRequest(Object.assign(Error('Previous request failed.'),{code:'previous_build_failed'}));await submit()
  ui.failPlanRequest(null);await submit()
  const keys=ui.calls.filter(call=>call.path==='apps/plan').map(call=>call.headers['idempotency-key'])
  assert.equal(keys.length,3)
  assert.equal(keys[0],keys[1])
  assert.notEqual(keys[1],keys[2])
  assert.equal(node('plan').hidden,false)
  assert.equal(ui.api.currentApplication,null)
  ui.api.destroy()
})

test('manifest editor applies the exact expected version and retains the buffer and preview after failure',async()=>{
  const ui=await fixture();await ui.nodes.get('code-tab').fire('click');await tick()
  const editor=ui.nodes.get('manifest-editor'),original=ui.api.currentApplication
  assert.match(editor.value,/Forma/);assert.equal(ui.nodes.get('editor-label').hidden,false)
  const changed=JSON.parse(editor.value);changed.title='Forma Studio';editor.value=JSON.stringify(changed,null,2);await editor.fire('input')
  ui.failManifest();await ui.nodes.get('apply-manifest').fire('click');await tick()
  assert.equal(ui.api.currentApplication.version,original.version);assert.equal(editor.value,JSON.stringify(changed,null,2));assert.equal(ui.nodes.get('apply-manifest').disabled,false);assert.match(ui.nodes.get('status').textContent,/Edits kept/)
  ui.failManifest(false);await ui.nodes.get('apply-manifest').fire('click');await tick()
  assert.equal(ui.api.currentApplication.version,2);assert.equal(ui.api.currentApplication.manifest.title,'Forma Studio');assert.equal(ui.nodes.get('apply-manifest').disabled,true)
  assert.equal(JSON.parse(ui.calls.find(call=>call.path.endsWith('/manifest')).body).version,1)
  ui.api.destroy()
})

test('malformed JSON never leaves the editor; trusted runtime and binary files remain read-only',async()=>{
  const ui=await fixture();await ui.nodes.get('code-tab').fire('click');await tick()
  const editor=ui.nodes.get('manifest-editor');editor.value='{invalid';await editor.fire('input');await ui.nodes.get('apply-manifest').fire('click');await tick()
  assert.equal(ui.calls.filter(call=>call.path.endsWith('/manifest')).length,0);assert.equal(editor.value,'{invalid');assert.match(ui.nodes.get('status').textContent,/Invalid JSON/)
  ui.nodes.get('file').value='server.mjs';await ui.nodes.get('file').fire('change');assert.equal(ui.nodes.get('editor-label').hidden,true);assert.match(ui.nodes.get('file-meta').textContent,/Read-only runtime file/)
  ui.nodes.get('file').value='assets/image.png';await ui.nodes.get('file').fire('change');assert.equal(ui.nodes.get('copy-file').disabled,true);assert.match(ui.nodes.get('file-content').textContent,/Binary image/);assert.doesNotMatch(ui.nodes.get('file-content').textContent,/eA==/)
  ui.api.destroy()
})

test('image upload sends raw bytes with the selected revision, supports role selection, and Undo uses real restore',async()=>{
  const ui=await fixture();await ui.nodes.get('assets-tab').fire('click');await tick()
  ui.nodes.get('upload-asset').files=[new Blob(['image'],{type:'image/png'})];await ui.nodes.get('upload-asset').fire('change');await tick()
  assert.equal(ui.api.currentApplication.version,2);const upload=ui.calls.find(call=>call.method==='POST' && call.path.endsWith('/assets'));assert.equal(upload.body.size,5)
  const row=ui.nodes.get('asset-list').children[0],logo=row.all().find(node=>node.tagName==='BUTTON' && node.textContent==='Use as logo');assert.ok(logo);await logo.fire('click');await tick()
  assert.equal(ui.api.currentApplication.manifest.assets.logo,'asset_fixture');assert.equal(ui.api.currentApplication.version,3)
  await ui.nodes.get('undo').fire('click');await tick();assert.equal(ui.api.currentApplication.version,4);assert.equal(ui.api.currentApplication.manifest.assets?.logo,undefined);assert.ok(ui.calls.some(call=>call.path.endsWith('/restore') && JSON.parse(call.body).version===2))
  await ui.nodes.get('undo').fire('click');await tick();assert.equal(ui.api.currentApplication.version,5);assert.deepEqual(ui.calls.filter(call=>call.path.endsWith('/restore')).map(call=>JSON.parse(call.body).version),[2,1])
  ui.api.destroy()
})

test('image thumbnail blobs are allowed only in the image content policy',async t=>{
  const app=createCompassServer({env:{}});t.after(()=>app.close())
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening')
  const response=await fetch('http://127.0.0.1:'+app.server.address().port+'/healthz');assert.equal(response.status,200)
  assert.equal(response.headers.get('content-security-policy'),"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; media-src 'self' https:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; frame-src 'self' https:")
})

test('uploaded image thumbnails use validated versioned blobs and release their object URLs',async()=>{
  const ui=await fixture()
  let url
  try{
    ui.nodes.get('upload-asset').files=[new Blob(['image'],{type:'image/png'})];await ui.nodes.get('upload-asset').fire('change');await tick()
    const image=ui.nodes.get('asset-list').children[0].all().find(node=>node.tagName==='IMG')
    assert.match(image.src,/^blob:/);assert.equal(image.alt,'Project image')
    const blob=resolveObjectURL(image.src);assert.equal(blob.type,'image/png');assert.equal(await blob.text(),'image')
    const read=ui.calls.find(call=>call.path.endsWith('/assets/asset_fixture') && call.raw)
    assert.equal(read.headers['x-compass-app-version'],'2')
    url=image.src
  }finally{ui.api.destroy()}
  assert.equal(resolveObjectURL(url),undefined)
})

test('asset bridge refuses images absent from the selected manifest and arbitrary capabilities',()=>{
  const manifest=createApplicationManifest('A CRM');manifest.assets={logo:'asset_owned'}
  const message={type:'compass-app-request',requestId:'asset_request',action:'asset',assetId:'asset_owned'}
  assert.deepEqual(validateApplicationBridgeMessage(message,manifest),{requestId:'asset_request',action:'asset',assetId:'asset_owned'})
  for(const value of [{...message,assetId:'asset_other'},{...message,assetId:'../secret'},{...message,url:'https://example.com'},{...message,id:'record_1'},{...message,data:{}},{...message,action:'list'}])assert.equal(validateApplicationBridgeMessage(value,manifest),null)
})

test('project context preserves editable notes, superseded decisions, and task transitions',async()=>{
  const ui=await fixture({useContext:true})
  const node=key=>ui.nodes.get(key)
  assert.equal(node('project-context').hidden,false)
  assert.equal(ui.calls.some(call=>call.path.endsWith('/context')),false)
  ui.updateContext({notes:{goal:'Track studio clients'},recentChanges:[{version:1,prompt:'Create the studio CRM'}]})
  node('project-context').open=true
  await node('project-context').fire('toggle')
  await tick()
  assert.equal(node('context-note-goal').value,'Track studio clients')
  assert.match(node('context-changes').textContent,/Create the studio CRM/)

  node('context-note-goal').value='Track clients and bookings'
  await node('context-note-goal').fire('input')
  ui.updateContext({notes:{goal:'Manage the studio',architecture:'Web app'}})
  await node('context-notes').fire('submit')
  await tick()
  assert.equal(node('context-save').disabled,true)
  assert.match(node('context-status').textContent,/Your edits are kept/)
  await node('context-refresh').fire('click')
  await tick()
  assert.equal(node('context-note-goal').value,'Track clients and bookings')
  assert.equal(node('context-note-architecture').value,'Web app')
  assert.match(node('context-note-conflict-list').textContent,/Manage the studio/)
  await node('context-notes').fire('submit')
  await tick()
  assert.deepEqual(JSON.parse(ui.calls.filter(call=>call.method==='PUT').at(-1).body),{
    version:2,notes:{goal:'Track clients and bookings',architecture:'Web app',preferences:'',dependencies:'',problems:''},
  })

  const submitEntry=async (key,value,form=key+'-form')=>{
    node('context-'+key).value=value
    await node('context-'+key).fire('input')
    await node('context-'+form).fire('submit')
    await tick()
  }
  const clickRowAction=async (list,label)=>{
    const button=node('context-'+list).all().find(item=>item.tagName==='BUTTON' && item.textContent===label)
    assert.equal(button?.disabled,false)
    await button.fire('click')
    await tick()
  }
  await submitEntry('decision','Sort customers by name')
  await clickRowAction('decisions','Replace')
  await submitEntry('replacement','Sort customers by last visit','replace-form')
  assert.match(node('context-decisions').textContent,/Sort customers by nameSuperseded/)
  assert.match(node('context-decisions').textContent,/Sort customers by last visitActive/)
  await submitEntry('task','Review customer list')
  await clickRowAction('tasks','Complete')
  assert.match(node('context-tasks').textContent,/Done/)
  await clickRowAction('tasks','Reopen')
  await clickRowAction('tasks','Cancel')
  assert.match(node('context-tasks').textContent,/Cancelled/)
  ui.api.destroy()
})

test('a late context response is dropped after the application is closed',async()=>{
  const ui=await fixture({useContext:true})
  const node=key=>ui.nodes.get(key)
  ui.updateContext({notes:{goal:'This belongs to the previously opened project'}})
  const finishRequest=ui.holdContext()
  node('project-context').open=true
  await node('project-context').fire('toggle')
  const request=ui.calls.find(call=>call.path.endsWith('/context'))
  await node('new').fire('click')
  assert.equal(request.signal.aborted,true)
  finishRequest()
  await tick()
  assert.equal(ui.api.currentApplication,null)
  assert.equal(node('project-context').hidden,true)
  assert.equal(node('context-note-goal').value,'')
  await node('project-context').fire('toggle')
  assert.equal(ui.calls.filter(call=>call.path.endsWith('/context')).length,1)
  ui.api.destroy()
})

test('reviewed plans bind the context version and preserve the draft on conflict',async()=>{
  const ui=await fixture({useContext:true})
  const node=key=>ui.nodes.get(key)
  ui.updateContext({notes:{architecture:'Project tracker'}})
  node('input').value='Rename the tracker'
  await node('request-plan').fire('click')
  await tick()
  assert.equal(node('plan').hidden,false)
  const draft=node('plan-editor').value
  ui.updateContext({notes:{architecture:'Studio CRM'}})
  await node('apply-plan').fire('click')
  await tick()
  const request=ui.calls.find(call=>call.path.endsWith('/build-plan'))
  assert.equal(JSON.parse(request.body).contextVersion,1)
  assert.equal(node('apply-plan').disabled,true)
  assert.match(node('plan-warning').textContent,/context changed/)
  assert.equal(node('plan-editor').value,draft)
  assert.equal(node('input').value,'Rename the tracker')
  assert.equal(ui.api.currentApplication.version,1)

  await node('request-plan').fire('click')
  await tick()
  node('project-context').open=true
  await node('project-context').fire('toggle')
  await tick()
  node('context-note-goal').value='Run a creative studio'
  await node('context-note-goal').fire('input')
  await node('context-notes').fire('submit')
  await tick()
  assert.match(node('plan-warning').textContent,/context changed/)
  assert.equal(node('apply-plan').disabled,true)
  assert.equal(ui.calls.filter(call=>call.path.endsWith('/build-plan')).length,1)
  ui.api.destroy()
})
