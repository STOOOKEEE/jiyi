"""python3 test_learning_session.py — finish short steps even after the daily quota."""
import contextlib,json,subprocess,tempfile,time,uuid
from pathlib import Path
import server as app

with tempfile.TemporaryDirectory() as folder:
 app.DATABASE=Path(folder)/'progress.sqlite3';app.initialize();now=time.time()-1800
 reverse=hasattr(app,'REVIEW_IDS')
 with contextlib.closing(app.connect()) as db,db:
  initial=app.snapshot(db,now)
  words=[c for c in app.DECK if ('unlocked' not in initial or c['module'] in initial['unlocked']) and ('level' not in initial or c['level']==app.LEVELS[initial['level']-1])]
  first,second=[c['id'] for c in words[:2]]
  db.execute("UPDATE settings SET value=1 WHERE key='daily_limit'")
  for card_id,delay,step in [(first,60,0),(second,600,1)]:
   db.execute('INSERT INTO cards VALUES (?,?,?,?,?,?,?)',(card_id,now+delay,delay,step,2.5,1,now-10))
   if reverse:db.execute('INSERT INTO cards VALUES (?,?,?,?,?,?,?)',(-card_id,now+app.DAY,app.DAY,2,2.5,1,now-10))
 traces=[]
 def check():
  with contextlib.closing(app.connect()) as db:
   s=app.snapshot(db,now)
   if hasattr(app,'offline'):
    p=app.offline.pack(db,s,reverse);p['server_now']=now;traces.append(dict(pack=p,events=[],now=now,expected=s))
   return s
 def grade(card_id,g,revision):
  with contextlib.closing(app.connect()) as db,db:return app.review(db,dict(card_id=card_id,grade=g,revision=revision,request_id=str(uuid.uuid4())),now)
 s=check();assert s['new_left']==0 and s.get('reverse_left',0)==0
 assert s['learning_left']==2 and s['next']['id']==first and s['next']['learning_ahead']
 try:grade(second,3,1)
 except ValueError:pass
 else:raise AssertionError('unoffered future card accepted')
 # A second lapse never ends the session; offer another learning card before repeating it.
 grade(first,1,1);s=check();assert s['next']['id']==second and s['learning_left']==2
 grade(second,3,1);s=check();assert s['next']['id']==first and s['learning_left']==1
 grade(first,3,2);s=check();assert s['next']['id']==first and s['next']['waits'][2]==app.DAY
 grade(first,3,3);s=check();assert s['learning_left']==0 and s['next'] is None
 for card_id,rev in [(first,4),(second,2)]:
  try:grade(card_id,3,rev)
  except ValueError:pass
  else:raise AssertionError('tomorrow card accepted early')
 # New-card availability and actually due cards keep priority over future learning.
 with contextlib.closing(app.connect()) as db,db:
  db.execute('UPDATE cards SET due=?,interval=600,step=1 WHERE id=?',(now+600,first))
  db.execute("UPDATE settings SET value=3 WHERE key='daily_limit'")
 s=check();assert s['next']['revision']==0 and not s['next'].get('learning_ahead')
 with contextlib.closing(app.connect()) as db,db:db.execute('UPDATE cards SET due=? WHERE id=?',(now-1,second))
 s=check();assert s['next']['id']==second and not s['next'].get('learning_ahead')
 if traces:
  fixture=Path(folder)/'traces.json';fixture.write_text(json.dumps(dict(deck=app.DECK,traces=traces)))
  subprocess.run(['node','-e',r'''
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {deck,traces}=JSON.parse(fs.readFileSync(process.argv[1])),config=JSON.parse(fs.readFileSync('public/index.html','utf8').match(/id="offlineConfig"[^>]*>(.*?)<\/script>/s)[1]);
const ctx={Intl,Date,Math,JSON,Object,document:{getElementById:()=>({textContent:JSON.stringify(config)}),addEventListener(){}},window:{addEventListener(){}},setInterval(){}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync('public/offline.js','utf8')+';globalThis.O=Offline',ctx);
for(const t of traces){const got=ctx.O.project(t,deck,t.now),want=t.expected;
 for(const key of ['due','new_left','reverse_left','learning_left'])assert.equal(got[key],want[key]??(key==='reverse_left'?0:undefined),key);
 assert.equal(got.next?.id,want.next?.id);assert.equal(got.next?.learning_ahead,want.next?.learning_ahead);
}
// Repeat the same flow entirely offline, projecting pending answers after reload.
const t=traces[0],a=t.expected.next.id,b=traces[1].expected.next.id;let events=[];
for(const [id,g,rev,next] of [[a,1,1,b],[b,3,1,a],[a,3,2,a],[a,3,3,null]]){
 events.push({kind:'review',card_id:id,grade:g,revision:rev,recorded_at:t.now});
 const got=ctx.O.project({pack:t.pack,events},deck,t.now);assert.equal(got.next?.id??null,next);
}
console.log('PASS: offline/server parity, pending-queue replay, no premature finish');
''',str(fixture)],check=True)
 print('PASS: depleted quota, repeat failures, alternate learning cards, graduate, protect future/due/new cards')
