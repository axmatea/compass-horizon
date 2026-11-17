import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import {validateTourManifest,createTourState,reduceTourState,chapterAtTime,formatTourTime} from '../src/help/model.mjs'

const manifest=()=>({version:1,kind:'interactive',title:'Platform Tour',video:null,captions:'/assets/tutorial/tour.vtt',duration:30,chapters:[
  {id:'start',title:'Start a project',start:0,end:15,instruction:'Describe your project, then choose Build.',screen:'/assets/tutorial/start.webp',alt:'The COMPASS project composer'},
  {id:'save',title:'Save and reopen',start:15,end:30,instruction:'Save to your account. Reopen it from Saved websites.',screen:'/assets/tutorial/save.webp',alt:'Saved websites in COMPASS'},
]})
const client=(await readFile(new URL('../src/help/platform-tour.mjs',import.meta.url),'utf8')).replace(/^import .+\n/gm,'').replace('export function','function')

test('tour manifest accepts only bounded product-screen media and a complete, unambiguous timeline',()=>{
  assert.deepEqual(validateTourManifest(manifest()),manifest())
  const video={...manifest(),kind:'video',video:'/assets/tutorial/recording.mp4'};assert.ok(validateTourManifest(video))
  for(const patch of [{video:'https://example.com/video.mp4'},{video:'javascript:alert(1)'},{video:'/assets/tutorial/../private.mp4'},{video:'/assets/tutorial/%2e%2e/private.mp4'},{video:'/assets/tutorial/video.mp4?token=x'}])assert.equal(validateTourManifest({...video,...patch}),null)
  for(const screen of ['/api/account/projects','https://example.com/screen.png','/assets/tutorial/image.svg','data:image/png;base64,eA==','/assets/tutorial/image.png#x'])assert.equal(validateTourManifest({...manifest(),chapters:manifest().chapters.map(chapter=>({...chapter,screen}))}),null)
  for(const alter of [value=>value.chapters[1].start=16,value=>value.chapters[1].start=14,value=>value.chapters[1].id='start',value=>value.duration=31,value=>value.chapters[0].end=0,value=>value.chapters[0].instruction='',value=>value.duration=Infinity]){const value=manifest();alter(value);assert.equal(validateTourManifest(value),null)}
  assert.equal(validateTourManifest({...manifest(),chapters:Array(25).fill(manifest().chapters[0])}),null)
})

test('guide playback is explicit, bounded and replayable; chapter jumps do not start a paused guide',()=>{
  const value=manifest();let state=createTourState()
  assert.equal(reduceTourState(value,state,{type:'tick',seconds:1}),state)
  state=reduceTourState(value,state,{type:'jump',index:1});assert.equal(state.time,15);assert.equal(state.playing,false)
  state=reduceTourState(value,state,{type:'play'});state=reduceTourState(value,state,{type:'tick',seconds:1});assert.equal(state.time,16)
  state=reduceTourState(value,state,{type:'seek',time:999});assert.equal(state.time,30);assert.equal(state.playing,false);assert.equal(state.ended,true)
  state=reduceTourState(value,state,{type:'replay'});assert.equal(state.time,0);assert.equal(state.playing,true)
  state=reduceTourState(value,state,{type:'captions'});assert.equal(state.captions,false)
  state=reduceTourState(value,state,{type:'seek',time:-10});assert.equal(state.time,0)
  assert.equal(chapterAtTime(value,15),1);assert.equal(chapterAtTime(value,30),1);assert.equal(chapterAtTime(value,NaN),0)
  assert.equal(formatTourTime(165),'2:45');assert.equal(formatTourTime(NaN),'0:00')
})

class Element {
  constructor(tag,doc){this.tagName=tag.toUpperCase();this.doc=doc;this.children=[];this.parentElement=null;this.attributes={};this.dataset={};this.listeners=new Map();this.hidden=false;this.disabled=false;this.style={};this._text='';this.value='';this.open=false;this.textTracks=[];this.pauseCalls=0;this.playCalls=0;this.currentTime=0;const classes=new Set();this.classList={add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)};this.play=async()=>{this.playCalls++};this.pause=()=>{this.pauseCalls++}}
  set textContent(value){this._text=String(value);this.children=[]}get textContent(){return this._text+this.children.map(child=>child.textContent).join('')}
  append(...nodes){for(const node of nodes){this.children.push(node);node.parentElement=this}}
  replaceChildren(...nodes){this.children.forEach(child=>child.parentElement=null);this.children=[];this._text='';this.append(...nodes)}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null}
  setAttribute(name,value){this.attributes[name]=String(value);if(name==='open')this.open=true}getAttribute(name){return this.attributes[name]??null}removeAttribute(name){delete this.attributes[name];if(name==='open')this.open=false}
  addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(fn)}removeEventListener(name,fn){this.listeners.get(name)?.delete(fn)}
  async fire(type,event={}){const input={type,target:this,key:'',shiftKey:false,preventDefault(){this.defaultPrevented=true},stopPropagation(){this.propagationStopped=true},...event};for(const fn of [...this.listeners.get(type)||[]])await fn(input);return input}
  all(){return this.children.flatMap(child=>[child,...child.all()])}contains(node){return node===this || this.all().includes(node)}
  querySelectorAll(){return this.all().filter(node=>['BUTTON','INPUT'].includes(node.tagName)||node.attributes.href)}closest(selector){if(selector==='[hidden]'){let node=this;while(node){if(node.hidden)return node;node=node.parentElement}}return null}
  focus(){this.doc.activeElement=this}get isConnected(){return this===this.doc.body || this.doc.body.contains(this)}
  showModal(){this.open=true;this.modal=true}close(){this.open=false}
  getBoundingClientRect(){return {left:20,right:1000,top:0,bottom:800}}
  async requestFullscreen(){this.doc.fullscreenElement=this;await this.doc.fire('fullscreenchange')}
}

function fixture({value=manifest(),reduced=true,mobile=false,response,request}={}){
  let clock=0,next=0;const frames=new Map(),timers=new Map(),calls=[]
  const doc=new Element('document',null);doc.doc=doc;doc.body=new Element('body',doc);doc.body.style.overflow='auto';doc.visibilityState='visible';doc.fullscreenElement=null
  doc.createElement=tag=>new Element(tag,doc);doc.exitFullscreen=async()=>{doc.fullscreenElement=null;await doc.fire('fullscreenchange')}
  const project=doc.createElement('textarea');project.value='Unsaved project text';doc.body.append(project)
  const trigger=doc.createElement('button');trigger.textContent='Platform Tour';doc.body.append(trigger);trigger.focus()
  const view={matchMedia:query=>({matches:query.includes('reduced-motion')?reduced:mobile}),requestAnimationFrame:work=>{frames.set(++next,work);return next},cancelAnimationFrame:id=>frames.delete(id),
    setTimeout:(work,delay)=>{timers.set(++next,{work,at:clock+delay});return next},clearTimeout:id=>timers.delete(id)}
  const fetch=async(path,options)=>{calls.push({path,options});if(request)return request(path,options);return response || new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}})}
  const context={console,AbortController,URL,setTimeout,clearTimeout,validateTourManifest,createTourState,reduceTourState,chapterAtTime,formatTourTime,globalThis:{}}
  vm.runInNewContext(client+';globalThis.mount=mountPlatformTour',context)
  const api=context.globalThis.mount({trigger,document:doc,window:view,fetch})
  const elements=()=>doc.body.all(),control=name=>elements().find(node=>node.dataset.tour===name),dialog=()=>elements().find(node=>node.tagName==='DIALOG')
  const advance=async milliseconds=>{clock+=milliseconds;const tasks=[...frames.values()];frames.clear();for(const task of tasks)task(clock);for(const [id,timer] of [...timers])if(timer.at<=clock){timers.delete(id);timer.work()}await new Promise(resolve=>setImmediate(resolve))}
  return {api,doc,view,calls,trigger,project,elements,control,dialog,advance,frames,timers}
}

test('tour opens lazily in a labelled modal, navigates chapters and closes without changing the current project',async()=>{
  const ui=fixture();assert.equal(ui.calls.length,0);assert.equal(ui.dialog(),undefined)
  await ui.api.open();assert.equal(ui.calls.length,1);assert.equal(ui.calls[0].path,'/assets/tutorial/platform-tour.json');assert.equal(ui.calls[0].options.cache,'no-store')
  assert.equal(ui.dialog().modal,true);assert.equal(ui.dialog().getAttribute('aria-modal'),'true');assert.equal(ui.trigger.getAttribute('aria-expanded'),'true')
  assert.match(ui.dialog().textContent,/Interactive guide · Product screens/);assert.doesNotMatch(ui.dialog().textContent,/Video tutorial/)
  assert.equal(ui.control('play').textContent,'Play guide');assert.equal(ui.project.value,'Unsaved project text')
  const chapter=ui.elements().find(node=>node.dataset.chapter==='save');await chapter.fire('click')
  assert.equal(chapter.getAttribute('aria-current'),'step');assert.equal(ui.control('progress').value,'15');assert.equal(ui.control('play').getAttribute('aria-pressed'),'false')
  const caption=ui.elements().find(node=>node.className==='pt-caption');assert.match(caption.textContent,/Save to your account/)
  assert.equal(caption.getAttribute('aria-live'),'polite');assert.equal(ui.elements().find(node=>node.tagName==='OUTPUT').getAttribute('aria-live'),'off')
  await ui.control('captions').fire('click');assert.equal(caption.hidden,true)
  const event=await ui.dialog().fire('keydown',{key:'Escape'});assert.equal(event.defaultPrevented,true);assert.equal(event.propagationStopped,true)
  assert.equal(ui.api.isOpen,false);assert.equal(ui.dialog().open,false);assert.equal(ui.doc.activeElement,ui.trigger);assert.equal(ui.doc.body.style.overflow,'auto')
  assert.equal(ui.project.value,'Unsaved project text');assert.equal(ui.calls.length,1)
  await ui.api.open();assert.equal(ui.control('progress').value,'15');assert.equal(ui.calls.length,1);ui.api.destroy();assert.equal(ui.dialog(),undefined)
})

test('interactive playback pauses on close and hidden tabs, supports replay and contains keyboard focus and workspace shortcuts',async()=>{
  const ui=fixture();await ui.api.open()
  const replay=ui.control('replay'),close=ui.control('close');close.focus()
  const back=await ui.dialog().fire('keydown',{key:'Tab',shiftKey:true});assert.equal(back.defaultPrevented,true);assert.notEqual(ui.doc.activeElement,close)
  const forward=await ui.dialog().fire('keydown',{key:'Tab'});assert.equal(forward.defaultPrevented,true);assert.equal(ui.doc.activeElement,close)
  assert.equal((await ui.dialog().fire('keydown',{key:'Enter',metaKey:true})).propagationStopped,true)
  await ui.control('play').fire('click');await ui.advance(1000);await ui.advance(1000);assert.equal(ui.control('progress').value,'1')
  ui.doc.visibilityState='hidden';await ui.doc.fire('visibilitychange');assert.equal(ui.frames.size,0);assert.equal(ui.control('play').textContent,'Play guide')
  await replay.fire('click');assert.equal(ui.control('progress').value,'0');assert.equal(ui.control('play').textContent,'Pause')
  ui.api.close();assert.equal(ui.frames.size,0);ui.api.destroy()
})

test('rapid drawer reopen restores original body scrolling and focus after the closing animation',async()=>{
  const ui=fixture({reduced:false});await ui.api.open();ui.api.close();assert.equal(ui.dialog().open,true)
  await ui.api.open();ui.api.close();await ui.advance(250)
  assert.equal(ui.doc.body.style.overflow,'auto');assert.equal(ui.doc.activeElement,ui.trigger);assert.equal(ui.dialog().open,false);ui.api.destroy()
})

test('mobile chapter selection reveals its screen without moving keyboard focus and respects reduced motion',async()=>{
  for(const reduced of [true,false]){
    const ui=fixture({mobile:true,reduced});await ui.api.open()
    const player=ui.elements().find(node=>node.className==='pt-player'),scrolls=[];player.scrollIntoView=options=>scrolls.push(options)
    const chapter=ui.elements().find(node=>node.dataset.chapter==='save');chapter.focus();await chapter.fire('click')
    assert.equal(ui.doc.activeElement,chapter);assert.equal(scrolls.length,1);assert.equal(scrolls[0].behavior,reduced?'auto':'smooth');assert.equal(ui.control('progress').value,'15')
    ui.api.destroy()
  }
})

test('actual video mode controls playback, seeking, captions and fullscreen; decoding failure becomes an honestly labelled screen guide',async()=>{
  const value={...manifest(),kind:'video',video:'/assets/tutorial/recording.mp4'},ui=fixture({value});await ui.api.open()
  const video=ui.elements().find(node=>node.tagName==='VIDEO');assert.equal(video.src,value.video);assert.equal(video.playCalls,0)
  assert.equal(ui.control('play').textContent,'Play video');await ui.control('play').fire('click');assert.equal(video.playCalls,1)
  ui.control('progress').value='18';await ui.control('progress').fire('input');assert.equal(video.currentTime,18)
  video.textTracks=[{kind:'captions',mode:'showing'}];await ui.control('captions').fire('click');assert.equal(video.textTracks[0].mode,'hidden')
  await ui.control('fullscreen').fire('click');assert.ok(ui.doc.fullscreenElement);assert.equal(ui.control('fullscreen').textContent,'Exit fullscreen')
  ui.control('fullscreen').focus();await ui.dialog().fire('keydown',{key:'Tab'});assert.equal(ui.doc.activeElement,ui.control('progress'),'fullscreen focus stays inside its visible player')
  await ui.dialog().fire('keydown',{key:'Tab',shiftKey:true});assert.equal(ui.doc.activeElement,ui.control('fullscreen'))
  await ui.control('fullscreen').fire('click');assert.equal(ui.doc.fullscreenElement,null)
  await video.fire('error');assert.match(ui.dialog().textContent,/Interactive guide · Product screens/);assert.match(ui.dialog().textContent,/Video is unavailable/);assert.equal(video.hidden,true);assert.equal(ui.control('play').textContent,'Play guide')
  ui.api.destroy()
})

test('invalid or unavailable media manifests fail visibly and can retry; late loading never reopens a closed guide',async()=>{
  let attempts=0;const ui=fixture({request:async()=>new Response(attempts++?JSON.stringify(manifest()):'{invalid')});await ui.api.open();assert.match(ui.dialog().textContent,/tour couldn’t load/);assert.equal(ui.control('retry').hidden,false);assert.equal(ui.control('play').disabled,true);assert.equal(ui.control('fullscreen').disabled,true)
  await ui.control('retry').fire('click');await new Promise(resolve=>setImmediate(resolve));assert.equal(ui.control('play').disabled,false);assert.equal(ui.calls.length,2);ui.api.destroy()
  let complete;const late=fixture({request:()=>new Promise(resolve=>{complete=resolve})}),opening=late.api.open()
  late.api.close();complete(new Response(JSON.stringify(manifest())));await opening
  assert.equal(late.api.isOpen,false);assert.equal(late.dialog().open,false);assert.equal(late.doc.activeElement,late.trigger);late.api.destroy()
})

test('a failed screenshot keeps readable instructions and does not reappear during playback',async()=>{
  const ui=fixture();await ui.api.open();const image=ui.elements().find(node=>node.tagName==='IMG')
  await image.fire('error');assert.equal(image.hidden,true);assert.match(ui.dialog().textContent,/screen couldn’t load/)
  await ui.control('play').fire('click');await ui.advance(1000);assert.equal(image.hidden,true)
  await ui.elements().find(node=>node.dataset.chapter==='save').fire('click');assert.equal(image.hidden,false);assert.equal(ui.elements().find(node=>node.className==='pt-status').hidden,true);ui.api.destroy()
})

test('a pending video-play promise cannot restart playback after the tour closes',async()=>{
  const ui=fixture({value:{...manifest(),kind:'video',video:'/assets/tutorial/recording.mp4'}});await ui.api.open()
  const video=ui.elements().find(node=>node.tagName==='VIDEO');let complete;video.play=()=>new Promise(resolve=>{complete=resolve})
  const playing=ui.control('play').fire('click');ui.api.close();const pauses=video.pauseCalls;complete();await playing;await new Promise(resolve=>setImmediate(resolve))
  assert.ok(video.pauseCalls>pauses);assert.equal(ui.control('play').getAttribute('aria-pressed'),'false');ui.api.destroy()
})
