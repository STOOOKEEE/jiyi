// node test_worker.cjs: cache completeness, offline restart, audio byte ranges, auth boundaries and purge.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('public/index.html','utf8');assert(html.indexOf('src="offline.js')>=0&&html.indexOf('src="offline.js')<html.indexOf('src="app.js'));
const config=JSON.parse(fs.readFileSync('public/index.html','utf8').match(/id="offlineConfig"[^>]*>(.*?)<\/script>/s)[1]);
const base='https://example.test'+(config.login?'/english/':'/'),events={},stores=new Map();let online=true,fetches=0,fail=false;
const paths=JSON.parse(fs.readFileSync('public/offline-assets.json')),u=p=>new URL(p,base).href;
const caches={open:async name=>{if(!stores.has(name))stores.set(name,new Map());const map=stores.get(name);return {match:async key=>map.get(String(key))?.clone(),put:async(key,r)=>map.set(String(key),r.clone()),addAll:async()=>{}};},delete:async name=>stores.delete(name)};
const ctx={URL,Request,Response,Headers,Promise,Math,Number,Array,Error,caches,self:{location:{href:u('sw.js')},addEventListener:(type,fn)=>events[type]=fn,clients:{claim(){}},skipWaiting(){}},
 fetch:async url=>{fetches++;if(!online||fail&&String(url)===u(paths[paths.length-1]))throw Error('unavailable');return String(url)===u('offline-assets.json')?Response.json(paths):new Response('0123456789',{headers:{'Content-Type':'audio/mpeg'}});}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync('public/sw.js','utf8'),ctx);
async function message(data){const messages=[];let work;events.message({data,ports:[{postMessage:m=>messages.push(m)}],waitUntil:p=>work=p});await work;return messages.at(-1);}
async function request(path,range){let result;events.fetch({request:new Request(u(path),{headers:range?{Range:range}:{}}),respondWith:p=>result=p});return result;}
(async()=>{
 fail=true;assert((await message('download')).error);fail=false;
 assert.equal((await message('download')).ready,true);
 const data=await caches.open(config.id+'-data-v1');for(const path of paths)assert(await data.match(u(path)));
 const count=fetches;online=false;assert.equal((await message('download')).ready,true);assert.equal(fetches,count);
 let response=await request(paths.at(-1),'bytes=2-5');assert.equal(response.status,206);assert.equal(await response.text(),'2345');
 response=await request(paths.at(-1),'bytes=-3');assert.equal(await response.text(),'789');
 response=await request(paths.at(-1),'bytes=500-600');assert.equal(response.status,416);
 assert.equal(await request('api/offline'),undefined);assert.equal(await request('offline-assets.json'),undefined);
 assert.equal((await message('purge')).ok,true);assert.equal(stores.has(config.id+'-data-v1'),false);
 if(config.login)assert(events.push&&events.notificationclick);
 console.log('PASS worker: interrupted download resumes, complete cache works without network, audio ranges, API bypass, logout purge, push retained');
})().catch(e=>{console.error(e);process.exitCode=1;});
