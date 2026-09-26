import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep, extname } from 'node:path';
import { createCompassBackend } from './server/app.mjs';
import { createAcquisition } from './server/acquisition/api.mjs';
import { createRemasterBridge } from './server/remaster-bridge.mjs';
import { createWorkspaces } from './server/workspaces/index.mjs';
const backend = createCompassBackend();
const acquisition = await createAcquisition();
const remaster = createRemasterBridge({getIdentity:req=>acquisition.getIdentity(req)});
const workspaces = await createWorkspaces({getIdentity:req=>acquisition.getIdentity(req)});
const root = resolve(process.env.STATIC_ROOT || fileURLToPath(new URL('./dist/', import.meta.url)));
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.mp4':'video/mp4','.woff2':'font/woff2','.ttf':'font/ttf','.vtt':'text/vtt; charset=utf-8','.txt':'text/plain; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.ico':'image/x-icon'};
const server = createServer(async (req,res) => {
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Referrer-Policy','no-referrer');
 if(process.env.NODE_ENV==='production'&&req.headers.host==='www.mycompass.world'){
  res.writeHead(308,{Location:`https://mycompass.world${req.url.startsWith('/')&&!req.url.startsWith('//')?req.url:'/'}`}).end();return;
 }
 if (req.url.startsWith('/api/')) {
  if(await workspaces.handle(req,res))return;
  if(await remaster.handle(req,res))return;
  if(await acquisition.handle(req,res))return;
  await backend.handleApi(req,res); return;
 }
 if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405,{Allow:'GET, HEAD'}).end();return;}
 try {
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(pathname==='/healthz'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(req.method==='HEAD'?undefined:JSON.stringify({ok:true,revision:process.env.RAILWAY_GIT_COMMIT_SHA||'local',acquisition:acquisition.status().database}));return;}
  if(['/present','/story','/present.html'].includes(pathname.replace(/\/$/,''))){res.writeHead(302,{Location:'/presentation','Cache-Control':'no-store'}).end();return;}
  const normalized=pathname.replace(/\/$/,'')||'/';
  const route = ['/acquisition','/acquisition/app','/login'].includes(normalized) ? '/acquisition.html'
   : ['/original','/original/tour'].includes(normalized) ? '/original.html'
   : normalized==='/original/site' ? '/original-site.html'
   : ['/voice-demo','/demo'].includes(normalized) ? '/live.html'
   : normalized==='/horizon' ? '/horizon.html'
   : normalized==='/presentation/legacy' ? '/story.html'
   : normalized === '/' ? '/index.html' : ['/presentation','/presentation/legacy','/story'].includes(normalized) ? '/story.html' : normalized === '/office' ? '/office.html' : ['/app','/presentation/finale','/demo/table','/demo/workspace','/demo/remaster','/demo/remaster/app'].includes(normalized) ? '/app.html' : pathname;
  const file=resolve(root,'.'+route);
  if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
  const info=await stat(file);
  if(!info.isFile()){res.writeHead(404).end();return;}
  const headers={'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'public, max-age=0, must-revalidate','Accept-Ranges':'bytes'};
  let start=0,end=info.size-1,status=200;
  if(req.headers.range && req.method==='GET'){
   const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
   if(!m || (!m[1]&&!m[2])){res.writeHead(416,{'Content-Range':`bytes */${info.size}`}).end();return;}
   if(!m[1]){start=Math.max(0,info.size-Number(m[2]));}
   else{start=Number(m[1]);if(m[2])end=Math.min(end,Number(m[2]));}
   if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=info.size){res.writeHead(416,{'Content-Range':`bytes */${info.size}`}).end();return;}
   status=206;headers['Content-Range']=`bytes ${start}-${end}/${info.size}`;
  }
  headers['Content-Length']=info.size===0?0:end-start+1;res.writeHead(status,headers);
  if(req.method==='HEAD'||info.size===0){res.end();return;}
  const stream=createReadStream(file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
 }catch{if(!res.headersSent)res.writeHead(404);res.end('Not found');}
});
backend.attachVoice(server,{authorizeDomain:acquisition.authorizeVoice});
server.listen(Number(process.env.PORT||8770),'0.0.0.0',()=>console.log('COMPASS ready'));
let shuttingDown=false;
async function shutdown(){
 if(shuttingDown)return;shuttingDown=true;
 remaster.close?.();
 const stopped=new Promise(resolve=>server.close(resolve));
 await Promise.all([workspaces.close(),acquisition.close()]);
 server.closeIdleConnections();
 await stopped;
 process.exit(0);
}
process.on('SIGTERM',()=>void shutdown());
process.on('SIGINT',()=>void shutdown());
