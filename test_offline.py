"""python3 test_offline.py — isolated queue replay and actual JS/server scheduler parity."""
import contextlib
import json
from pathlib import Path
import subprocess
import tempfile
import time
import uuid
import offline
import server as app

with tempfile.TemporaryDirectory() as folder:
 app.DATABASE=Path(folder)/'offline.sqlite3';app.initialize()
 reverse=hasattr(app,'REVIEW_IDS');modules=getattr(app,'MODULES',())
 now=time.time()-1800
 def capture(t):
  with contextlib.closing(app.connect()) as db:
   result=offline.pack(db,app.snapshot(db,t),reverse);result['server_now']=t;return result
 def accept(event):
  with contextlib.closing(app.connect()) as db,db:return offline.accept(db,event,app.review,modules)
 initial=capture(now);card=initial['state']['next']['id'];events=[];traces=[]
 for grade,wait in [(1,60),(3,600),(3,86400)]:
  event=dict(kind='review',card_id=card,grade=grade,revision=len(events),request_id=str(uuid.uuid4()),recorded_at=now)
  events.append(event);assert accept(event)['applied'];assert accept(event)['applied']
  snap=capture(now);assert next(c for c in snap['cards'] if c['id']==card)['interval']==wait
  traces.append(dict(pack=initial,events=events.copy(),now=now,expected=snap['state']))
  now+=wait
 # Lost reply / legacy pending replay retains the original timestamp and does not duplicate.
 assert accept(dict(events[-1],recorded_at=time.time()))['applied']
 conflict=dict(events[-1],request_id=str(uuid.uuid4()),revision=0,recorded_at=time.time())
 assert not accept(conflict)['applied'];assert not accept(conflict)['applied']
 with contextlib.closing(app.connect()) as db:
  assert db.execute('SELECT COUNT(*) FROM reviews').fetchone()[0]==3
  assert db.execute('SELECT COUNT(*) FROM offline_receipts').fetchone()[0]==4
 if reverse:
  e=dict(kind='review',card_id=-card,grade=3,revision=0,request_id=str(uuid.uuid4()),recorded_at=time.time()-1)
  assert accept(e)['applied']
 if modules:
  e=dict(kind='reading',section=next(iter(modules)),read=True,request_id=str(uuid.uuid4()),recorded_at=time.time())
  assert accept(e)['applied'];assert accept(e)['applied'];assert capture(time.time())['reading'][e['section']]
 for bad in [dict(events[0],recorded_at=float('inf')),dict(events[0],recorded_at=True),dict(events[0],extra=1),dict(events[0],grade=2)]:
  try:accept(bad)
  except ValueError:pass
  else:raise AssertionError('invalid action accepted')
 # Compare exact client queue projections to real server snapshots throughout the learning sequence.
 fixture=Path(folder)/'trace.json';fixture.write_text(json.dumps(dict(deck=app.DECK,traces=traces)))
 subprocess.run(['node','test_offline.cjs',str(fixture)],check=True)
print('PASS offline: delayed replies, retry exactly once, conflict receipts, reading sync, schedule parity')
