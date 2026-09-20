'use strict';
// Shared offline transport. Existing app rendering, signed card IDs and server schedulers remain authoritative.
const Offline=(()=>{
 const config=JSON.parse(document.getElementById('offlineConfig').textContent),key=config.id+'-study-offline-v1',DAY=86400;
 let token='',online=false,syncing=null,downloading=null,downloadText='Téléchargement à préparer',loaded=false;
 const day=t=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Paris'}).format(new Date(t*1000));
 const round=n=>Math.abs(n%1)===.5?(Math.floor(n)%2===0?Math.floor(n):Math.ceil(n)):Math.round(n);
 function schedule(c,g){
  const {step:s,interval:i,ease:e}=c;
  if(g===1)return [0,60,Math.max(1.3,e-.2)];
  if(g===2)return [s,i<DAY?600:Math.ceil(i/DAY*1.2)*DAY,Math.max(1.3,e-.15)];
  if(g===3)return c.revision===0?[2,DAY,e]:[s+1,s===0?600:s===1?DAY:s===2?6*DAY:Math.max(DAY,round(i/DAY*e)*DAY),e];
  return [Math.max(3,s+1),i<DAY?4*DAY:Math.max(schedule(c,3)[1]+DAY,round(i/DAY*e*1.3)*DAY),Math.min(3,e+.15)];
 }
 const fresh=id=>({id,due:0,interval:0,step:0,ease:2.5,revision:0});
 function read(){const raw=localStorage.getItem(key);return raw?JSON.parse(raw):null;}
 function write(data){localStorage.setItem(key,JSON.stringify(data));}
 const lock=(name,fn)=>navigator.locks.request(key+'-'+name,fn);
 const mutate=fn=>lock('store',()=>{const data=read()||{events:[],conflicts:[]};const result=fn(data);write(data);return result;});
 function project(data,words,now=Date.now()/1000){
  const p=data.pack,cards=new Map(p.cards.map(c=>[c.id,{...c}])),reading={...p.reading};
  let last=p.last_card_id,count=day(p.server_now)===day(now)?p.state.reviews_today:0;
  for(const e of data.events){
   if(e.kind==='reading'){reading[e.section]=e.read;continue;}
   const c=cards.get(e.card_id)||fresh(e.card_id);
   if(c.revision!==e.revision)continue;
   const [step,interval,ease]=schedule(c,e.grade);
   cards.set(c.id,{...c,step,interval,ease,revision:c.revision+1,due:e.recorded_at+interval,first_seen:c.first_seen??e.recorded_at});
   last=c.id;if(day(e.recorded_at)===day(now))count++;
  }
  const values=[...cards.values()],seen=new Set(values.map(c=>Math.abs(c.id))),limit=p.state.daily_limit;
  const introduced=values.filter(c=>c.id>0&&day(c.first_seen)===day(now)).length,back=values.filter(c=>c.id<0&&day(c.first_seen)===day(now)).length;
  const level=['A1','A2','B1','B2','C1'][p.state.level-1];
  const eligible=w=>(!p.state.level||w.level===level)&&(!p.state.unlocked||p.state.unlocked.includes(w.module));
  const unseen=words.filter(w=>!seen.has(w.id)&&eligible(w));
  const reverse=p.reverse?words.filter(w=>cards.has(w.id)&&!cards.has(-w.id)):[];
  const new_left=Math.min(unseen.length,Math.max(0,limit-introduced)),reverse_left=Math.min(reverse.length,Math.max(0,limit-back));
  let id=reverse_left?-reverse[0].id:new_left?unseen[0].id:null;
  if(reverse_left&&new_left&&Math.abs(last)===Math.abs(id))id=unseen[0].id;
  const due=values.filter(c=>c.due<=now).sort((a,b)=>a.due-b.due||a.id-b.id),future=values.filter(c=>c.due>now);
  const learning=values.filter(c=>c.interval<DAY).sort((a,b)=>a.due-b.due||a.id-b.id);
  let next=due[0]?{...due[0]}:id!==null?fresh(id):null;
  if(!next&&learning.length&&learning[0].due<=now+1200)next={...(learning.find(c=>c.due<=now+1200&&c.id!==last)||learning[0]),learning_ahead:true};
  if(next)Object.assign(next,{word_id:Math.abs(next.id),direction:next.id<0?'reverse':'forward',waits:[1,2,3,4].map(g=>schedule(next,g)[1])});
  return {...p.state,retained:p.reverse?[...seen].filter(id=>[id,-id].every(k=>(cards.get(k)?.interval||0)>=21*DAY)).length:values.filter(c=>c.interval>=21*DAY).length,csrf:token,next,learning_left:learning.length,due:due.length,new_left,reverse_left,new_today:introduced,reverse_today:back,
   seen:seen.size,cards_seen:cards.size,learned:[...cards.keys()],reviews_today:count,reading,
   next_due:future.length?Math.min(...future.map(c=>c.due)):null,
   level_seen:words.filter(w=>seen.has(w.id)&&w.level===level).length,level_total:words.filter(w=>w.level===level).length};
 }
 function current(){const data=read();if(!data)throw new Error('Ouvrez une première fois l’app en ligne pour préparer les révisions.');return project(data,deck);}
 function status(){
  const el=document.getElementById('offlineState');if(!el)return;
  let data;try{data=read();}catch{el.textContent='Stockage local indisponible';return;}
  el.textContent=(online?'En ligne':'Hors ligne')+(data?.events.length?` · ${data.events.length} réponse(s)/lecture(s) en attente`:' · progression enregistrée');
  document.getElementById('offlineDownloadStatus').textContent=downloadText;
  const conflicts=document.getElementById('offlineConflicts');conflicts.hidden=!data?.conflicts.length;
  document.getElementById('offlineConflictText').textContent=(data?.conflicts||[]).map(e=>`${e.card_id?'Carte '+e.card_id:e.section} : ${e.error}`).join('\n');
 }
 async function enqueue(payload){
  await mutate(data=>{
   if(!data.pack||data.locked)throw new Error('Reconnectez-vous pour préparer les révisions.');
   if(data.lastReviewAck===payload.request_id||data.events.some(e=>e.request_id===payload.request_id))return;
   data.events.push(payload);
  });
  status();void sync().catch(()=>{});return current();
 }
 async function sync(){
  if(syncing)return syncing;
  syncing=lock('sync',async()=>{
   try{
    const pack=await networkApi('api/offline');token=pack.state.csrf||'';delete pack.state.csrf;
    await mutate(data=>{
     data.pack=pack;delete data.locked;
     // Import the previous device-only poker markers once.
     if(config.poker)for(const m of modules){if(!Object.hasOwn(pack.reading,m.id)&&!data.events.some(e=>e.section===m.id)){
      const value=localStorage.getItem(courseKey+m.id);if(value==='read'||value==='unread')data.events.push({kind:'reading',section:m.id,read:value==='read',request_id:crypto.randomUUID(),recorded_at:Date.now()/1000});
     }}
    });online=true;
    while(read().events.length){
     const event=read().events[0],result=await networkApi('api/offline-review',event);
     token=result.pack.state.csrf||token;delete result.pack.state.csrf;
     await mutate(data=>{
      data.events=data.events.filter(e=>e.request_id!==event.request_id);
      if(!result.outcome.applied&&!data.conflicts.some(e=>e.request_id===event.request_id))data.conflicts.push({...event,error:result.outcome.error});
      if(event.kind==='review')data.lastReviewAck=event.request_id;
      data.pack=result.pack;
     });
    }
   }catch(error){online=false;if(error.status===401)await mutate(data=>{data.locked=true;});throw error;}
   finally{status();}
  }).finally(()=>{syncing=null;});return syncing;
 }
 async function stateValue(){
  try{await sync();}
  catch(error){if(error.status===401||!read()?.pack||read().locked)throw error;}
  return current();
 }
 async function request(path,payload){
  if(path==='api/state')return stateValue();
  if(path==='api/review')return enqueue({...payload,kind:'review',recorded_at:Date.now()/1000});
  if(path==='api/logout'){
   await sync();
   return lock('sync',()=>lock('store',async()=>{
    if(read()?.events.length)throw new Error('Synchronisez les réponses en attente avant de vous déconnecter.');
    const result=await networkApi(path,payload);await purge();return result;
   }));
  }
  const changes=path==='api/settings'||path==='api/modules';
  if(changes)await sync();
  const result=await networkApi(path,payload);
  if(path==='api/login'){token=result.csrf;await mutate(data=>{delete data.locked;});}
  if(changes){await sync();return current();}
  return result;
 }
 async function message(worker,type,onProgress){
  return new Promise((resolve,reject)=>{
   const channel=new MessageChannel();let timeout;
   const arm=()=>{clearTimeout(timeout);timeout=setTimeout(()=>{channel.port1.close();reject(new Error('Téléchargement interrompu : relancez pour reprendre.'));},45000);};arm();
   channel.port1.onmessage=({data})=>{arm();if(data.progress){onProgress?.(data);return;}clearTimeout(timeout);channel.port1.close();data.error?reject(new Error(data.error)):resolve(data);};
   worker.postMessage(type,[channel.port2]);
  });
 }
 async function prepare(){
  if(downloading)return downloading;
  downloading=Promise.resolve().then(async()=>{
   try{
    let reg;try{reg=await navigator.serviceWorker.register('sw.js',{scope:'./',updateViaCache:'none'});}
    catch(error){reg=await navigator.serviceWorker.getRegistration('./');if(!reg?.active)throw error;}
    const ready=await navigator.serviceWorker.ready;
    if(config.login&&typeof registration!=='undefined')registration=reg;
    const result=await message(ready.active,'download',p=>{downloadText=`Téléchargement : ${p.done}/${p.total} fichiers`;status();});
    downloadText=result.ready?'✓ Prêt hors ligne : tout est téléchargé':'Téléchargement à reprendre';
   }catch(error){downloadText=error.message||'Téléchargement indisponible. Reconnectez-vous et réessayez.';}
   finally{downloading=null;status();}
  });return downloading;
 }
 async function purge(){
  try{
   if('serviceWorker' in navigator){const reg=await navigator.serviceWorker.getRegistration('./');if(reg?.active)await message(reg.active,'purge');}
  }finally{
   await caches.delete(config.id+'-data-v2');localStorage.removeItem(key);loaded=false;token='';downloadText='Copie hors ligne effacée';status();
  }
 }
 function readingValue(id){try{const data=read();if(!data)return localStorage.getItem(courseKey+id);return current().reading[id]?'read':'unread';}catch{return null;}}
 async function markRead(id,value){try{await enqueue({kind:'reading',section:id,read:value==='read',request_id:crypto.randomUUID(),recorded_at:Date.now()/1000});}catch(e){notice(e.message,true);}}
 function start(){if(loaded)return;loaded=true;status();void prepare();}
 document.addEventListener('DOMContentLoaded',()=>{
  document.getElementById('offlineDownload').onclick=()=>{void navigator.storage?.persist?.().catch(()=>{});void prepare();};
  document.getElementById('offlineSync').onclick=async()=>{try{state=await stateValue();revealed=false;render();}catch(e){notice(e.message,true);}};
  document.getElementById('offlineExport').onclick=()=>{const url=URL.createObjectURL(new Blob([localStorage.getItem(key)||'{}'],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=config.id+'-offline-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 });
 setInterval(()=>{if(!document.hidden&&loaded)void sync().catch(()=>{});},30000);
 window.addEventListener('online',()=>{if(loaded)void sync().catch(()=>{});});
 window.addEventListener('offline',()=>{online=false;status();});
 return {request,current,start,prepare,readingValue,markRead,pending:()=>read()?.events.length||0,token:()=>token,schedule,project,read,sync};
})();
async function api(path,payload){return Offline.request(path,payload);}
