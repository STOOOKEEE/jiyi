"""Run with python3 test.py. Tests use an isolated temporary database."""
import contextlib
import json
from pathlib import Path
import tempfile
import threading
import urllib.error
import urllib.request
import server as app


def run():
    with tempfile.TemporaryDirectory() as tmp:
        app.DATABASE = Path(tmp) / 'progress.sqlite3'
        app.initialize()
        now = 1780000000
        payload = dict(card_id=1, grade=3, revision=0, request_id='first-review-request-0001')
        with contextlib.closing(app.connect()) as db, db:
            assert app.snapshot(db, now)['new_left'] == 10
            result = app.review(db, payload, now)
            assert result['seen'] == 1 and result['reviews_today'] == 1 and result['new_left'] == 9
        with contextlib.closing(app.connect()) as db, db:
            assert app.review(db, payload, now)['reviews_today'] == 1  # Lost response retry.
        with contextlib.closing(app.connect()) as db:
            card = dict(db.execute('SELECT * FROM cards WHERE id=1').fetchone())
            assert card['due'] == now + 600 and card['revision'] == 1
            assert app.snapshot(db, now + 601)['next']['id'] == 1  # Due reviews before new words.
            assert app.schedule(card, 3)[1] == app.DAY
            assert app.schedule(card, 4)[1] == 4 * app.DAY
            assert app.schedule(card, 1)[1] == 60
        for bad, when, expected in [
            ({**payload, 'request_id':'different-request-0001'}, now + 601, RuntimeError),
            ({**payload, 'grade':4}, now, ValueError),
            ({**payload, 'grade':True}, now, ValueError),
            ({**payload, 'card_id':999}, now, ValueError),
            ({**payload, 'revision':1, 'request_id':'too-early-request-0001'}, now, ValueError),
        ]:
            try:
                with contextlib.closing(app.connect()) as db, db:
                    app.review(db, bad, when)
            except expected:
                pass
            else:
                raise AssertionError('Expected rejection: ' + repr(bad))
        with contextlib.closing(app.connect()) as db, db:
            db.execute("UPDATE settings SET value=1 WHERE key='daily_limit'")
            assert app.snapshot(db, now)['new_left'] == 0
            assert app.snapshot(db, now + app.DAY)['new_left'] == 1
        http = app.ThreadingHTTPServer(('127.0.0.1', 0), app.Handler)
        app.ORIGIN = f'http://127.0.0.1:{http.server_port}'
        app.LOGIN = 'test@example.test'
        thread = threading.Thread(target=http.serve_forever, daemon=True)
        thread.start()

        def request(path, data=None, extra=None, auth=True):
            headers = {'Tailscale-User-Login': app.LOGIN} if auth else {}
            if data is not None:
                headers.update({'Content-Type':'application/json','Origin':app.ORIGIN,'X-CSRF-Token':app.CSRF})
            headers.update(extra or {})
            req = urllib.request.Request(app.ORIGIN + path, data=json.dumps(data).encode() if data is not None else None, headers=headers)
            try:
                response = urllib.request.urlopen(req)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                return response.status, response.read(), response.headers

        try:
            assert request('/api/state', auth=False)[0] == 403
            assert request('/api/state')[0] == 200
            assert request('/')[0] == 200
            assert request('/../../server.py')[0] == 404
            assert request('/data/progress.sqlite3')[0] == 404
            assert request('/api/settings', {'daily_limit':20}, {'Origin':'https://untrusted.test'})[0] == 403
            assert request('/api/settings', {'daily_limit':True})[0] == 400
            assert request('/api/settings', {'daily_limit':20})[0] == 200
            audio = '/' + app.DECK[0]['audio_word']
            status, body, headers = request(audio, extra={'Range':'bytes=0-1'})
            assert status == 206 and len(body) == 2 and headers['Content-Range'].startswith('bytes 0-1/')
            assert request(audio, extra={'Range':'bytes=999999999-'})[0] == 416
            assert len(request(audio, extra={'Range':'bytes=-5'})[1]) == 5
            backup = json.loads(request('/api/export')[1])
            assert len(backup['cards']) == 1 and len(backup['reviews']) == 1
            assert all((app.PUBLIC / c[k]).is_file() for c in app.DECK for k in ['audio_word','audio_sentence'])
        finally:
            http.shutdown()
            http.server_close()
    print('PASS: scheduling, persistence, daily limit, idempotency, stale/conflicting reviews, auth, CSRF, private files, iOS audio ranges, export and 500 card assets.')


if __name__ == '__main__':
    run()
