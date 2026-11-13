import {readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {inspectImage,assetFilename,ASSET_LIMITS} from './image.mjs';
import {createHash} from 'node:crypto';
import {createApplicationManifest,refineApplicationManifest,validateApplicationManifest,validateApplicationRecord} from './manifest.mjs';
export {createApplicationManifest,refineApplicationManifest,validateApplicationManifest,validateApplicationRecord};
const FILES = ['package.json','package-lock.json','README.md','Dockerfile','.gitignore','.dockerignore','server.mjs','lib/schema.mjs','public/index.html','public/client-core.js','public/app.js','public/styles.css','test/smoke.test.mjs'];
const sha = value => createHash('sha256').update(value).digest('hex');
const escape = value => String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const trusted = path => readFile(new URL('./templates/' + path,import.meta.url),'utf8');

let cachedTemplateFiles;
function sourceFiles(value,{assets=[],trustedAssets=false}={}) {
  const manifest=validateApplicationManifest(value);
  if(!manifest)throw Object.assign(new Error('Invalid application manifest.'),{code:'invalid_manifest'});
  if(!Array.isArray(assets)||assets.length>ASSET_LIMITS.activeFiles)throw Error('Invalid application assets.');
  const ids=new Set();let total=0;
  const images=assets.map(asset=>{
    if(typeof asset.id!=='string'||!/^asset_[a-zA-Z0-9_-]{1,74}$/.test(asset.id)||ids.has(asset.id))throw Error('Invalid application asset.');ids.add(asset.id);
    const checked=trustedAssets?{data:Buffer.from(asset.data),mime:asset.mime,width:asset.width,height:asset.height,bytes:asset.data.length,sha256:sha(asset.data)}:inspectImage(asset.data,asset.mime);total+=checked.bytes;
    if(total>ASSET_LIMITS.applicationBytes||checked.sha256!==asset.sha256)throw Error('Invalid application asset.');
    return {...asset,...checked};
  }).sort((a,b)=>a.id.localeCompare(b.id));
  if(Object.values(manifest.assets||{}).some(id=>!ids.has(id)))throw Object.assign(new Error('An application asset is unavailable.'),{status:409,code:'asset_reference_missing'});
  cachedTemplateFiles ||= FILES.map(path=>({path,content:readFileSync(new URL('./templates/'+path,import.meta.url),'utf8')}));
  const files=cachedTemplateFiles.map(file=>({...file}));
  files.push({path:'manifest.json',content:JSON.stringify(manifest,null,2)+'\n'});
  if(images.length){
    files.push({path:'assets.json',content:JSON.stringify({schema:1,assets:images.map(asset=>({id:asset.id,mime:asset.mime,width:asset.width,height:asset.height,bytes:asset.bytes,sha256:asset.sha256}))},null,2)+'\n'});
    files.push(...images.map(asset=>({path:assetFilename(asset),content:asset.data.toString('base64'),encoding:'base64',mime:asset.mime})));
  }
  return{manifest,files};
}
export function createApplicationFileMetadata(value,options) {
  return sourceFiles(value,options).files.map(file=>{const bytes=Buffer.from(file.content,file.encoding==='base64'?'base64':'utf8');return{path:file.path,bytes:bytes.length,sha256:sha(bytes)}}).sort((a,b)=>a.path.localeCompare(b.path));
}
export async function createApplicationBundle(value,options) {
  const {manifest,files}=sourceFiles(value,options);
  return{schema:1,template:'compass-crud-v1',manifest,files,sha256:sha(JSON.stringify(files))};
}

export async function renderApplicationPreview(value) {
  const manifest = validateApplicationManifest(value);
  if (!manifest) throw Object.assign(new Error('Invalid application manifest.'),{code:'invalid_manifest'});
  const [markup,core,bridge,css] = await Promise.all(['public/index.html','public/client-core.js','public/bridge.js','public/styles.css'].map(trusted));
  const script = core + '\n' + bridge;
  const hash = content => createHash('sha256').update(content).digest('base64');
  const policy = `default-src 'none';script-src 'sha256-${hash(script)}';style-src 'sha256-${hash(css)}';connect-src 'none';img-src data:;font-src 'none';object-src 'none';base-uri 'none';form-action 'none'`;
  return markup.replace('<title>Application</title>',()=>`<title>${escape(manifest.title)}</title><meta http-equiv="Content-Security-Policy" content="${escape(policy)}">`)
    .replace('<link rel="stylesheet" href="/styles.css">',()=>`<style>${css}</style>`)
    .replace('<script src="/client-core.js" defer></script><script src="/app.js" defer></script>','')
    .replace('<section id="auth-panel" class="auth-panel">','<section id="auth-panel" class="auth-panel" hidden>')
    .replace('<body>',()=>`<body data-manifest="${escape(JSON.stringify(manifest))}">`)
    .replace('</body>',()=>`<script>${script}</script></body>`);
}

const CRC_TABLE = Array.from({length:256},(_,n) => {for(let i=0;i<8;i++)n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1;return n >>> 0;});
function crc32(bytes) {let crc = 0xffffffff;for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ crc >>> 8;return (crc ^ 0xffffffff) >>> 0;}

export function exportApplicationZip(bundle) {
  if (bundle?.template !== 'compass-crud-v1' || !Array.isArray(bundle.files) || bundle.files.length < FILES.length + 1 || bundle.files.length > FILES.length + 2 + ASSET_LIMITS.activeFiles) throw Error('Invalid application bundle.');
  const allowed = new Set([...FILES,'manifest.json','assets.json']), seen = new Set(), local = [], central = [];
  let offset = 0, total = 0;
  for (const file of bundle.files) {
    const binary=/^public\/assets\/asset_[a-zA-Z0-9_-]{1,74}\.(?:png|jpg)$/.test(file.path);
    if ((!allowed.has(file.path)&&!binary) || (binary ? file.encoding!=='base64' || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.content||'') : file.encoding!==undefined) || seen.has(file.path) || typeof file.content !== 'string') throw Error('Invalid source path.');
    seen.add(file.path);
    const name = Buffer.from(file.path), bytes = Buffer.from(file.content,binary?'base64':'utf8'), crc = crc32(bytes);
    total += bytes.length;if (total > ASSET_LIMITS.applicationBytes + 1024 * 1024) throw Error('Bundle too large.');
    const head = Buffer.alloc(30);head.writeUInt32LE(0x04034b50,0);head.writeUInt16LE(20,4);head.writeUInt32LE(crc,14);head.writeUInt32LE(bytes.length,18);head.writeUInt32LE(bytes.length,22);head.writeUInt16LE(name.length,26);
    local.push(head,name,bytes);
    const entry = Buffer.alloc(46);entry.writeUInt32LE(0x02014b50,0);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(bytes.length,20);entry.writeUInt32LE(bytes.length,24);entry.writeUInt16LE(name.length,28);entry.writeUInt32LE(offset,42);
    central.push(entry,name);offset += head.length + name.length + bytes.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(seen.size,8);end.writeUInt16LE(seen.size,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
