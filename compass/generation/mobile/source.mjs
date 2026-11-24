import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

export const MOBILE_TEMPLATE='compass-native-personal-os-v1';
const root=fileURLToPath(new URL('./template/',import.meta.url));
const rootFiles=new Set(['.gitignore','App.tsx','README.md','SECURITY.md','app.json','app.config.js','app.config.mjs','app.config.ts','babel.config.js','eas.json','index.js','index.ts','metro.config.js','package-lock.json','package.json','tsconfig.json']);
const sourceDirectories=new Set(['assets','lib','src','test']);
const safeName=/^[a-z0-9][a-z0-9_.-]{0,95}$/i;
const textSource=/\.(?:js|mjs|cjs|json|ts|tsx|md|txt)$/i;

export const isNativeImage=path=>/^assets\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.png$/i.test(path);

function readSource(path) {
  const binary=isNativeImage(path);
  const bytes=readFileSync(join(root,path));
  if (bytes.length>1024*1024) throw Error('Mobile template file is too large.');
  return {path,content:bytes.toString(binary?'base64':'utf8'),...(binary?{encoding:'base64',mime:'image/png'}:{})};
}

function sourcesIn(path,depth=0) {
  if (depth>4) throw Error('Mobile template directory is too deep.');
  const files=[];
  for (const entry of readdirSync(join(root,path),{withFileTypes:true})) {
    if (!safeName.test(entry.name)||entry.name==='node_modules') continue;
    const item=path+'/'+entry.name;
    if (entry.isDirectory()) files.push(...sourcesIn(item,depth+1));
    else if (entry.isFile()&&(textSource.test(item)||isNativeImage(item))) files.push(readSource(item));
  }
  return files;
}

let source;
export function mobileTemplateFiles() {
  if (!source) {
    const files=[];
    for (const entry of readdirSync(root,{withFileTypes:true})) {
      if (entry.isFile()&&rootFiles.has(entry.name)) files.push(readSource(entry.name));
      else if (entry.isDirectory()&&sourceDirectories.has(entry.name)) files.push(...sourcesIn(entry.name));
    }
    const paths=new Set(files.map(file=>file.path));
    if (!['app.json','index.js','package.json','package-lock.json','src/App.tsx'].every(path=>paths.has(path)) || files.length>45) throw Error('Mobile source template is incomplete.');
    source=files.sort((a,b)=>a.path.localeCompare(b.path));
  }
  return source.map(file=>({...file}));
}

export function configuredMobileFiles(manifest) {
  return mobileTemplateFiles().map(file=>{
    if(file.path!=='app.json')return file;
    const config=JSON.parse(file.content);
    const platform=manifest.mobile.platform;
    config.expo.name=manifest.title;
    config.expo.platforms=platform==='cross-platform'?['ios','android']:[platform];
    return {...file,content:JSON.stringify(config,null,2)+'\n'};
  });
}
