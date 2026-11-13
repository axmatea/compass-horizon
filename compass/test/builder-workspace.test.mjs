import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createPreviewTools } from '../src/site/preview-tools.mjs';
import { parseSse, cleanText, previewDoc } from '../src/site/studio.mjs';
import { createProjectStore, completedRevision, appendRevision, restoredProject } from '../src/builder/project-store.mjs';

// Run the real client against a small DOM adapter and controllable network.
// Browser layout and native speech are checked separately; these cases guard
// request recovery, keyboard submissions and storage wiring without a model.
const html = await readFile(new URL('../demo.html',import.meta.url),'utf8');
const client = (await readFile(new URL('../src/builder/builder.js',import.meta.url),'utf8')).replace(/^import .+\n/gm,'');
class Element {
  constructor() { this.value=''; this.dataset={}; this.attributes={}; this.children=[]; this.listeners={}; this.hidden=false; this.disabled=false; this._text=''; this.loads=[]; this.classList={toggle(){}}; }
  set srcdoc(value) { this._srcdoc=value; this.loads.push(value); }
  get srcdoc() { return this._srcdoc; }
  set textContent(value) { this._text=String(value); this.children=[]; }
  get textContent() { return this._text + this.children.map(child=>child.textContent).join(''); }
  append(...children) { this.children.push(...children); }
  after(...children) { this.following=children; }
  prepend(...children) { this.children.unshift(...children); }
  replaceChildren(...children) { this._text=''; this.children=children; }
  setAttribute(name,value) { this.attributes[name]=String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name,handler) { (this.listeners[name] ||= []).push(handler); }
  querySelector() { return this.span ||= new Element(); }
  querySelectorAll() { return []; }
  focus() { this.focused=true; }
  async fire(name,event={}) { for(const handler of this.listeners[name] || []) await handler(event); }
}
async function workspace(fetchImpl) {
  const nodes=new Map();
  for(const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const node=new Element(); node.hidden=/\shidden(?:\s|>)/.test(match[0]); node.value=match[0].match(/\bvalue="([^"]*)"/)?.[1] || ''; nodes.set('#'+match[1],node);
  }
  const examples=[...html.matchAll(/data-starter="([^"]+)"/g)].map(match=>Object.assign(new Element(),{dataset:{starter:match[1]}}));
  const refinements=[...html.matchAll(/data-refine="([^"]+)"/g)].map(match=>Object.assign(new Element(),{dataset:{refine:match[1]}}));
  const views=['web','phone','both'].map(value=>Object.assign(new Element(),{dataset:{previewViewButton:value}}));
  const copy=new Element(),download=new Element(),exportStatus=new Element(),tools=new Element();
  tools.querySelectorAll=()=>views;
  tools.querySelector=selector=>selector==='[data-preview-copy]' ? copy : selector==='[data-preview-download]' ? download : exportStatus;
  nodes.set('[data-preview-tools]',tools);
  nodes.get('#stage').dataset.previewView='web';
  const document={querySelector:selector=>nodes.get(selector),querySelectorAll:selector=>selector==='[data-starter]' ? examples : selector==='[data-refine]' ? refinements : [...examples,...refinements],createElement:()=>new Element(),addEventListener(){}};
  const values=new Map();
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const context={document,window:{},location:{href:'https://compass.test/demo'},URL,AbortController,setTimeout,clearTimeout,TextDecoder,fetch:fetchImpl,confirm:()=>true,
    createDictation:()=>null,createPreviewTools,parseSse,cleanText,previewDoc,completedRevision,appendRevision,restoredProject,
    createProjectStore:()=>createProjectStore({storage}),
  };
  vm.runInNewContext(client+'\nglobalThis.workspace={submit,loadProject,getState:()=>state,getHistory:()=>history};',context);
  return {...context.workspace,nodes,examples,refinements,copy,download,values};
}
const page=(version=1,theme='light')=>({sessionId:'s_test',version,source:'model',placeholder:false,intent:{business:'Atelier',kind:'studio',theme,accent:'sky',font:'sans',hero:'centered',sections:['contact']},html:'<!doctype html><html><body>'+theme+' '+version+'</body></html>',pending:[],reply:'Your page is ready.'});
const json=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
const sse=events=>new Response(events.map(([event,data])=>'event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});

test('builder prevents duplicate requests while keeping the next instruction editable',async()=>{
  let resolve,calls=0;
  const pending=new Promise(done=>{resolve=done});
  const ui=await workspace(()=>{calls++;return pending});
  assert.equal(ui.nodes.get('#send').disabled,true);
  ui.nodes.get('#sd-input').value='Build an atelier page';
  await ui.nodes.get('#sd-input').fire('input');
  assert.equal(ui.nodes.get('#send').disabled,false);
  const first=ui.submit('Build an atelier page');
  assert.equal(ui.nodes.get('#send').disabled,true);
  assert.equal(ui.nodes.get('#stage').attributes['aria-busy'],'true');
  assert.equal(ui.nodes.get('#open').hidden,true);
  ui.nodes.get('#sd-input').value='Make it more minimal';
  await ui.nodes.get('#sd-input').fire('input');
  await ui.submit('Make it more minimal');
  assert.equal(calls,1);
  resolve(json(page())); await first;
  assert.equal(ui.nodes.get('#sd-input').value,'Make it more minimal');
  assert.equal(ui.nodes.get('#send').textContent,'Update page');
  assert.equal(ui.nodes.get('#send').disabled,false);
  assert.equal(ui.nodes.get('#stage').attributes['aria-busy'],'false');
  assert.equal(ui.getHistory().length,1);
  assert.equal(ui.nodes.get('#example-prompts').hidden,true);
  assert.equal(ui.nodes.get('#refine-prompts').hidden,false);
  assert.equal(ui.nodes.get('#last-reply').textContent,'Your page is ready.');
});

test('a partial stream never replaces the last complete preview or creates a saved revision',async()=>{
  let calls=0;
  const ui=await workspace(()=>++calls===1 ? json(page()) : calls===3 ? json(page(3,'dark')) : sse([
    ['state_patch',{type:'state_patch',version:2,intent:page(2,'dark').intent,patch:[]}],
    ['render',{type:'render',version:2,html:page(2,'dark').html,pending:[]}],
  ]));
  await ui.submit('Build an atelier page');
  assert.equal(ui.nodes.get('#open').hidden,false);
  const previous=ui.nodes.get('#frame').srcdoc;
  await ui.submit('Make it dark');
  assert.equal(ui.nodes.get('#frame').srcdoc,previous);
  assert.equal(ui.getState().plan.version,1);
  assert.equal(ui.getState().source,'model');
  assert.equal(ui.getHistory().length,1);
  assert.equal(ui.nodes.get('#sd-input').value,'Make it dark');
  assert.match(ui.nodes.get('#notice').textContent,/Connection ended early.*Previous preview kept/);
  assert.equal(ui.nodes.get('#notice').attributes.role,'alert');
  assert.equal(ui.nodes.get('#send').disabled,false);
  assert.equal(ui.copy.disabled,false);
  assert.equal(ui.nodes.get('#open').hidden,true);
  assert.equal(ui.nodes.get('#open').attributes.href,undefined);
  await ui.submit('Make it dark again');
  assert.equal(ui.nodes.get('#open').hidden,false);
  assert.equal(ui.getHistory().length,2);
});

test('network and server failures retain the instruction, recover controls and never invent a preview',async()=>{
  let calls=0;
  const ui=await workspace(()=>{
    if(++calls===1)throw Error('offline');
    return new Response(JSON.stringify({error:'unavailable'}),{status:503,headers:{'content-type':'application/json'}});
  });
  await ui.submit('Build an atelier page');
  assert.equal(ui.getHistory().length,0);
  assert.equal(ui.nodes.get('#empty').hidden,false);
  assert.equal(ui.nodes.get('#preview-phase').hidden,true);
  assert.match(ui.nodes.get('#notice').textContent,/Connection lost/);
  assert.doesNotMatch(ui.nodes.get('#notice').textContent,/previous/i);
  assert.equal(ui.nodes.get('#sd-input').value,'Build an atelier page');
  await ui.submit(ui.nodes.get('#sd-input').value);
  assert.match(ui.nodes.get('#notice').textContent,/Update interrupted/);
  assert.equal(ui.nodes.get('#send').disabled,false);
});

test('text examples only fill the composer, and saved projects reopen without a request',async()=>{
  let calls=0;
  const ui=await workspace(()=>{calls++;return json(page())});
  await ui.examples[0].fire('click');
  assert.match(ui.nodes.get('#sd-input').value,/real estate/i);
  assert.equal(calls,0);
  await ui.submit(ui.nodes.get('#sd-input').value);
  await ui.refinements[2].fire('click');
  assert.match(ui.nodes.get('#sd-input').value,/mobile layout/);
  assert.equal(calls,1);
  await ui.nodes.get('#save-project').fire('click');
  assert.equal(ui.values.size,1);
  const saved=JSON.parse([...ui.values.values()][0]).projects[0];
  ui.loadProject(saved);
  assert.equal(calls,1);
  assert.equal(ui.nodes.get('#preview-source').textContent,'Saved preview');
  assert.equal(ui.nodes.get('#send').disabled,true);
  const historyButton=ui.nodes.get('#history-list').children[0].children[0];
  await historyButton.fire('click');
  assert.equal(ui.nodes.get('#sd-input').disabled,true);
  await ui.nodes.get('#history-current').fire('click');
  assert.equal(ui.nodes.get('#sd-input').disabled,false);
  assert.equal(ui.getHistory().length,1);
});

test('rate-limit fallback stays labelled, exportable and part of completed history',async()=>{
  const ui=await workspace(()=>new Response(JSON.stringify({fallback:{...page(),source:'prepared',placeholder:true}}),{status:429,headers:{'content-type':'application/json'}}));
  await ui.submit('Build an atelier page');
  assert.equal(ui.nodes.get('#preview-source').textContent,'Prepared copy');
  assert.match(ui.nodes.get('#notice').textContent,/prepared preview/);
  assert.equal(ui.getHistory().length,1);
  assert.equal(ui.copy.disabled,false);
  assert.equal(ui.download.disabled,false);
});

test('streamed partial renders cannot borrow the previous live-model badge',async()=>{
  let calls=0,stream;
  const encoder=new TextEncoder();
  const response=new Response(new ReadableStream({start(controller){stream=controller}}),{headers:{'content-type':'text/event-stream'}});
  const ui=await workspace(()=>++calls===1 ? json(page()) : response);
  await ui.submit('Build an atelier page');
  const pending=ui.submit('Make it dark');
  stream.enqueue(encoder.encode('event: reasoning_status\ndata: {"type":"reasoning_status","stage":"interpreting"}\n\n'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ui.nodes.get('#preview-source').hidden,false);
  stream.enqueue(encoder.encode('event: render\ndata: '+JSON.stringify({type:'render',version:2,html:page(2,'dark').html,pending:[]})+'\n\n'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(ui.nodes.get('#frame').srcdoc,/dark 2/);
  assert.equal(ui.nodes.get('#preview-source').hidden,true);
  stream.enqueue(encoder.encode('event: result\ndata: '+JSON.stringify({...page(2,'dark'),source:'prepared',placeholder:true})+'\n\n'));
  stream.close(); await pending;
  assert.equal(ui.nodes.get('#preview-source').hidden,false);
  assert.equal(ui.nodes.get('#preview-source').textContent,'Prepared copy');
});

test('one packet or JSON replay navigates each iframe only to the final document',async()=>{
  const final=page();
  const events=[
    {type:'state_patch',version:1,intent:final.intent,patch:[]},
    {type:'render',version:1,html:'<!doctype html><p>Pending</p>',pending:['hero']},
    {type:'render',version:1,html:final.html,pending:[]},
  ];
  for(const mode of ['stream','json']) {
    const ui=await workspace(()=>mode==='stream'
      ? sse([...events.map(event=>[event.type,event]),['result',final]])
      : json({...final,events}));
    await ui.submit('Build an atelier page');
    for(const selector of ['#frame','#phone-frame']) {
      assert.equal(ui.nodes.get(selector).loads.length,1,mode+' '+selector);
      assert.match(ui.nodes.get(selector).srcdoc,/light 1/);
    }
    assert.equal(ui.getHistory().length,1);
    assert.equal(ui.nodes.get('#preview-source').textContent,'Live model');
    assert.equal(ui.nodes.get('#preview-phase').hidden,true);
  }
});

test('a resumed project retains its seed when the stream fails after its result frame',async()=>{
  let calls=0;
  const bodies=[];
  const encoder=new TextEncoder();
  const ui=await workspace((_path,options)=>{
    bodies.push(JSON.parse(options.body));
    if(++calls!==2)return json(page(calls));
    let read=0;
    return {ok:true,status:200,headers:new Headers({'content-type':'text/event-stream'}),body:{getReader:()=>({read:()=>++read===1
      ? Promise.resolve({done:false,value:encoder.encode('event: result\ndata: '+JSON.stringify(page(1,'dark'))+'\n\n')})
      : Promise.reject(Error('stream failed after result'))})}};
  });
  await ui.submit('Build an atelier page');
  await ui.nodes.get('#save-project').fire('click');
  const saved=JSON.parse([...ui.values.values()][0]).projects[0];
  ui.loadProject(saved);
  const previous=ui.nodes.get('#frame').srcdoc;
  await ui.submit('Make it dark');
  assert.equal(ui.nodes.get('#frame').srcdoc,previous);
  assert.equal(ui.nodes.get('#preview-source').textContent,'Saved preview');
  assert.equal(ui.getHistory().length,1);
  assert.equal(ui.nodes.get('#sd-input').value,'Make it dark');
  await ui.submit(ui.nodes.get('#sd-input').value);
  assert.equal(bodies[1].sessionId,undefined);
  assert.equal(bodies[2].sessionId,undefined);
  assert.deepEqual(bodies[1].resumeIntent,saved.revisions[0].plan.intent);
  assert.deepEqual(bodies[2].resumeIntent,saved.revisions[0].plan.intent);
  assert.equal(ui.getHistory().length,2);
});
