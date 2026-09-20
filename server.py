"""Personal Mandarin review app. Python standard library only; run behind Tailscale Serve."""
import offline
import contextlib
import datetime as dt
import hmac
import json
import math
import mimetypes
import os
from pathlib import Path
import re
import secrets
import sqlite3
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / 'public'
DATABASE = Path(os.environ.get('MANDARIN_DB', ROOT / 'data/progress.sqlite3'))
PORT = int(os.environ.get('PORT', '8766'))
ORIGIN = os.environ.get('PUBLIC_ORIGIN', f'http://127.0.0.1:{PORT}')
LOGIN = os.environ.get('TAILSCALE_LOGIN', '')
CSRF = secrets.token_urlsafe(32)
DECK = json.loads((PUBLIC / 'deck.json').read_text())
IDS = {c['id'] for c in DECK}
# Positive IDs keep existing recognition history; negative IDs are independent French prompts.
REVIEW_IDS = IDS | {-word_id for word_id in IDS}
DAY = 86400
PARIS = ZoneInfo('Europe/Paris')


def connect():
    db = sqlite3.connect(DATABASE, timeout=10)
    db.row_factory = sqlite3.Row
    return db


def initialize():
    DATABASE.parent.mkdir(parents=True, exist_ok=True)
    with contextlib.closing(connect()) as db, db:
        db.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS cards (
          id INTEGER PRIMARY KEY, due REAL NOT NULL, interval INTEGER NOT NULL,
          step INTEGER NOT NULL, ease REAL NOT NULL, revision INTEGER NOT NULL,
          first_seen REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS reviews (
          request_id TEXT PRIMARY KEY, card_id INTEGER NOT NULL,
          grade INTEGER NOT NULL, reviewed_at REAL NOT NULL,
          payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
        INSERT OR IGNORE INTO settings VALUES ('daily_limit',10);
        ''')
        offline.initialize(db)


def schedule(card, grade):
    """Small spaced-repetition scheduler; not Anki's FSRS algorithm."""
    step, interval, ease = card['step'], card['interval'], card['ease']
    if grade == 1:
        return 0, 60, max(1.3, ease - .2)
    if grade == 2:
        return step, 600 if interval < DAY else math.ceil(interval / DAY * 1.2) * DAY, max(1.3, ease - .15)
    if grade == 3:
        if card['revision'] == 0:
            return 2, DAY, ease  # Known immediately: skip the short learning step.
        wait = 600 if step == 0 else DAY if step == 1 else 6 * DAY if step == 2 else max(DAY, round(interval / DAY * ease) * DAY)
        return step + 1, wait, ease
    wait = 4 * DAY if interval < DAY else max(schedule(card, 3)[1] + DAY, round(interval / DAY * ease * 1.3) * DAY)
    return max(3, step + 1), wait, min(3.0, ease + .15)


def fresh(card_id):
    return dict(id=card_id, due=0, interval=0, step=0, ease=2.5, revision=0)


def snapshot(db, now=None):
    now = time.time() if now is None else now
    midnight = dt.datetime.fromtimestamp(now, PARIS).replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
    cards = {r['id']: dict(r) for r in db.execute('SELECT * FROM cards')}
    seen_words = {abs(card_id) for card_id in cards}
    limit = db.execute("SELECT value FROM settings WHERE key='daily_limit'").fetchone()[0]
    introduced = sum(r['id'] > 0 and midnight <= r['first_seen'] <= now for r in cards.values())
    reverse_introduced = sum(r['id'] < 0 and midnight <= r['first_seen'] <= now for r in cards.values())
    due = sorted((r for r in cards.values() if r['due'] <= now), key=lambda r: (r['due'], r['id']))
    unseen = [c['id'] for c in DECK if c['id'] not in seen_words]
    reverse = [-c['id'] for c in DECK if c['id'] in cards and -c['id'] not in cards]
    new_left = min(len(unseen), max(0, limit - introduced))
    reverse_left = min(len(reverse), max(0, limit - reverse_introduced))
    new_id = reverse[0] if reverse_left else unseen[0] if new_left else None
    # Separate sibling cards when another new word is available.
    if reverse_left and new_left:
        last = db.execute('SELECT card_id FROM reviews ORDER BY reviewed_at DESC, rowid DESC LIMIT 1').fetchone()
        if last and abs(last[0]) == abs(new_id):
            new_id = unseen[0]
    card = dict(due[0]) if due else fresh(new_id) if new_id is not None else None
    # Finish short learning steps after due/new cards, instead of ending the session.
    learning = sorted((r for r in cards.values() if r['interval'] < DAY), key=lambda r: (r['due'], r['id']))
    ahead = card is None and bool(learning) and learning[0]['due'] <= now + 1200
    if ahead:
        last = db.execute('SELECT card_id FROM reviews ORDER BY reviewed_at DESC, rowid DESC LIMIT 1').fetchone()
        card = dict(next((r for r in learning if r['due'] <= now + 1200 and (not last or r['id'] != last[0])), learning[0]))
        card['learning_ahead'] = True
    if card:
        card.update(word_id=abs(card['id']), direction='reverse' if card['id'] < 0 else 'forward',
                    waits=[schedule(card, g)[1] for g in range(1, 5)])
    future = [r['due'] for r in cards.values() if r['due'] > now]
    return dict(next=card, learning_left=len(learning), due=len(due), new_left=new_left, reverse_left=reverse_left,
                seen=len(seen_words), total=len(IDS), cards_seen=len(cards), total_cards=len(REVIEW_IDS),
                retained=sum(all(cards.get(i, {}).get('interval', 0) >= 21 * DAY for i in (word_id, -word_id)) for word_id in seen_words),
                reviews_today=db.execute('SELECT COUNT(*) FROM reviews WHERE reviewed_at >= ? AND reviewed_at <= ?', (midnight,now)).fetchone()[0],
                daily_limit=limit, next_due=min(future) if future else None, csrf=CSRF)


def review(db, payload, now=None):
    now = time.time() if now is None else now
    if not isinstance(payload, dict) or set(payload) != {'card_id', 'grade', 'revision', 'request_id'}:
        raise ValueError('Réponse invalide.')
    card_id, grade, revision, request_id = (payload[k] for k in ('card_id', 'grade', 'revision', 'request_id'))
    if type(card_id) is not int or card_id not in REVIEW_IDS or type(grade) is not int or grade not in range(1, 5):
        raise ValueError('Carte ou évaluation invalide.')
    if type(revision) is not int or revision < 0 or not isinstance(request_id, str) or not re.fullmatch(r'[A-Za-z0-9-]{16,80}', request_id):
        raise ValueError('Identifiant de révision invalide.')
    encoded = json.dumps(payload, sort_keys=True)
    if not db.in_transaction:
        db.execute('BEGIN IMMEDIATE')
    previous = db.execute('SELECT payload FROM reviews WHERE request_id=?', (request_id,)).fetchone()
    if previous:
        if previous[0] != encoded:
            raise ValueError('Identifiant déjà utilisé.')
        return snapshot(db, now)
    record = db.execute('SELECT * FROM cards WHERE id=?', (card_id,)).fetchone()
    card = dict(record) if record else fresh(card_id)
    if card['revision'] != revision:
        raise RuntimeError('Cette carte a été révisée sur un autre appareil. La liste a été actualisée.')
    if record and card['due'] > now:
        offered = snapshot(db, now)['next']
        if not offered or offered['id'] != card_id or not offered.get('learning_ahead'):
            raise ValueError('Cette carte n’est pas encore à réviser.')
    if not record:
        available = snapshot(db, now)
        if card_id < 0 and not db.execute('SELECT 1 FROM cards WHERE id=?', (-card_id,)).fetchone():
            raise ValueError('Découvrez d’abord ce mot dans le sens vers le français.')
        if not available['reverse_left' if card_id < 0 else 'new_left']:
            raise ValueError('La limite de nouvelles cartes dans ce sens est atteinte pour aujourd’hui.')
    step, interval, ease = schedule(card, grade)
    db.execute('INSERT OR REPLACE INTO cards VALUES (?,?,?,?,?,?,?)',
               (card_id, now + interval, interval, step, ease, revision + 1, card.get('first_seen', now)))
    db.execute('INSERT INTO reviews VALUES (?,?,?,?,?)', (request_id, card_id, grade, now, encoded))
    return snapshot(db, now)


class Handler(BaseHTTPRequestHandler):
    server_version = 'Mandarin'

    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def send(self, status, body, content_type='application/json; charset=utf-8', extra=None):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store' if content_type.startswith('application/json') else 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'same-origin')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; frame-ancestors 'none'; base-uri 'none'")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def authorized(self):
        # ponytail: one personal profile; use separate profiles before sharing with other people.
        if self.headers.get('Host') not in {urlsplit(ORIGIN).netloc, f'127.0.0.1:{PORT}'}:
            self.send(403, {'error': 'Adresse non autorisée.'})
            return False
        if LOGIN and not hmac.compare_digest(self.headers.get('Tailscale-User-Login', ''), LOGIN):
            self.send(403, {'error': 'Connecte cet appareil à ton compte Tailscale.'})
            return False
        return True

    def do_GET(self):
        if not self.authorized():
            return
        path = urlsplit(self.path).path
        if path=='/api/offline':
            with contextlib.closing(connect()) as db:return self.send(200,offline.pack(db,snapshot(db),True))
        if path in {'/api/state', '/api/export'}:
            with contextlib.closing(connect()) as db:
                if path == '/api/state':
                    return self.send(200, snapshot(db))
                backup = dict(version=2, card_id_encoding='positive=foreign-to-fr; negative=fr-to-foreign; abs(id)=word_id', exported_at=time.time(), cards=[dict(r) for r in db.execute('SELECT * FROM cards')],
                              reviews=[dict(r) for r in db.execute('SELECT * FROM reviews')],
                              offline_receipts=[dict(r) for r in db.execute('SELECT * FROM offline_receipts')],
                              reading=[dict(r) for r in db.execute('SELECT * FROM reading_progress')],
                              settings=[dict(r) for r in db.execute('SELECT * FROM settings')])
                return self.send(200, backup, extra={'Content-Disposition': 'attachment; filename="mandarin-progression.json"'})
        allowed = {'/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/offline.js':'offline.js', '/sw.js':'sw.js', '/offline-assets.json':'offline-assets.json', '/style.css': 'style.css',
                   '/deck.json': 'deck.json', '/manifest.webmanifest': 'manifest.webmanifest',
                   '/icon-192.png': 'icon-192.png', '/icon-512.png': 'icon-512.png', '/apple-touch-icon.png': 'apple-touch-icon.png',
                   '/LICENSE-vocabulary.txt': 'LICENSE-vocabulary.txt'}
        if re.fullmatch(r'/media/zhfr_[a-f0-9]{20}\.mp3', path):
            filename = path[1:]
        else:
            filename = allowed.get(path)
        if not filename or not (PUBLIC / filename).is_file():
            return self.send(404, {'error': 'Page introuvable.'})
        data = (PUBLIC / filename).read_bytes()
        kind = 'application/manifest+json' if filename.endswith('.webmanifest') else mimetypes.guess_type(filename)[0] or 'application/octet-stream'
        headers = {'Accept-Ranges': 'bytes'}
        raw_range = self.headers.get('Range')
        if raw_range:
            match = re.fullmatch(r'bytes=(\d*)-(\d*)', raw_range)
            if not match or not any(match.groups()):
                return self.send(416, b'', kind, {'Content-Range': f'bytes */{len(data)}'})
            first, last = match.groups()
            start = int(first) if first else max(0, len(data) - int(last))
            end = min(int(last), len(data) - 1) if first and last else len(data) - 1
            if start > end or start >= len(data):
                return self.send(416, b'', kind, {'Content-Range': f'bytes */{len(data)}'})
            headers['Content-Range'] = f'bytes {start}-{end}/{len(data)}'
            return self.send(206, data[start:end + 1], kind, headers)
        self.send(200, data, kind, headers)

    do_HEAD = do_GET

    def do_POST(self):
        if not self.authorized():
            return
        if self.headers.get('Origin') != ORIGIN or not hmac.compare_digest(self.headers.get('X-CSRF-Token', ''), CSRF):
            return self.send(403, {'error': 'Recharge la page pour reprendre la session.'})
        if self.headers.get('Content-Type') != 'application/json':
            return self.send(415, {'error': 'Format non accepté.'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 2048:
                raise ValueError('Requête trop grande ou vide.')
            payload = json.loads(self.rfile.read(size))
            with contextlib.closing(connect()) as db, db:
                if self.path == '/api/review':
                    result = review(db, payload)
                elif self.path == '/api/offline-review':
                    outcome=offline.accept(db,payload,review,())
                    result={'outcome':outcome,'pack':offline.pack(db,snapshot(db),True)}
                elif self.path == '/api/settings':
                    if not isinstance(payload, dict) or set(payload) != {'daily_limit'} or type(payload['daily_limit']) is not int or not 1 <= payload['daily_limit'] <= 50:
                        raise ValueError('Choisis entre 1 et 50 nouveaux mots par jour.')
                    db.execute("UPDATE settings SET value=? WHERE key='daily_limit'", (payload['daily_limit'],))
                    result = snapshot(db)
                else:
                    return self.send(404, {'error': 'Action inconnue.'})
            self.send(200, result)
        except (ValueError, UnicodeError) as exc:
            self.send(400, {'error': str(exc)})
        except RuntimeError as exc:
            self.send(409, {'error': str(exc)})
        except sqlite3.Error:
            self.send(503, {'error': 'Sauvegarde temporairement indisponible. Réessaie : ta réponse reste en attente.'})


if __name__ == '__main__':
    initialize()
    print(f'Mandarin: http://127.0.0.1:{PORT}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
