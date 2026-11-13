import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import {webcrypto} from 'node:crypto'
import {createApplicationManifest} from '../generation/manifest.mjs'
import {validateApplicationManifest} from '../generation/templates/lib/schema.mjs'
import {validateApplicationBridgeMessage} from '../src/applications/bridge.mjs'
import {applicationResultOutcome,requireApplicationVersion} from '../src/applications/result.mjs'
import {mountPaneLayout} from '../src/builder/pane-layout.mjs'

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
async function fixture(){
  const nodes=new Map(),container=new Node(),body=new Node(),layout=new Node(),events=new Map(),calls=[]
  layout.handles=['projects','conversation'].map(name=>{const node=new Node();node.dataset.resizePane=name;return node})
  Object.defineProperty(container,'innerHTML',{set(value){for(const match of value.matchAll(/<([a-z]+)([^>]*\bdata-aw="([^"]+)"[^>]*)>/g)){const node=new Node(match[1]);node.hidden=/\bhidden\b/.test(match[2]);nodes.set(match[3],node)}nodes.get('composer-label').append(new Node('span'));nodes.get('design-form').elements=Object.fromEntries(['mode','accent','font','density'].map(key=>[key,{value:''}]))}})
  container.querySelector=selector=>selector==='.aw-layout'?layout:nodes.get(selector.match(/data-aw="([^"]+)"/)?.[1])
  container.querySelectorAll=selector=>selector==='button,select,textarea,input'?[...nodes.values(),...container.all()].filter(node=>['BUTTON','SELECT','TEXTAREA','INPUT'].includes(node.tagName)):[...nodes.values()].flatMap(node=>node.querySelectorAll(selector))
  let app={id:'app_fixture',version:1,source:'prepared',manifest:createApplicationManifest('A CRM called Forma')},failManifest=false
  let revisions=[{version:1,manifest:structuredClone(app.manifest),changes:[]}],assets=[]
  const request=async(path,options={})=>{
    calls.push({path,...options});const method=options.method || 'GET'
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
  const context={console,document:{body,createElement:tag=>new Node(tag)},window:{addEventListener:(type,fn)=>events.set(type,fn),removeEventListener(){}},crypto:webcrypto,URL,Blob,Response,TextEncoder,AbortController,setTimeout,atob,structuredClone,confirm:()=>true,navigator:{clipboard:{writeText:async()=>{}}},createDictation:()=>null,draftCanAutoBuild:()=>false,disarmDraft(){},validateApplicationManifest,validateApplicationBridgeMessage,applicationResultOutcome,requireApplicationVersion,mountPaneLayout}
  vm.runInNewContext(client+';globalThis.mount=mountApplicationWorkspace',context)
  const api=await context.mount({container,request,requestRaw:raw,userId:'owner_fixture'});await api.open(app.id)
  return {api,nodes,calls,events,container,get app(){return app},failManifest(value=true){failManifest=value},tick}
}

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

test('asset bridge refuses images absent from the selected manifest and arbitrary capabilities',()=>{
  const manifest=createApplicationManifest('A CRM');manifest.assets={logo:'asset_owned'}
  const message={type:'compass-app-request',requestId:'asset_request',action:'asset',assetId:'asset_owned'}
  assert.deepEqual(validateApplicationBridgeMessage(message,manifest),{requestId:'asset_request',action:'asset',assetId:'asset_owned'})
  for(const value of [{...message,assetId:'asset_other'},{...message,assetId:'../secret'},{...message,url:'https://example.com'},{...message,id:'record_1'},{...message,data:{}},{...message,action:'list'}])assert.equal(validateApplicationBridgeMessage(value,manifest),null)
})
