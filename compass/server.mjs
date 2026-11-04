import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, sep, extname } from 'node:path';
import { createIdentityService } from './server/auth-service.mjs';
import { createWorkspaces } from './server/workspaces/index.mjs';
export async function createCompassServer({env=process.env,identity:injectedIdentity,workspaces:injectedWorkspaces}={}) {
const identity = injectedIdentity || await createIdentityService({env});
const workspaces = injectedWorkspaces || createWorkspaces({env,getIdentity:req=>identity.getIdentity(req)});
const root = resolve(env.STATIC_ROOT || fileURLToPath(new URL('./dist/', import.meta.url)));
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.mp4':'video/mp4','.woff2':'font/woff2','.ttf':'font/ttf','.vtt':'text/vtt; charset=utf-8','.txt':'text/plain; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.ico':'image/x-icon'};
const server = createServer(async (req,res) => {
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Referrer-Policy','no-referrer');
 if(env.NODE_ENV==='production'&&req.headers.host==='www.mycompass.world'){
  res.writeHead(308,{Location:`https://mycompass.world${req.url.startsWith('/')&&!req.url.startsWith('//')?req.url:'/'}`}).end();return;
 }
 try {
 const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 const normalized=pathname.replace(/\/$/,'')||'/';
 if (pathname.startsWith('/api/')) {
  if(await workspaces.handle(req,res))return;
  if(await identity.handle(req,res))return;
  res.writeHead(404,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({error:'API endpoint is not available.'}));return;
 }
 if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405,{Allow:'GET, HEAD'}).end();return;}
  if(pathname==='/healthz'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(req.method==='HEAD'?undefined:JSON.stringify({ok:true,revision:env.RAILWAY_GIT_COMMIT_SHA||env.COMPASS_REVISION||'local',auth:identity.status().database,workspaces:workspaces.status().status}));return;}
  if(normalized==='/office'){res.writeHead(308,{Location:`/app${new URL(req.url,'http://localhost').search}`,'Cache-Control':'no-store'}).end();return;}
  if(/^\/(?:demo|voice-demo|presentation|present|story|protect|studio|horizon|vision|acquisition|live)(?:\/|\.|$)/.test(normalized)) {
   res.writeHead(410,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}).end(req.method==='HEAD'?undefined:'This COMPASS demonstration has been retired. Open /app for your workspace.');return;
  }
  const pages = {'/':'/index.html','/index.html':'/index.html','/app':'/app.html','/app.html':'/app.html','/login':'/login.html','/login.html':'/login.html'};
  const route=pages[normalized]||pathname;
  if(!pages[normalized] && (pathname.endsWith('.html')||pathname.split('/').some(part=>part.startsWith('.'))||!types[extname(pathname)])){res.writeHead(404).end();return;}
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
return {server,async close(){
 const stopped=server.listening?new Promise(resolve=>server.close(resolve)):Promise.resolve();
 server.closeIdleConnections();
 await Promise.all([workspaces.close(),identity.close()]);
 await stopped;
}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const app=await createCompassServer();
 app.server.listen(Number(process.env.PORT||8770),'0.0.0.0',()=>console.log('COMPASS ready'));
 let shuttingDown=false;
 const shutdown=async()=>{if(shuttingDown)return;shuttingDown=true;await app.close();process.exit(0);};
 process.on('SIGTERM',()=>void shutdown());
 process.on('SIGINT',()=>void shutdown());
}
