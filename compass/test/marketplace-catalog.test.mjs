import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {createHash} from 'node:crypto';
import {parse} from 'parse5';
import {TEMPLATE_CATALOG,getTemplate,filterTemplates} from '../marketplace/catalog.mjs';
import {renderTemplatePreview,templatePreviewScript} from '../marketplace/preview.mjs';

// Use the real preview markup to give the fixed scripts a small, network-free
// DOM. This verifies their state changes without executing arbitrary source.
class Element {
  constructor(tag,attrs=[],text='') {this.tagName=tag;this.attributes=new Map(attrs.map(({name,value})=>[name,value]));this.children=[];this.parentElement=null;this.value='';this._text=text;this.hidden=this.attributes.has('hidden');this.disabled=this.attributes.has('disabled');this.style={};this.events=new Map();}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  set textContent(value){this._text=String(value);this.children=[];}
  get dataset(){return Object.fromEntries([...this.attributes].filter(([key])=>key.startsWith('data-')).map(([key,value])=>[key.slice(5),value]));}
  getAttribute(name){return this.attributes.get(name)??null;}
  setAttribute(name,value){this.attributes.set(name,String(value));}
  append(node){node.parentElement=this;this.children.push(node);}
  querySelectorAll(selector){return descendants(this).filter(node=>selector==='button'?node.tagName==='button':selector.startsWith('[data-')?node.attributes.has(selector.slice(1,-1)):false);}
  addEventListener(name,handler){const handlers=this.events.get(name)||[];handlers.push(handler);this.events.set(name,handlers);}
  fire(name){if(this.disabled && name==='click')return;let prevented=false;for(const handler of this.events.get(name)||[])handler({preventDefault(){prevented=true;}});return prevented;}
}
function descendants(node){return node.children.flatMap(child=>[child,...descendants(child)]);}
function parsed(id){return parse(renderTemplatePreview(id));}
function rawNodes(node){return [node,...(node.childNodes||[]).flatMap(rawNodes)];}
function isHidden(node){for(let parent=node;parent;parent=parent.parentNode)if((parent.attrs||[]).some(attr=>attr.name==='hidden'))return true;return false;}
function dom(id){
  function copy(raw){const node=new Element(raw.tagName||raw.nodeName,raw.attrs,raw.value||'');for(const child of raw.childNodes||[])node.append(copy(child));return node;}
  const root=copy(parsed(id)),document={getElementById:id=>descendants(root).find(node=>node.getAttribute('id')===id)||null,querySelectorAll:selector=>root.querySelectorAll(selector),createElement:tag=>new Element(tag)};
  runInNewContext(templatePreviewScript(id),{document},{timeout:1000});
  return {...document,all:selector=>document.querySelectorAll(selector)};
}

test('six original template families expose immutable formats and no active commerce',()=>{
  assert.deepEqual(TEMPLATE_CATALOG.map(template=>template.id),['atlas','forma','mono','pulse','field','venue']);
  assert.ok(Object.isFrozen(TEMPLATE_CATALOG));
  for(const template of TEMPLATE_CATALOG){
    assert.ok(Object.isFrozen(template));assert.ok(Object.isFrozen(template.features));assert.ok(Object.isFrozen(template.formats));
    assert.ok(template.description.length>10 && template.description.length<=90);
    assert.match(template.accent,/^#[0-9a-f]{6}$/);
    assert.equal(template.price,null);assert.equal(template.purchaseEnabled,false);
    assert.deepEqual(template.formats,template.kind==='website'?['website']:['mobile-web','ios-android']);
    assert.equal(template.features.length,3);
    assert.ok(!Object.keys(template).some(key=>/reviews|rating|orders|sales|purchases/i.test(key)));
  }
  assert.throws(()=>TEMPLATE_CATALOG[0].features.push('Payments'),TypeError);
});

test('catalog lookup and search are bounded, case-insensitive and deny unknown/prototype IDs',()=>{
  assert.equal(filterTemplates({kind:'website'}).length,3);assert.equal(filterTemplates({kind:'mobile'}).length,3);
  assert.deepEqual(filterTemplates({query:' HABITS '}).map(template=>template.id),['pulse']);
  assert.deepEqual(filterTemplates({kind:'website',query:'habits'}),[]);
  assert.deepEqual(filterTemplates({kind:'native'}),[]);assert.deepEqual(filterTemplates({query:{}}),[]);
  for(const id of [null,{},'__proto__','constructor','toString','../atlas','Atlas']){
    assert.equal(getTemplate(id),null);assert.equal(renderTemplatePreview(id),null);assert.equal(templatePreviewScript(id),null);
  }
  assert.equal(getTemplate('atlas'),TEMPLATE_CATALOG[0]);
  const result=filterTemplates();result.pop();assert.equal(TEMPLATE_CATALOG.length,6);
});

test('preview HTML is stable, complete and self-contained with only exact reviewed mobile scripts',()=>{
  const pages=new Set();
  for(const template of TEMPLATE_CATALOG){
    const html=renderTemplatePreview(template.id),nodes=rawNodes(parsed(template.id)),script=templatePreviewScript(template.id);
    assert.equal(typeof html,'string');assert.equal(renderTemplatePreview(template.id),html);pages.add(html);
    assert.ok(html.startsWith('<!doctype html>'));assert.ok(html.length<35000);
    assert.equal(nodes.filter(node=>node.tagName==='style').length,1);
    assert.equal(nodes.filter(node=>node.tagName==='h1'&&!isHidden(node)).length,1);
    const scripts=nodes.filter(node=>node.tagName==='script');assert.equal(scripts.length,template.kind==='mobile'?1:0);
    assert.equal(script,template.kind==='mobile'?scripts[0].childNodes.map(node=>node.value||'').join(''):null);
    if(script){assert.equal(createHash('sha256').update(script).digest('hex'),createHash('sha256').update(templatePreviewScript(template.id)).digest('hex'));assert.doesNotMatch(script,/\b(?:fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|eval|Function|innerHTML|postMessage)\b/);}
    assert.doesNotMatch(html,/@import|url\(|<iframe|<object|<embed|<img|<link\s/i);
    const ids=nodes.flatMap(node=>(node.attrs||[]).filter(attr=>attr.name==='id').map(attr=>attr.value));assert.equal(new Set(ids).size,ids.length);
    for(const node of nodes){
      for(const attr of node.attrs||[]){assert.ok(!attr.name.startsWith('on'));assert.notEqual(attr.name,'src');if(attr.name==='href'){assert.ok(attr.value.startsWith('#'));assert.ok(ids.includes(attr.value.slice(1)),attr.value);}}
      if(node.tagName==='form')assert.ok(!(node.attrs||[]).some(attr=>attr.name==='action'));
    }
  }
  assert.equal(pages.size,6);
});

test('website templates use distinct original art and real in-page navigation without executable scripts',()=>{
  for(const [id,section] of [['atlas','studio'],['forma','services'],['mono','features']]){
    const html=renderTemplatePreview(id);
    assert.equal(templatePreviewScript(id),null);assert.ok(html.includes(`id="${section}"`));assert.ok(html.includes('id="contact"'));
    assert.doesNotMatch(html,/customer reviews|trusted by|\$|checkout|buy now|lorem ipsum/i);
  }
  assert.match(renderTemplatePreview('atlas'),/Original architectural study/);
  assert.match(renderTemplatePreview('forma'),/Original blue sphere/);
  assert.match(renderTemplatePreview('mono'),/Product concept/);
});

test('Pulse toggles real habits, safely adds bounded text and resets only local progress',()=>{
  const ui=dom('pulse'),list=ui.getElementById('habit-list'),input=ui.getElementById('habit-input');
  list.querySelectorAll('button')[0].fire('click');assert.equal(ui.getElementById('habit-count').textContent,'1 of 3');assert.equal(ui.getElementById('habit-progress').style.width,(100/3)+'%');
  input.value='<img src=x onerror=alert(1)>';assert.equal(ui.getElementById('habit-form').fire('submit'),true);
  assert.equal(list.children.length,4);assert.equal(list.children[3].children[0].textContent,'<img src=x onerror=alert(1)>');assert.equal(list.children[3].children[0].children.length,0);
  assert.equal(input.value,'');assert.equal(ui.getElementById('habit-count').textContent,'1 of 4');
  for(let i=0;i<20;i++){input.value='A small habit';ui.getElementById('habit-form').fire('submit');}
  assert.equal(list.children.length,12);assert.match(ui.getElementById('habit-status').textContent,/Up to 12/);
  ui.getElementById('habit-reset').fire('click');assert.equal(ui.getElementById('habit-count').textContent,'0 of 12');assert.equal(ui.getElementById('habit-progress').style.width,'0%');
  assert.match(renderTemplatePreview('pulse'),/stays in this preview/);
});

test('Field filters completed tasks and safely adds new tasks without losing the local list',()=>{
  const ui=dom('field'),list=ui.getElementById('task-list'),filters=ui.all('[data-filter]');
  list.querySelectorAll('button')[0].fire('click');assert.equal(ui.getElementById('task-count').textContent,'2 things to move forward.');
  filters.find(button=>button.dataset.filter==='open').fire('click');assert.equal(list.children[0].hidden,true);assert.equal(list.children[1].hidden,false);
  filters.find(button=>button.dataset.filter==='done').fire('click');assert.equal(list.children[0].hidden,false);assert.equal(list.children[1].hidden,true);
  list.querySelectorAll('button')[0].fire('click');assert.equal(ui.getElementById('task-empty').hidden,false);
  ui.getElementById('task-input').value='<script>never execute</script>';ui.getElementById('task-form').fire('submit');
  assert.equal(list.children.length,4);assert.equal(list.children[3].children[0].textContent,'<script>never execute</script>');assert.equal(list.children[3].hidden,false);assert.equal(ui.getElementById('task-empty').hidden,true);
  assert.equal(filters.find(button=>button.dataset.filter==='all').getAttribute('aria-pressed'),'true');
  for(let i=0;i<35;i++){ui.getElementById('task-input').value='One step';ui.getElementById('task-form').fire('submit');}
  assert.equal(list.children.length,30);assert.match(ui.getElementById('task-status').textContent,/Up to 30/);
});

test('Venue reviews the actual chosen service/day/time while clearly making no reservation',()=>{
  const ui=dom('venue'),review=ui.getElementById('booking-review');
  assert.equal(review.disabled,true);review.fire('click');assert.equal(ui.getElementById('booking-summary').hidden,true);
  ui.all('[data-service]')[1].fire('click');ui.all('[data-day]')[3].fire('click');ui.all('[data-time]')[2].fire('click');
  assert.equal(review.disabled,false);review.fire('click');
  assert.equal(ui.getElementById('summary-service').textContent,'Project consultation');assert.equal(ui.getElementById('summary-day').textContent,'Thu 19');assert.equal(ui.getElementById('summary-time').textContent,'14:00');
  assert.equal(ui.getElementById('booking-editor').hidden,true);assert.equal(ui.getElementById('booking-summary').hidden,false);
  ui.getElementById('booking-edit').fire('click');assert.equal(ui.getElementById('booking-editor').hidden,false);assert.equal(ui.getElementById('booking-summary').hidden,true);
  assert.match(renderTemplatePreview('venue'),/does not make a reservation/);assert.doesNotMatch(renderTemplatePreview('venue'),/booking confirmed|reservation confirmed/i);
});
