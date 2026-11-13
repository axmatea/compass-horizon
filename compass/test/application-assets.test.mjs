import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {deflateSync} from 'node:zlib';
import {randomBytes,createHash} from 'node:crypto';
import {readFile,mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createApplicationManifest,validateApplicationManifest,createApplicationBundle,createApplicationFileMetadata,exportApplicationZip,renderApplicationPreview} from '../generation/index.mjs';
import {inspectImage,imageCrc32,ASSET_LIMITS} from '../generation/image.mjs';
import {createPlatformStore} from '../platform/store.mjs';

export function png({width=2,height=2,random=false,extra,compressed}={}){
  const chunk=(type,value)=>{const out=Buffer.alloc(value.length+12);out.writeUInt32BE(value.length);out.write(type,4);value.copy(out,8);out.writeUInt32BE(imageCrc32(out.subarray(4,out.length-4)),out.length-4);return out};
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  const pixels=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++)if(random)randomBytes(width*4).copy(pixels,y*(width*4+1)+1);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),...(extra?[chunk('tEXt',Buffer.from(extra))]:[]),chunk('IDAT',compressed||deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
const code=value=>error=>error.code===value;
function fixture(t){const database=new DatabaseSync(':memory:');t.after(()=>database.close());return{database,store:createPlatformStore(database)}}
const create=(store,owner='owner_a')=>store.createApplication(owner,createApplicationManifest('A task tracker called Orbit'),'Original task idea');

test('PNG/JPEG validation checks structure, dimensions, payload bounds and strips metadata',async()=>{
  const input=png({extra:'private metadata'}),image=inspectImage(input,'image/png');assert.equal(image.width,2);assert.equal(image.height,2);assert.ok(image.bytes<input.length);assert.ok(!image.data.includes(Buffer.from('private metadata')));
  const jpeg=inspectImage(await readFile(new URL('../public/assets/og.jpg',import.meta.url)),'image/jpeg');assert.ok(jpeg.width*jpeg.height<=ASSET_LIMITS.pixels);assert.equal(jpeg.mime,'image/jpeg');
  assert.throws(()=>inspectImage(Buffer.from('<svg onload=alert(1)>'),'image/png'),code('invalid_image'));assert.throws(()=>inspectImage(input,'image/svg+xml'),code('image_type_unsupported'));
  const bad=Buffer.from(input);bad[bad.length-1]^=1;assert.throws(()=>inspectImage(bad,'image/png'),code('invalid_image'));
  assert.throws(()=>inspectImage(Buffer.alloc(ASSET_LIMITS.fileBytes+1),'image/png'),code('asset_file_too_large'));
  assert.throws(()=>inspectImage(png({width:5001,height:1001}),'image/png'),code('image_dimensions_exceeded'));
  assert.throws(()=>inspectImage(png({compressed:deflateSync(Buffer.alloc(1000000))}),'image/png'),code('invalid_image'));
  assert.throws(()=>inspectImage(Buffer.concat([image.data,Buffer.from('<html>')]),'image/png'),code('invalid_image'));
});

test('strict manifest editing is canonical, bounded and only permits image asset IDs',()=>{
  const value=createApplicationManifest('A task tracker');assert.deepEqual(validateApplicationManifest({...value,assets:{}}),value);
  assert.equal(validateApplicationManifest({...value,script:'alert(1)'}),null);assert.equal(validateApplicationManifest({...value,theme:{...value.theme,css:'x'}}),null);
  assert.equal(validateApplicationManifest({...value,assets:{hero:'https://example.com/a.png'}}),null);assert.equal(validateApplicationManifest({...value,assets:{html:'asset_test'}}),null);
  assert.ok(validateApplicationManifest({...value,assets:{logo:'asset_test'}}));
});

test('asset revisions enforce owner/app/version and retain actual bytes for restore without changing records',t=>{
  const {database,store}=fixture(t);const a=create(store),b=create(store,'owner_b');
  const record=store.saveRecord('owner_a',a.id,{title:'Kept record',status:'To do'});
  const uploaded=store.saveAsset('owner_a',a.id,png(),'image/png',1);assert.equal(uploaded.application.version,2);assert.equal(uploaded.asset.bytes,png().length);
  assert.throws(()=>store.getAsset('owner_b',a.id,uploaded.asset.id),code('not_found'));assert.throws(()=>store.getAsset('owner_b',b.id,uploaded.asset.id),code('not_found'));
  assert.throws(()=>store.saveAsset('owner_a',a.id,png(),'image/png',1),code('version_conflict'));
  const selected=store.updateApplication('owner_a',a.id,{...a.manifest,assets:{logo:uploaded.asset.id}},'Use logo','prepared',2);assert.equal(selected.version,3);
  assert.throws(()=>store.deleteAsset('owner_a',a.id,uploaded.asset.id,3),code('asset_in_use'));
  assert.throws(()=>store.updateApplication('owner_b',b.id,{...b.manifest,assets:{hero:uploaded.asset.id}},'Steal image','prepared',1),code('asset_reference_missing'));
  const unchanged=store.updateApplication('owner_a',a.id,selected.manifest,'No change','prepared',3);assert.equal(unchanged.version,3);
  const cleared=store.updateApplication('owner_a',a.id,{...selected.manifest,assets:{}},'Remove logo','prepared',3);assert.equal(cleared.version,4);
  const deleted=store.deleteAsset('owner_a',a.id,uploaded.asset.id,4);assert.equal(deleted.application.version,5);assert.equal(store.listAssets('owner_a',a.id).assets.length,0);assert.equal(store.listAssets('owner_a',a.id).quota.retainedFiles,1);
  const restored=store.restore('owner_a',a.id,3);assert.equal(restored.version,6);assert.equal(restored.manifest.assets.logo,uploaded.asset.id);assert.ok(store.getAsset('owner_a',a.id,uploaded.asset.id).data.equals(png()));
  assert.equal(store.listRecords('owner_a',a.id)[0].id,record.id);assert.equal(store.listRecords('owner_a',a.id)[0].data.title,'Kept record');
  const history=store.revisions('owner_a',a.id);assert.ok(history[0].files.every(file=>/^[a-f0-9]{64}$/.test(file.sha256)));assert.ok(history.find(r=>r.version===2).changes.some(file=>file.path.endsWith('.png')&&file.type==='added'));assert.ok(history.find(r=>r.version===5).changes.some(file=>file.path.endsWith('.png')&&file.type==='removed'));
});

test('asset quotas count retained bytes, cap active files and prune bytes only after their last retained revision',t=>{
  const {database,store}=fixture(t),app=create(store);let version=1;const ids=[];
  for(let i=0;i<8;i++){const result=store.saveAsset('owner_a',app.id,png(),'image/png',version);version=result.application.version;ids.push(result.asset.id)}
  assert.throws(()=>store.saveAsset('owner_a',app.id,png(),'image/png',version),code('asset_file_limit'));
  version=store.deleteAsset('owner_a',app.id,ids[0],version).application.version;assert.equal(store.listAssets('owner_a',app.id).quota.retainedFiles,8);
  for(let i=0;i<17;i++)version=store.updateApplication('owner_a',app.id,{...app.manifest,title:'Revision '+i},'Edit','prepared',version).version;
  assert.equal(database.prepare('SELECT count(*) AS n FROM compass_application_asset WHERE id=?').get(ids[0]).n,0);assert.equal(store.revisions('owner_a',app.id).length,16);
});

test('actual image bytes enforce application and owner storage bounds including deleted history images',t=>{
  const {store}=fixture(t),image=png({width:360,height:360,random:true});assert.ok(image.length<ASSET_LIMITS.fileBytes);
  let first,lastAsset;
  for(let appNumber=0;appNumber<4;appNumber++){
    const app=create(store);let version=1;for(let n=0;n<8;n++){const result=store.saveAsset('owner_a',app.id,image,'image/png',version);version=result.application.version;lastAsset=result.asset}
    if(!first)first={app,version,lastAsset};
  }
  const removed=store.deleteAsset('owner_a',first.app.id,first.lastAsset.id,first.version);
  assert.throws(()=>store.saveAsset('owner_a',first.app.id,image,'image/png',removed.application.version),code('asset_application_quota'));
  const fifth=create(store);assert.throws(()=>store.saveAsset('owner_a',fifth.id,image,'image/png',1),code('asset_owner_quota'));
});

test('source and ZIP contain exact image bytes, deterministic receipts and no auth/account values',async t=>{
  const {store}=fixture(t),app=create(store),upload=store.saveAsset('owner_a',app.id,png(),'image/png',1),manifest={...app.manifest,assets:{logo:upload.asset.id,hero:upload.asset.id}};
  store.updateApplication('owner_a',app.id,manifest,'Select images','prepared',2);const assets=store.activeAssets('owner_a',app.id);
  const bundle=await createApplicationBundle(manifest,{assets}),image=bundle.files.find(file=>file.encoding==='base64');assert.ok(image);assert.ok(Buffer.from(image.content,'base64').equals(png()));assert.ok(bundle.files.some(file=>file.path==='assets.json'));
  const receipt=createApplicationFileMetadata(manifest,{assets}).find(file=>file.path===image.path);assert.equal(receipt.sha256,createHash('sha256').update(png()).digest('hex'));assert.equal(receipt.bytes,png().length);
  const zip=exportApplicationZip(bundle);assert.ok(zip.includes(png()));assert.ok(!JSON.stringify(bundle).includes('owner_a'));
  const preview=await renderApplicationPreview(manifest);assert.ok(preview.includes("request('asset',{assetId})"));assert.ok(preview.includes("img-src data:"));assert.ok(!preview.includes('fetch('));
  const script=preview.match(/<script>([\s\S]*)<\/script><\/body>/)[1];assert.ok(preview.includes('sha256-'+createHash('sha256').update(script).digest('base64')));
});

test('exported image bundle runs the real trusted app and enforces image session/continuity checks',async t=>{
  const {store}=fixture(t),app=create(store),upload=store.saveAsset('owner_a',app.id,png(),'image/png',1),manifest={...app.manifest,assets:{hero:upload.asset.id,logo:upload.asset.id}};
  const bundle=await createApplicationBundle(manifest,{assets:store.activeAssets('owner_a',app.id)}),root=await mkdtemp(join(tmpdir(),'compass-image-export-'));t.after(()=>rm(root,{recursive:true,force:true}));
  for(const file of bundle.files){const target=join(root,file.path);await mkdir(dirname(target),{recursive:true});await writeFile(target,Buffer.from(file.content,file.encoding==='base64'?'base64':'utf8'))}
  await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),join(root,'node_modules'),'dir');
  // Only reviewed template source and validated image bytes enter this fixture.
  const child=spawn(process.execPath,['--test','test/smoke.test.mjs'],{cwd:root,env:{PATH:process.env.PATH},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  const timeout=setTimeout(()=>child.kill('SIGKILL'),30000);const [result]=await once(child,'exit');clearTimeout(timeout);assert.equal(result,0,output.slice(-8000));assert.match(output,/# pass 1/);
});
