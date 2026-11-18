import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import {REFERENCE_PRESETS,BUILD_TYPES,normalizeReference,suggestBlueprint,compileReferenceBrief} from '../src/start/reference.mjs'
import {readDraft,writeDraft,DRAFT_TTL} from '../src/create/draft.mjs'

const source=(await readFile(new URL('../src/start/start.mjs',import.meta.url),'utf8')).replace(/^import .+\n/gm,'').replace('export function','function')
class Element {
  constructor(tag,doc){this.tagName=tag.toUpperCase();this.doc=doc;this.children=[];this.parentElement=null;this.listeners=new Map();this.attributes={};this.dataset={};this.style={};this.hidden=false;this.disabled=false;this.open=false;this.value='';this.checked=false;this._text='';const classes=new Set();this.classList={add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)}}
  set textContent(value){this._text=String(value);this.children=[]}get textContent(){return this._text+this.children.map(node=>node.textContent).join('')}
  append(...nodes){for(const node of nodes){this.children.push(node);node.parentElement=this}}
  replaceChildren(...nodes){for(const node of this.children)node.parentElement=null;this.children=[];this._text='';this.append(...nodes)}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(node=>node!==this);this.parentElement=null}
  addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(fn)}removeEventListener(name,fn){this.listeners.get(name)?.delete(fn)}
  async fire(type,event={}){const input={type,target:this,key:'',shiftKey:false,preventDefault(){this.defaultPrevented=true},stopPropagation(){this.propagationStopped=true},...event};for(const fn of [...this.listeners.get(type)||[]])await fn(input);return input}
  all(){return this.children.flatMap(node=>[node,...node.all()])}contains(node){return node===this || this.all().includes(node)}
  querySelectorAll(selector){const choices=selector.split(',');return this.all().filter(node=>choices.some(choice=>choice==='a[href]'?node.tagName==='A'&&node.href:node.tagName===choice.toUpperCase()))}
  querySelector(selector){if(selector==='dialog[open]')return this.all().find(node=>node.tagName==='DIALOG' && node.open);return null}
  closest(selector){if(selector==='[hidden]'){let node=this;while(node){if(node.hidden)return node;node=node.parentElement}}return null}
  setAttribute(name,value){this.attributes[name]=String(value);if(name==='open')this.open=true}getAttribute(name){return this.attributes[name]??null}removeAttribute(name){delete this.attributes[name];if(name==='open')this.open=false}
  focus(){this.doc.activeElement=this}get isConnected(){return this.doc.body.contains(this)}getBoundingClientRect(){return{left:20,right:1000,top:0,bottom:800}}
  showModal(){this.open=true;this.modal=true}close(){this.open=false}
}
function fixture({beforeContinue,write,navigate,reduced=true}={}) {
  const writes=[],navigations=[],timers=new Map();let next=0
  const doc=new Element('document',null);doc.doc=doc;doc.body=new Element('body',doc);doc.append(doc.body);doc.body.style.overflow='auto';doc.createElement=tag=>new Element(tag,doc)
  const project=doc.createElement('textarea');project.value='Unsaved current project';doc.body.append(project)
  const trigger=doc.createElement('button');trigger.textContent='Start from an app';doc.body.append(trigger);trigger.focus()
  const view={matchMedia:()=>({matches:reduced}),setTimeout:fn=>{timers.set(++next,fn);return next},clearTimeout:id=>timers.delete(id)}
  const context={REFERENCE_PRESETS,BUILD_TYPES,normalizeReference,suggestBlueprint,compileReferenceBrief,storeDraft(){throw Error('Use the isolated write seam')},setTimeout,clearTimeout}
  vm.runInNewContext(source+';globalThis.mount=mountReferenceStart',context)
  const api=context.mount({trigger,document:doc,window:view,beforeContinue,writeDraft:value=>{writes.push(value);return write?write(value):{ok:true,draft:{id:'draft'}}},navigate:path=>{navigations.push(path);if(navigate)return navigate(path)}})
  const nodes=()=>doc.body.all(),control=name=>nodes().find(node=>node.dataset.start===name),byClass=name=>nodes().find(node=>node.className===name),field=name=>nodes().find(node=>node.name===name)
  async function plan({reference='Notion',name='North Studio'}={}){api.open();field('reference').value=reference;await byClass('rs-reference-form').fire('submit');field('projectName').value=name;await field('projectName').fire('input')}
  return{api,doc,view,project,trigger,writes,navigations,nodes,control,byClass,field,plan,timers,flushTimers(){for(const fn of [...timers.values()])fn();timers.clear()}}
}

test('reference planning opens lazily and closing or reopening preserves both the plan and current project',async()=>{
  const ui=fixture();assert.equal(ui.nodes().some(node=>node.tagName==='DIALOG'),false);assert.equal(ui.writes.length,0)
  await ui.plan();const dialog=ui.nodes().find(node=>node.tagName==='DIALOG');assert.equal(dialog.modal,true);assert.equal(dialog.getAttribute('aria-modal'),'true')
  assert.equal(ui.field('projectType').value,'tracker');assert.equal(ui.control('target').getAttribute('aria-pressed'),'false')
  ui.field('notes').value='For my studio';await ui.field('notes').fire('input')
  const notes=ui.byClass('rs-features').querySelectorAll('input').find(node=>node.value==='notes');notes.checked=false;await ui.byClass('rs-features').fire('change')
  const event=await dialog.fire('keydown',{key:'Escape'});assert.equal(event.defaultPrevented,true);assert.equal(event.propagationStopped,true)
  assert.equal(ui.api.isOpen,false);assert.equal(docFocus(ui),ui.trigger);assert.equal(ui.doc.body.style.overflow,'auto')
  assert.equal(ui.project.value,'Unsaved current project');assert.equal(ui.writes.length,0);assert.deepEqual(ui.navigations,[])
  ui.api.open();assert.equal(ui.field('projectName').value,'North Studio');assert.equal(ui.field('notes').value,'For my studio');assert.equal(notes.checked,false);ui.api.destroy()
})
function docFocus(ui){return ui.doc.activeElement}

test('explicit Build validates the reviewed plan and runs the current-project guard before a single normal draft handoff',async()=>{
  let allow=false,calls=0;const ui=fixture({beforeContinue:()=>{calls++;assert.equal(ui.writes.length,0);return allow}})
  await ui.plan({reference:'https://notion.so/private-page?token=not-retained',name:'North Studio'})
  const notes=ui.byClass('rs-features').querySelectorAll('input').find(node=>node.value==='notes');notes.checked=false;await ui.byClass('rs-features').fire('change')
  await ui.byClass('rs-plan-form').fire('submit');assert.equal(calls,1);assert.equal(ui.writes.length,0);assert.deepEqual(ui.navigations,[])
  allow=true;await ui.byClass('rs-plan-form').fire('submit');assert.equal(calls,2);assert.equal(ui.writes.length,1);assert.deepEqual(ui.navigations,['/create?app=1'])
  assert.equal(ui.writes[0].ready,false);assert.equal(ui.writes[0].preferences.projectType,'internal-tool');assert.match(ui.writes[0].prompt,/called "North Studio"/);assert.match(ui.writes[0].prompt,/Fields: title, status\./);assert.doesNotMatch(ui.writes[0].prompt,/private-page|token=/)
  const primary=ui.byClass('rs-features').querySelectorAll('input').find(node=>node.value==='title');assert.equal(primary.checked,true);assert.equal(primary.disabled,true)
  ui.api.destroy()
})

test('a known app can become a website and only its selected website sections enter the build brief',async()=>{
  const ui=fixture();await ui.plan()
  assert.equal(ui.field('notes').parentElement.children[0].textContent,'Design changes')
  assert.equal(ui.field('notes').placeholder,'Bright blue accents. Compact layout.')
  const website=ui.nodes().find(node=>node.dataset.target==='website');await website.fire('click');assert.equal(ui.field('projectType').value,'website');assert.equal(ui.byClass('rs-field').hidden,false)
  assert.equal(ui.field('notes').parentElement.children[0].textContent,'What should be different?')
  await ui.nodes().find(node=>node.dataset.target==='app').fire('click')
  assert.equal(ui.field('notes').parentElement.children[0].textContent,'Design changes')
  await website.fire('click')
  assert.equal(ui.field('notes').parentElement.children[0].textContent,'What should be different?')
  const fields=ui.byClass('rs-features').querySelectorAll('input');for(const input of fields)input.checked=input.value==='contact';await ui.byClass('rs-features').fire('change')
  await ui.byClass('rs-plan-form').fire('submit');assert.deepEqual(ui.navigations,['/create']);assert.equal(ui.writes[0].preferences.projectType,'website');assert.match(ui.writes[0].prompt,/Sections: contact\./)
  ui.api.destroy()
})

test('invalid references, empty plans and unavailable storage keep all text and never navigate',async()=>{
  const ui=fixture({write:()=>({ok:false,error:'storage-unavailable'})});ui.api.open();ui.field('reference').value='http://localhost/private';await ui.byClass('rs-reference-form').fire('submit');assert.equal(ui.byClass('rs-plan-form').hidden,true);assert.equal(ui.writes.length,0)
  await ui.plan({name:''});await ui.byClass('rs-plan-form').fire('submit');assert.equal(ui.writes.length,0);assert.equal(ui.doc.activeElement,ui.field('projectName'))
  ui.field('projectName').value='North Studio';await ui.field('projectName').fire('input');await ui.byClass('rs-plan-form').fire('submit');assert.equal(ui.writes.length,1);assert.equal(ui.field('projectName').value,'North Studio');assert.match(ui.byClass('rs-status').textContent,/couldn’t keep your plan/);assert.deepEqual(ui.navigations,[]);ui.api.destroy()
})

test('closing during an asynchronous guard cancels its late continuation even after reopening',async()=>{
  let release,calls=0;const ui=fixture({beforeContinue:()=>++calls===1?new Promise(resolve=>release=resolve):true});await ui.plan()
  const pending=ui.byClass('rs-plan-form').fire('submit');assert.equal(ui.control('build').disabled,true)
  ui.api.close();ui.api.open();release(true);await pending;assert.equal(ui.writes.length,0);assert.deepEqual(ui.navigations,[]);assert.equal(ui.control('build').disabled,false)
  await ui.byClass('rs-plan-form').fire('submit');assert.equal(ui.writes.length,1);assert.deepEqual(ui.navigations,['/create?app=1']);ui.api.destroy()
})

test('double submissions share one continuation; an explicit retry checks the guard and reasserts the reviewed draft',async()=>{
  let release,calls=0,fail=true;const ui=fixture({beforeContinue:()=>++calls===1?new Promise(resolve=>release=resolve):true,navigate:()=>{if(fail)throw Error('navigation unavailable')}});await ui.plan()
  const pending=ui.byClass('rs-plan-form').fire('submit');await ui.byClass('rs-plan-form').fire('submit');assert.equal(calls,1);release(true);await pending
  assert.equal(ui.writes.length,1);assert.equal(ui.byClass('rs-recovery').hidden,false);assert.equal(ui.control('build').textContent,'Open builder')
  fail=false;await ui.byClass('rs-plan-form').fire('submit');assert.equal(calls,2);assert.equal(ui.writes.length,2);assert.equal(ui.navigations.length,2);ui.api.destroy()
})

test('drawer focus is trapped, current-builder shortcuts are stopped, and destruction cancels a pending continuation',async()=>{
  let release;const ui=fixture({beforeContinue:()=>new Promise(resolve=>release=resolve)});await ui.plan()
  const dialog=ui.nodes().find(node=>node.tagName==='DIALOG');ui.control('close').focus();const tab=await dialog.fire('keydown',{key:'Tab',shiftKey:true});assert.equal(tab.defaultPrevented,true);assert.equal(ui.doc.activeElement,ui.control('build'))
  const shortcut=await dialog.fire('keydown',{key:'Enter',ctrlKey:true});assert.equal(shortcut.propagationStopped,true)
  const pending=ui.byClass('rs-plan-form').fire('submit');ui.api.destroy();release(true);await pending
  assert.equal(ui.writes.length,0);assert.equal(ui.nodes().some(node=>node.tagName==='DIALOG'),false);assert.equal(ui.trigger.getAttribute('aria-haspopup'),null)
})


test('reference drawer does not stack over an existing modal and clears an interrupted close animation safely',async()=>{
  const ui=fixture({reduced:false});const other=ui.doc.createElement('dialog');other.open=true;ui.doc.body.append(other)
  assert.equal(ui.api.open(),false);assert.equal(ui.nodes().filter(node=>node.tagName==='DIALOG').length,1);assert.equal(ui.trigger.getAttribute('aria-expanded'),'false')
  other.close();await ui.plan();ui.api.close();assert.equal(ui.timers.size,1);ui.api.open();assert.equal(ui.timers.size,0);ui.flushTimers();assert.equal(ui.api.isOpen,true);assert.equal(ui.doc.body.style.overflow,'hidden')
  ui.api.destroy();assert.equal(ui.doc.body.style.overflow,'auto')
})


test('the navigation recovery link rechecks unsaved-work protection after the drawer is reopened',async()=>{
  let allow=true,fail=true,guards=0;const ui=fixture({beforeContinue:()=>{guards++;return allow},navigate:()=>{if(fail)throw Error('navigation unavailable')}})
  await ui.plan();await ui.byClass('rs-plan-form').fire('submit');assert.equal(ui.writes.length,1);assert.equal(ui.navigations.length,1)
  ui.api.close();ui.project.value='New unsaved edits after closing';ui.api.open();allow=false
  const blocked=await ui.byClass('rs-recovery').fire('click');assert.equal(blocked.defaultPrevented,true);assert.equal(guards,2);assert.equal(ui.navigations.length,1);assert.equal(ui.writes.length,1)
  allow=true;fail=false;await ui.byClass('rs-recovery').fire('click');assert.equal(guards,3);assert.equal(ui.navigations.length,2);assert.equal(ui.writes.length,2);assert.equal(ui.project.value,'New unsaved edits after closing');ui.api.destroy()
})

test('retrying a reviewed plan replaces a different handoff and renews an expired one before navigation',async()=>{
  let clock=1000,nextId=0,fail=true,guards=0
  const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}
  const options={storage,now:()=>clock,id:()=>`draft_${++nextId}`}
  const ui=fixture({beforeContinue:()=>{guards++;return true},write:value=>writeDraft(value,options),navigate:()=>{if(fail)throw Error('navigation unavailable')}})
  await ui.plan();await ui.byClass('rs-plan-form').fire('submit')
  const original=readDraft(options);assert.match(original.prompt,/called "North Studio"/)
  ui.api.close();writeDraft({prompt:'A different website idea',preferences:{projectType:'website'},ready:false},options)
  const other=readDraft(options);assert.notEqual(other.id,original.id)
  ui.api.open();await ui.byClass('rs-recovery').fire('click')
  const restored=readDraft(options);assert.match(restored.prompt,/called "North Studio"/);assert.equal(restored.preferences.projectType,'internal-tool');assert.equal(restored.ready,false);assert.notEqual(restored.id,other.id)
  ui.api.close();clock+=DRAFT_TTL+1;assert.equal(readDraft(options),null)
  ui.api.open();fail=false;await ui.byClass('rs-plan-form').fire('submit')
  const renewed=readDraft(options);assert.match(renewed.prompt,/called "North Studio"/);assert.notEqual(renewed.id,restored.id);assert.equal(renewed.createdAt,clock);assert.equal(renewed.ready,false)
  assert.equal(guards,3);assert.equal(ui.writes.length,3);assert.deepEqual(ui.navigations,['/create?app=1','/create?app=1','/create?app=1']);ui.api.destroy()
})
