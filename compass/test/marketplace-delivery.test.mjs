import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {runInNewContext} from 'node:vm';
import {parse} from 'parse5';
import {build} from 'esbuild';
import {getTemplateBundle,NATIVE_DEPENDENCIES} from '../marketplace/delivery.mjs';
import {TEMPLATE_CATALOG} from '../marketplace/catalog.mjs';
import {renderTemplatePreview,templatePreviewScript} from '../marketplace/preview.mjs';

const exec=promisify(execFile),sha=value=>createHash('sha256').update(value).digest('hex');
const childEnv={...process.env};delete childEnv.NODE_TEST_CONTEXT;
const editions=TEMPLATE_CATALOG.flatMap(template=>template.formats.map(format=>({id:template.id,format})));
const content=(bundle,path)=>bundle.files.find(file=>file.path===path)?.content;
async function unpack(bundle,root) {
  for(const file of bundle.files){const path=join(root,file.path);await mkdir(dirname(path),{recursive:true});await writeFile(path,file.content);}
}

test('nine original source editions have reproducible file digests and honest delivery manifests',()=>{
  assert.equal(editions.length,9);
  for(const {id,format} of editions) {
    const bundle=getTemplateBundle(id,format),again=getTemplateBundle(id,format);
    assert.deepEqual(bundle,again);
    assert.equal(bundle.previewOnly,true);assert.equal(bundle.paymentsEnabled,false);
    assert.equal(bundle.manifest.orderActivated,false);assert.equal(bundle.manifest.licenseStatus,'preview-only');
    assert.equal(bundle.manifest.author,'AX Media Global');
    assert.deepEqual(bundle.manifest.servicesIncluded,[]);
    assert.equal(bundle.manifest.verification.nativeBuild,'unverified');assert.equal(bundle.manifest.verification.physicalDevices,'unverified');
    assert.equal(new Set(bundle.files.map(file=>file.path)).size,bundle.files.length);
    assert.equal(bundle.bytes,bundle.files.reduce((total,file)=>total+Buffer.byteLength(file.content),0));
    assert.equal(bundle.sha256,sha(JSON.stringify(bundle.files.map(({path,sha256})=>({path,sha256})))));
    for(const file of bundle.files) {
      assert.equal(file.bytes,Buffer.byteLength(file.content));assert.equal(file.sha256,sha(file.content));
      assert.ok(!file.path.split('/').includes('..'));assert.ok(!file.path.startsWith('/'));
      assert.doesNotMatch(file.path,/(?:^|\/)(?:\.env|node_modules|\.git)(?:\/|$)/);
    }
    for(const entry of bundle.manifest.files) {
      const actual=bundle.files.find(file=>file.path===entry.path);
      assert.equal(entry.sha256,actual.sha256);assert.equal(entry.bytes,actual.bytes);
    }
    assert.deepEqual(JSON.parse(content(bundle,'manifest.json')),bundle.manifest);
    assert.match(content(bundle,'LICENSE.txt'),/PREVIEW ONLY/);
    assert.match(content(bundle,'README.md'),/Payments are disabled/);
    const pkg=JSON.parse(content(bundle,'package.json'));
    assert.equal(pkg.private,true);assert.equal(pkg.license,'UNLICENSED');
    if(format==='ios-android') {
      assert.deepEqual(pkg.dependencies,NATIVE_DEPENDENCIES);
      assert.equal(pkg.main,'index.js');assert.match(content(bundle,'App.jsx'),/from 'react-native'/);
      assert.doesNotMatch(content(bundle,'App.jsx'),/WebView|<iframe|<html|fetch\(/);
      assert.match(content(bundle,'DEPENDENCIES.md'),/expo\/expo\/sdk-58/);
      assert.match(content(bundle,'README.md'),/native compilation, simulators and physical iOS\/Android devices have not been verified/);
    } else {
      assert.equal(content(bundle,'index.html'),renderTemplatePreview(id));
      assert.equal(pkg.dependencies,undefined);
      assert.match(content(bundle,'README.md'),/No backend, login, cloud storage/);
    }
  }
  const changed=getTemplateBundle('pulse','ios-android');
  changed.manifest.capabilities.push('not real');
  changed.files[0].content='changed';
  assert.ok(!getTemplateBundle('pulse','ios-android').manifest.capabilities.includes('not real'));
});

test('delivery accepts only catalog IDs and their exact supported formats',()=>{
  for(const id of [null,{},'../atlas','__proto__','constructor','ATLAS','atlas/../../.env'])assert.throws(()=>getTemplateBundle(id,'website'),error=>error.code==='template_not_found');
  for(const [id,format] of [['atlas','ios-android'],['pulse','website'],['pulse','native'],['atlas',null],['atlas',{}]])assert.throws(()=>getTemplateBundle(id,format),error=>error.code==='template_format_unavailable');
});

test('every unpacked package runs its included dependency-free tests',async t=>{
  const root=await mkdtemp(join(tmpdir(),'compass-marketplace-delivery-'));
  try {
    for(const {id,format} of editions)await t.test(id+' '+format,async()=>{
      const bundle=getTemplateBundle(id,format),directory=join(root,id+'-'+format);
      await unpack(bundle,directory);
      const args=['--test','--test-reporter=tap',format==='ios-android'?'state.test.mjs':'test/source.test.mjs'];
      const result=await exec(process.execPath,args,{cwd:directory,timeout:10000,env:childEnv});
      assert.match(result.stdout,/# fail 0/);
      if(format!=='ios-android')await exec(process.execPath,['--check','serve.mjs'],{cwd:directory,timeout:10000});
    });
  } finally {await rm(root,{recursive:true,force:true});}
});

test('all three native entrypoints bundle as real JSX source with only declared Expo/React Native externals',async()=>{
  const root=await mkdtemp(join(tmpdir(),'compass-native-source-'));
  try {
    for(const id of ['pulse','field','venue']) {
      const bundle=getTemplateBundle(id,'ios-android'),directory=join(root,id);
      await unpack(bundle,directory);
      const result=await build({entryPoints:[join(directory,'index.js')],bundle:true,write:false,platform:'neutral',format:'esm',jsx:'transform',external:Object.keys(NATIVE_DEPENDENCIES),logLevel:'silent',metafile:true});
      assert.equal(result.errors.length,0);
      assert.equal(result.outputFiles.length,1);
      const inputs=Object.keys(result.metafile.inputs);
      for(const path of ['App.jsx','state.mjs','template.mjs'])assert.ok(inputs.some(value=>value.endsWith('/'+path)),path);
      assert.ok(result.outputFiles[0].text.length>10000);
      const config=JSON.parse(await readFile(join(directory,'app.json'),'utf8')).expo;
      assert.deepEqual(config.platforms,['ios','android']);
      assert.equal(config.slug,'compass-'+id);
    }
  } finally {await rm(root,{recursive:true,force:true});}
});

// Execute the exact exported HTML's reviewed script against its parsed markup.
// No browser APIs for storage or network are supplied to the VM.
class Element {
  constructor(tag,attrs=[],text='') {this.tagName=tag;this.attrs=new Map(attrs.map(({name,value})=>[name,value]));this.children=[];this.parentElement=null;this.value='';this.text=text;this.hidden=this.attrs.has('hidden');this.disabled=this.attrs.has('disabled');this.style={};this.events=new Map();}
  get textContent(){return this.text+this.children.map(child=>child.textContent).join('');}
  set textContent(value){this.text=String(value);this.children=[];}
  get dataset(){return Object.fromEntries([...this.attrs].filter(([key])=>key.startsWith('data-')).map(([key,value])=>[key.slice(5),value]));}
  getAttribute(name){return this.attrs.get(name)??null;}
  setAttribute(name,value){this.attrs.set(name,String(value));}
  append(node){node.parentElement=this;this.children.push(node);}
  querySelectorAll(selector){return descendants(this).filter(node=>selector==='button'?node.tagName==='button':selector.startsWith('[data-')?node.attrs.has(selector.slice(1,-1)):false);}
  addEventListener(name,fn){const handlers=this.events.get(name)||[];handlers.push(fn);this.events.set(name,handlers);}
  fire(name){if(this.disabled&&name==='click')return;for(const fn of this.events.get(name)||[])fn({preventDefault(){}});}
}
const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
function exportedDOM(id) {
  const html=content(getTemplateBundle(id,'mobile-web'),'index.html');
  const copy=raw=>{const node=new Element(raw.tagName||raw.nodeName,raw.attrs,raw.value||'');for(const child of raw.childNodes||[])node.append(copy(child));return node;};
  const root=copy(parse(html)),nodes=descendants(root),scripts=nodes.filter(node=>node.tagName==='script');
  assert.equal(scripts.length,1);assert.equal(scripts[0].textContent,templatePreviewScript(id));
  const document={getElementById:id=>nodes.find(node=>node.getAttribute('id')===id)||null,querySelectorAll:selector=>root.querySelectorAll(selector),createElement:tag=>new Element(tag)};
  runInNewContext(scripts[0].textContent,{document},{timeout:1000});
  return document;
}
test('delivered mobile web editions actually run habit/task/booking interactions in the exported document',()=>{
  const pulse=exportedDOM('pulse');
  pulse.getElementById('habit-list').querySelectorAll('button')[0].fire('click');
  assert.equal(pulse.getElementById('habit-count').textContent,'1 of 3');
  pulse.getElementById('habit-input').value='<b>Editable habit</b>';
  pulse.getElementById('habit-form').fire('submit');
  assert.equal(pulse.getElementById('habit-count').textContent,'1 of 4');
  assert.equal(pulse.getElementById('habit-list').children[3].children[0].textContent,'<b>Editable habit</b>');
  const field=exportedDOM('field');
  field.getElementById('task-list').querySelectorAll('button')[0].fire('click');
  field.querySelectorAll('[data-filter]').find(node=>node.dataset.filter==='open').fire('click');
  assert.equal(field.getElementById('task-list').children[0].hidden,true);
  const venue=exportedDOM('venue');
  venue.querySelectorAll('[data-service]')[1].fire('click');
  venue.querySelectorAll('[data-time]')[2].fire('click');
  venue.getElementById('booking-review').fire('click');
  assert.equal(venue.getElementById('summary-service').textContent,'Project consultation');
  assert.equal(venue.getElementById('summary-time').textContent,'14:00');
  assert.equal(venue.getElementById('booking-summary').hidden,false);
  venue.getElementById('booking-edit').fire('click');
  assert.equal(venue.getElementById('booking-summary').hidden,true);
});
