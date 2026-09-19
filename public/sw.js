'use strict';
const APP={"id": "jiyi", "shell": ["", "index.html", "app.js", "offline.js", "style.css", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"]}, BASE=new URL('./',self.location.href), SHELL=APP.id+'-shell-v2', DATA=APP.id+'-data-v1';
const url=path=>new URL(path,BASE).href;
let download=null,cancel=false;
self.addEventListener('install',e=>e.waitUntil((async()=>{const c=await caches.open(SHELL);await c.addAll(APP.shell.map(p=>new Request(url(p),{cache:'reload'})));await self.skipWaiting();})()));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
async function downloadAll(port){
 if(download){await download;port.postMessage({ready:true});return;}
 cancel=false;
 download=(async()=>{
  const cache=await caches.open(DATA),saved=await cache.match(url('_offline_manifest'));
  if(saved&&await cache.match(url('_offline_ready'))){
   const files=await saved.json();let complete=true;
   for(const path of files)if(!await cache.match(url(path))){complete=false;break;}
   if(complete)return;
  }
  const response=await fetch(url('offline-assets.json'),{cache:'no-store'});
  if(!response.ok)throw new Error('Reconnectez-vous avant de télécharger.');
  const list=await response.json();let done=0;
  if(!Array.isArray(list)||list.some(p=>typeof p!=='string'||new URL(p,BASE).origin!==BASE.origin||!new URL(p,BASE).pathname.startsWith(BASE.pathname)))throw new Error('Liste de fichiers invalide.');
  for(let i=0;i<list.length;i+=6){
   if(cancel)throw new Error('Téléchargement annulé.');
   await Promise.all(list.slice(i,i+6).map(async path=>{
    if(!await cache.match(url(path))){const r=await fetch(url(path),{cache:'reload'});if(!r.ok)throw new Error('Téléchargement interrompu. Réessayez pour reprendre.');await cache.put(url(path),r);}
    done++;port.postMessage({progress:true,done,total:list.length});
   }));
  }
  if(cancel)throw new Error('Téléchargement annulé.');
  await cache.put(url('_offline_manifest'),new Response(JSON.stringify(list)));
  await cache.put(url('_offline_ready'),new Response('ready'));
 })();
 try{await download;port.postMessage({ready:true});}finally{download=null;}
}
self.addEventListener('message',e=>e.waitUntil((async()=>{
 const port=e.ports[0];if(!port)return;
 try{
  if(e.data==='download')return await downloadAll(port);
  if(e.data==='purge'){cancel=true;try{await download;}catch{}await caches.delete(DATA);port.postMessage({ok:true});}
 }catch(error){port.postMessage({error:error.message});}
})()));
async function ranged(request,response){
 const range=request.headers.get('Range');if(!range)return response;
 const data=await response.arrayBuffer(),m=/^bytes=(\d*)-(\d*)$/.exec(range);
 const fail=()=>new Response(null,{status:416,headers:{'Content-Range':`bytes */${data.byteLength}`}});
 if(!m||(!m[1]&&!m[2]))return fail();
 const first=m[1]?Number(m[1]):Math.max(0,data.byteLength-Number(m[2]));
 const last=m[1]&&m[2]?Math.min(Number(m[2]),data.byteLength-1):data.byteLength-1;
 if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||first>last||first>=data.byteLength)return fail();
 const headers=new Headers(response.headers);headers.set('Content-Range',`bytes ${first}-${last}/${data.byteLength}`);headers.set('Content-Length',last-first+1);headers.set('Accept-Ranges','bytes');
 return new Response(data.slice(first,last+1),{status:206,headers});
}
self.addEventListener('fetch',e=>{
 const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==BASE.origin||!u.pathname.startsWith(BASE.pathname))return;
 const path=u.pathname.slice(BASE.pathname.length);
 if(path.startsWith('api/')||path==='sw.js'||path==='offline-assets.json')return;
 e.respondWith((async()=>{
  const cache=await caches.open(APP.shell.includes(path)?SHELL:DATA),hit=await cache.match(url(path));
  return hit?ranged(e.request,hit):fetch(e.request);
 })());
});

