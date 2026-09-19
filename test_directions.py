"""Run with python3 test_directions.py. No changes to the live database."""
import contextlib
import json
from pathlib import Path
import tempfile
import server as app


def run():
 with tempfile.TemporaryDirectory() as folder:
  app.DATABASE=Path(folder)/'directions.sqlite3';app.initialize()
  now=1780000000
  first,second,third=[c['id'] for c in app.DECK[:3]]
  def grade(card_id,value,revision,at,key):
   payload=dict(card_id=card_id,grade=value,revision=revision,request_id='direction-test-'+key)
   with contextlib.closing(app.connect()) as db,db:return app.review(db,payload,at)
  def state(at):
   with contextlib.closing(app.connect()) as db:return app.snapshot(db,at)
  def row(card_id):
   with contextlib.closing(app.connect()) as db:return dict(db.execute('SELECT * FROM cards WHERE id=?',(card_id,)).fetchone())
  with contextlib.closing(app.connect()) as db,db:db.execute("UPDATE settings SET value=2 WHERE key='daily_limit'")
  initial=state(now);assert initial['total_cards']==len(app.DECK)*2 and initial['reverse_left']==0
  assert initial['next']['direction']=='forward' and initial['next']['word_id']==first
  grade(first,3,0,now,'first-forward')
  legacy=row(first)
  # Existing rows/payloads survive startup unchanged; old request shape remains accepted.
  app.initialize();assert row(first)==legacy
  assert grade(first,3,0,now,'first-forward')['reviews_today']==1
  assert state(now)['next']['id']==second  # Avoid showing the sibling immediately when possible.
  grade(second,3,0,now+1,'second-forward')
  before=state(now+1)
  assert before['seen']==2 and before['new_left']==0 and before['reverse_left']==2
  assert before['next']['id']==-first and before['next']['word_id']==first and before['next']['direction']=='reverse'
  # Previously studied words keep their reverse card even after changing the English level.
  if hasattr(app,'LEVELS'):
   with contextlib.closing(app.connect()) as db,db:db.execute("UPDATE settings SET value=2 WHERE key='level'")
  result=grade(-first,1,0,now+2,'first-reverse')
  assert result['seen']==2 and result['cards_seen']==3 and result['reverse_left']==1
  assert row(first)==legacy and row(-first)['interval']==60
  assert grade(-first,1,0,now+2,'first-reverse')['reviews_today']==3
  grade(-second,3,0,now+3,'second-reverse')
  full=state(now+3)
  assert full['new_left']==0 and full['reverse_left']==0 and full['next'] is None
  assert full['seen']==2 and full['cards_seen']==4
  assert row(-second)['interval']==app.DAY
  assert state(now+62)['next']['id']==-first
  grade(-first,3,1,now+62,'reverse-recall-one');assert row(-first)['interval']==600
  grade(-first,3,2,now+662,'reverse-recall-two');assert row(-first)['interval']==app.DAY
  assert row(first)==legacy
  for card_id,rev,error in [(-third,0,ValueError),(-first,0,RuntimeError),(True,0,ValueError),(-999999,0,ValueError)]:
   try:grade(card_id,3,rev,now+663,'invalid-'+str(card_id))
   except error:pass
   else:raise AssertionError('Unexpected acceptance: '+str(card_id))
  # One word still counts once; new reverse cards cannot consume tomorrow's word allowance.
  tomorrow=state(now+app.DAY+1)
  assert tomorrow['seen']==2 and tomorrow['new_left']==2
  assert tomorrow['next']['id']==first  # Existing due cards have priority.
  with contextlib.closing(app.connect()) as db:
   assert len(list(db.execute('SELECT * FROM cards')))==4
   payloads=[json.loads(r[0]) for r in db.execute('SELECT payload FROM reviews')]
   assert any(p['card_id']==-first for p in payloads) and any(p['card_id']==first for p in payloads)
 print('PASS: both directions, independent schedules, preserved history, legacy retry, unique word counts, per-direction daily caps, sibling spacing, due priority and validation.')


if __name__=='__main__':run()
