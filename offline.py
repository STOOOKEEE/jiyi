"""Offline transport shared by the four study apps; scheduler stays in server.py."""
import json
import math
import re
import time


def initialize(db):
    db.executescript('''
    CREATE TABLE IF NOT EXISTS offline_receipts (
      request_id TEXT PRIMARY KEY, payload TEXT NOT NULL, applied INTEGER NOT NULL, error TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reading_progress (section TEXT PRIMARY KEY, is_read INTEGER NOT NULL);
    ''')


def pack(db, state, reverse):
    now = time.time()
    last = db.execute('SELECT card_id FROM reviews ORDER BY reviewed_at DESC,rowid DESC LIMIT 1').fetchone()
    return dict(state=state, cards=[dict(r) for r in db.execute('SELECT * FROM cards')],
                reverse=reverse, last_card_id=last[0] if last else None, server_now=now,
                reading={r['section']: bool(r['is_read']) for r in db.execute('SELECT * FROM reading_progress')})


def accept(db, payload, review, reading_keys=()):
    if not isinstance(payload, dict) or payload.get('kind') not in {'review', 'reading'}:
        raise ValueError('Action hors ligne invalide.')
    expected = {'kind', 'request_id', 'recorded_at'} | ({'card_id','grade','revision'} if payload['kind']=='review' else {'section','read'})
    if set(payload) != expected:
        raise ValueError('Champs hors ligne invalides.')
    rid, stamp = payload['request_id'], payload['recorded_at']
    if not isinstance(rid, str) or not re.fullmatch(r'[A-Za-z0-9-]{16,80}', rid):
        raise ValueError('Identifiant invalide.')
    if type(stamp) not in (float,int) or not math.isfinite(stamp) or not 0 < stamp <= time.time()+300:
        raise ValueError('Vérifiez la date et l’heure de cet appareil avant de synchroniser.')
    encoded = json.dumps(payload,sort_keys=True)
    db.execute('BEGIN IMMEDIATE')
    prior = db.execute('SELECT * FROM offline_receipts WHERE request_id=?',(rid,)).fetchone()
    if prior:
        if {k:v for k,v in json.loads(prior['payload']).items() if k!='recorded_at'} != {k:v for k,v in payload.items() if k!='recorded_at'}:
            raise ValueError('Identifiant déjà utilisé pour une autre action.')
        return dict(applied=bool(prior['applied']), error=prior['error'])
    db.execute('SAVEPOINT offline_action')
    error = ''
    try:
        if payload['kind']=='review':
            core={k:payload[k] for k in ['card_id','grade','revision','request_id']}
            # Preserve the real study time, not the time the network returned.
            review(db,core,now=min(stamp,time.time()))
        else:
            if not isinstance(payload['section'],str) or payload['section'] not in reading_keys or type(payload['read']) is not bool:
                raise ValueError('Section de cours invalide.')
            db.execute('INSERT OR REPLACE INTO reading_progress VALUES (?,?)',(payload['section'],int(payload['read'])))
    except (ValueError,RuntimeError) as exc:
        db.execute('ROLLBACK TO offline_action')
        error=str(exc)
    db.execute('RELEASE offline_action')
    # Conflicting answers are preserved, never silently discarded or used to overwrite a newer card.
    db.execute('INSERT INTO offline_receipts VALUES (?,?,?,?)',(rid,encoded,int(not error),error))
    return dict(applied=not error,error=error)
