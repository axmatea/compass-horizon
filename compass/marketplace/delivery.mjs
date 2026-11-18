import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {getTemplate} from './catalog.mjs';
import {renderTemplatePreview} from './preview.mjs';

// Offline author delivery only. This module performs no purchase, entitlement,
// publication or activation. Do not expose it as a public download endpoint.
export const DELIVERY_VERSION = '1.0.0';
export const NATIVE_DEPENDENCIES = Object.freeze({expo:'58.0.26',react:'19.3.0','react-native':'0.88.1','react-native-safe-area-context':'5.11.1'});
const FAMILIES = Object.freeze(['atlas','forma','mono','pulse','field','venue']);
const NATIVE_FILES = Object.freeze(['App.jsx','index.js','metro.config.js','state.mjs','state.test.mjs','DEPENDENCIES.md']);
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value,null,2)+'\n';
const trusted = name => readFileSync(new URL('./templates/'+name,import.meta.url),'utf8');
const failure = (code,message) => Object.assign(new TypeError(message),{code,status:400});
const file = (path,content) => ({path,content,bytes:Buffer.byteLength(content),sha256:hash(content)});
const capabilities = {
  pulse:['Add habits','Toggle completion','View current-session progress','Remove habits','Reset demo data'],
  field:['Add tasks','Toggle completion','Filter tasks','Set priority','Remove tasks','Reset demo data'],
  venue:['Choose a service, date and time','Save local demo request records','Prevent duplicate active slots','Cancel a local request','Reset demo data'],
};
function nativeReadme(template) {
  return '# '+template.name+' — editable iOS and Android starter\n\n'
    +'Original React Native source by AX Media Global. This is an Expo SDK 58 project, not a screenshot, web wrapper, compiled binary, or native emulator.\n\n'
    +'## Status\n\nPREVIEW ONLY. Payments are disabled. No purchase, commercial license or app-store publication is activated. Commercial license terms require approval; see LICENSE.txt.\n\n'
    +'## Included\n\n'+capabilities[template.id].map(value=>'- '+value).join('\n')+'\n\n'
    +'App.jsx contains editable native components and design tokens. state.mjs contains the tested, service-free state transitions. template.mjs identifies this edition. The sibling mobile-web edition is separate HTML/CSS/JavaScript; a browser preview does not demonstrate native execution.\n\n'
    +'## Run locally\n\nUse Node 22.23 or another SDK-compatible LTS version, then run:\n\n'
    +'    npm install\n    npm test\n    npm start\n\n'
    +'The exact direct dependency versions are pinned in package.json and documented with official sources in DEPENDENCIES.md. Create and retain a lockfile after your verified installation. No dependencies, native SDKs or build service were installed or invoked for the delivered verification.\n\n'
    +'For a local native development build, install the SDK-compatible Xcode and iOS tooling on macOS or the Android SDK/emulator, then run npm run ios or npm run android. Expo generates native projects locally. Set your own bundle identifier, Android package identifier and signing configuration before distribution. No signing identity, provider account or paid EAS service is included or required by this source.\n\n'
    +'## Data and services\n\nAll changes live in component memory and reset when the application restarts. No accounts, cloud persistence, email, notifications, analytics, payment processing or backend are included. Venue requests are demo records; no real appointment is reserved or sent. Pulse displays session progress, not historical streaks. Field contains illustrative tasks, not team activity.\n\n'
    +'## Verification\n\nAutomated checks cover state transitions and source integrity. The JSX was transpiled with esbuild in the COMPASS workspace. Expo dependency installation, Metro bundling, native compilation, simulators and physical iOS/Android devices have not been verified. Complete those checks, accessibility checks and store requirements before any release.\n';
}
function webReadme(template,format) {
  return '# '+template.name+' — '+(format==='website'?'website':'mobile web')+' starter\n\n'
    +'Original HTML, CSS and JavaScript by AX Media Global. The self-contained index.html is editable source and the same browser experience as the public template preview.\n\n'
    +'## Status\n\nPREVIEW ONLY. Payments are disabled. No purchase or commercial license is activated. Commercial license terms require approval; see LICENSE.txt.\n\n'
    +'## Run and edit\n\nOpen index.html in a browser, or use Node 22.16 or newer:\n\n    npm test\n    npm start\n\nThe local preview server binds to 127.0.0.1:4173. Set PORT to choose another local port. Edit the HTML, embedded style block and, for mobile web, the embedded script. There are no third-party runtime dependencies, external fonts or downloaded artwork.\n\n'
    +'## Included\n\n'+template.features.map(value=>'- '+value).join('\n')+'\n\n'
    +(format==='mobile-web'?'This is a responsive browser application. It is not an iOS/Android binary, React Native runtime or emulator. The separate ios-android edition contains native source. Interactive state stays in this document and resets on reload.\n\n':'This is a static responsive website. Product illustrations and project names are editable sample content, not proof of deployed software or completed client work.\n\n')
    +'No backend, login, cloud storage, real booking, payment processing, email delivery or production deployment is included. Contact sections and selection screens do not send requests. Add and verify your own services before offering them to real users.\n\n'
    +'## Verification\n\nSource tests check package identity, responsive markup and local destinations. COMPASS also checks the exported mobile scripts in a Node VM. The browser preview is the web edition only. Review your final copy, keyboard access and device layouts before publishing.\n';
}
const WEB_SERVER = "import http from 'node:http';\nimport {readFile} from 'node:fs/promises';\nconst port=Number(process.env.PORT || 4173);\nif(!Number.isInteger(port)||port<1||port>65535)throw Error('Choose a valid PORT.');\nhttp.createServer(async(request,response)=>{\n if(!['GET','HEAD'].includes(request.method)){response.writeHead(405,{Allow:'GET, HEAD'});response.end();return;}\n if(!['/','/index.html'].includes(new URL(request.url,'http://localhost').pathname)){response.writeHead(404);response.end('Not found');return;}\n try{const html=await readFile(new URL('./index.html',import.meta.url));response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff'});response.end(request.method==='HEAD'?undefined:html);}catch{response.writeHead(500);response.end('Could not open the page.');}\n}).listen(port,'127.0.0.1',()=>console.log('Local preview: http://127.0.0.1:'+port));\n";
const WEB_TEST = "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {readFileSync} from 'node:fs';\nconst html=readFileSync(new URL('../index.html',import.meta.url),'utf8');\ntest('the editable page has responsive markup and local destinations',()=>{\n assert.match(html,/<!doctype html>/i);assert.match(html,/name=\"viewport\"/);assert.match(html,/@media/);\n const ids=new Set([...html.matchAll(/\\bid=\"([^\"]+)\"/g)].map(match=>match[1]));\n for(const match of html.matchAll(/href=\"#([^\"]+)\"/g))assert.ok(ids.has(match[1]),'Missing destination '+match[1]);\n assert.doesNotMatch(html,/<(?:iframe|script)[^>]+src=\"https?:/i);\n});\n";

/** Returns original author source for a known edition. No entitlement is created. */
export function getTemplateBundle(id,format) {
  if(typeof id!=='string' || !FAMILIES.includes(id))throw failure('template_not_found','Unknown template.');
  const template=getTemplate(id);
  if(!template || typeof format!=='string' || !template.formats.includes(format))throw failure('template_format_unavailable','Choose a supported template format.');
  const native=format==='ios-android';
  let files;
  if(native) {
    files=NATIVE_FILES.map(name=>file(name,trusted('native/'+name)));
    files.push(file('template.mjs','export const TEMPLATE = Object.freeze('+JSON.stringify({id:template.id,name:template.name,category:template.category})+');\n'));
    files.push(file('app.json',json({expo:{name:template.name,slug:'compass-'+id,version:DELIVERY_VERSION,orientation:'default',userInterfaceStyle:'light',platforms:['ios','android'],ios:{supportsTablet:true},android:{permissions:[]}}})));
    files.push(file('package.json',json({name:'compass-'+id+'-native',version:DELIVERY_VERSION,private:true,license:'UNLICENSED',main:'index.js',engines:{node:'^22.13.0 || ^24.3.0 || ^26.0.0'},scripts:{start:'expo start',ios:'expo run:ios',android:'expo run:android',test:'node --test state.test.mjs'},dependencies:NATIVE_DEPENDENCIES})));
    files.push(file('README.md',nativeReadme(template)));
  } else {
    const html=renderTemplatePreview(id);
    if(typeof html!=='string' || !html.startsWith('<!doctype html>'))throw failure('template_source_unavailable','This source is unavailable.');
    files=[file('index.html',html),file('serve.mjs',WEB_SERVER),file('test/source.test.mjs',WEB_TEST),file('README.md',webReadme(template,format)),file('package.json',json({name:'compass-'+id+'-'+format,version:DELIVERY_VERSION,private:true,license:'UNLICENSED',type:'module',engines:{node:'>=22.16.0'},scripts:{start:'node serve.mjs',test:'node --test test/*.test.mjs'}}))];
  }
  files.push(file('LICENSE.txt',trusted('LICENSE.preview.txt')));
  const manifest={schema:1,id,name:template.name,format,version:DELIVERY_VERSION,author:'AX Media Global',origin:'original-engineer-authored',licenseStatus:'preview-only',paymentsEnabled:false,orderActivated:false,platforms:native?['ios','android']:['browser'],capabilities:native?[...capabilities[id]]:[...template.features],dataPersistence:native || format==='mobile-web'?'memory-only':'none',servicesIncluded:[],verification:{sourceIntegrity:true,behaviorTests:true,nativeBuild:'unverified',physicalDevices:'unverified'},files:files.map(({path,bytes,sha256})=>({path,bytes,sha256})).sort((a,b)=>a.path.localeCompare(b.path))};
  files.push(file('manifest.json',json(manifest)));
  files.sort((a,b)=>a.path.localeCompare(b.path));
  const seen=new Set();let total=0;
  for(const entry of files) {
    if(!/^[A-Za-z0-9._/-]+$/.test(entry.path) || entry.path.split('/').some(segment=>!segment || segment==='.' || segment==='..') || entry.path.startsWith('/') || seen.has(entry.path) || typeof entry.content!=='string')throw failure('invalid_template_source','Invalid template source.');
    if(/(?:^|\/)(?:\.env(?:\..*)?|node_modules|\.git)(?:\/|$)/.test(entry.path))throw failure('invalid_template_source','Private files are not part of a template.');
    seen.add(entry.path);total+=entry.bytes;
  }
  if(files.length>30 || total>1024*1024)throw failure('invalid_template_source','Template source exceeds its limit.');
  return {schema:1,id,format,version:DELIVERY_VERSION,manifest,files,bytes:total,sha256:hash(JSON.stringify(files.map(({path,sha256})=>({path,sha256})))),previewOnly:true,paymentsEnabled:false};
}
