// node test_offline.cjs [Python trace fixture]; no browser/network required.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const config=JSON.parse(fs.readFileSync('public/index.html','utf8').match(/id="offlineConfig"[^>]*>(.*?)<\/script>/s)[1]);
const clone=x=>JSON.parse(JSON.stringify(x)),store=new Map(),elements=new Map();
const key=config.id+'-study-offline-v1',deck=JSON.parse(fs.readFileSync('public/deck.json'));
const locks=new Map(),calls=[];let available=false,accepted=0,loseReply=false,remote;
const el=id=>{if(!elements.has(id))elements.set(id,{textContent:'',hidden:false});return elements.get(id);};el('offlineConfig').textContent=JSON.stringify(config);
const context={console,Intl,Date,Math,JSON,Object,Error,Promise,URL,Blob,crypto:require('node:crypto').webcrypto,
 deck,modules:config.poker?JSON.parse(fs.readFileSync('public/roadmap.json')):[],courseKey:'test-',
 localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
 document:{getElementById:el,addEventListener(){}},window:{addEventListener(){}},setInterval(){},setTimeout,clearTimeout,
 navigator:{locks:{request:(name,fn)=>{const next=(locks.get(name)||Promise.resolve()).catch(()=>{}).then(fn);locks.set(name,next);return next;}}},
 networkApi:async(path,payload)=>{calls.push(path);if(!available)throw new Error('offline');
  if(path==='api/offline')return clone(remote);
  if(path==='api/offline-review'){
   if(!remote.ids.includes(payload.request_id)){remote.ids.push(payload.request_id);accepted++;const c=remote.cards.find(c=>c.id===payload.card_id)||{id:payload.card_id,revision:0,first_seen:payload.recorded_at,step:0,interval:0,ease:2.5};const [step,interval,ease]=O.schedule(c,payload.grade);Object.assign(c,{step,interval,ease,due:payload.recorded_at+interval});c.revision++;if(!remote.cards.includes(c))remote.cards.push(c);}
   if(loseReply){loseReply=false;throw new Error('reply lost');}
   return {outcome:{applied:true,error:''},pack:clone(remote)};
  }return {};
 }};
vm.createContext(context);vm.runInContext(fs.readFileSync('public/offline.js','utf8')+';globalThis.testOffline=Offline',context);
const O=context.testOffline;
(async()=>{
 if(process.argv[2]){
  const {traces}=JSON.parse(fs.readFileSync(process.argv[2]));
  for(const t of traces){
   const actual=O.project({pack:t.pack,events:t.events},deck,t.now);
   for(const field of ['due','new_left','seen','reviews_today','daily_limit','next_due','reverse_left','cards_seen','new_today','reverse_today','level_seen','level_total'])if(field in t.expected)assert.deepEqual(actual[field],t.expected[field],field);
   assert.equal(actual.next?.id,t.expected.next?.id);assert.deepEqual(clone(actual.next?.waits),t.expected.next?.waits);
  }
  remote={...traces[0].pack,ids:[]};
 }else remote={cards:[],reverse:!config.poker,reading:{},last_card_id:null,server_now:Date.now()/1000,state:{daily_limit:20,reviews_today:0,unlocked:config.poker?['R1']:undefined,level:config.login?1:undefined},ids:[]};
 remote.cards=[];store.set(key,JSON.stringify({pack:remote,events:[],conflicts:[]}));
 const review={card_id:deck[0].id,grade:3,revision:0,request_id:'test-offline-review-1234'};
 await O.request('api/review',review);await O.sync().catch(()=>{});
 assert.equal(O.pending(),1);assert.equal(O.current().reviews_today,1);
 await O.request('api/review',review);await O.sync().catch(()=>{});assert.equal(O.pending(),1);
 available=true;loseReply=true;await O.sync().catch(()=>{});assert.equal(O.pending(),1);assert.equal(accepted,1);
 await O.sync();assert.equal(O.pending(),0);assert.equal(accepted,1);
 await O.request('api/review',review);await O.sync();assert.equal(O.pending(),0);assert.equal(accepted,1);
 available=false;
 await Promise.all([O.request('api/review',{...review,card_id:deck[1].id,request_id:'parallel-offline-0001'}),O.request('api/review',{...review,card_id:deck[2].id,request_id:'parallel-offline-0002'})]);
 await O.sync().catch(()=>{});assert.equal(O.pending(),2);
 available=true;calls.length=0;await O.request('api/settings',{daily_limit:20});
 assert(calls.indexOf('api/offline-review')<calls.indexOf('api/settings'));assert.equal(O.pending(),0);
 console.log('PASS client: reloadable queue, lost reply, legacy retry, concurrent writes, settings ordering, projection parity');
})().catch(e=>{console.error(e);process.exitCode=1;});
