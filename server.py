# Digging Tool local server (Python fallback): serves the app and keeps digging-data.json as automatic backup.
# Updates: a newer digging.html in ~/Downloads (or a "digging-tool" folder there) is taken over automatically.
import http.server, json, os, sys, re, shutil, datetime, time, base64, urllib.request, urllib.parse, urllib.error
SERVER_VERSION = 5
DIR = os.path.dirname(os.path.abspath(__file__)); PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
APP = os.path.join(DIR, 'digging.html')
DATA = os.path.join(DIR, 'digging-data.json'); BK = os.path.join(DIR, 'backups')
DL = os.environ.get('DT_DOWNLOADS') or os.path.expanduser('~/Downloads')
def ver_of(t):
    m = re.search(r'name="dt-version" content="(\d+)"', t)
    return int(m.group(1)) if m and '<title>Digging Tool</title>' in t else 0
def installed():
    try: return ver_of(open(APP, encoding='utf-8', errors='ignore').read())
    except OSError: return 0
def install_html(html):
    try:
        os.makedirs(BK, exist_ok=True); shutil.copyfile(APP, os.path.join(BK, 'digging-v%d.html' % installed()))
    except OSError: pass
    open(APP + '.tmp', 'w', encoding='utf-8').write(html); os.replace(APP + '.tmp', APP)
def pick_update():
    try:
        cur = installed(); dirs = [DL]
        for n in os.listdir(DL):
            p = os.path.join(DL, n)
            if n.lower().startswith('digging') and os.path.isdir(p): dirs.append(p)
        best = None
        for d in dirs:
            if os.path.realpath(d) == os.path.realpath(DIR): continue
            for n in os.listdir(d):
                if not re.match(r'(?i)^digging.*\.html?$', n): continue
                p = os.path.join(d, n); t = open(p, encoding='utf-8', errors='ignore').read(); v = ver_of(t)
                if v > cur and (not best or v > best[0]): best = (v, t, p)
        if best: install_html(best[1]); print('Update geinstalleerd: versie %d uit %s' % (best[0], best[2]))
    except OSError: pass
# SoundCloud via your own SoundCloud app (client-credentials flow); key stored only on this Mac, shared by both tools
SC_FILE = os.path.expanduser('~/.digging-tool-soundcloud.json')
def read_sc():
    try: return json.load(open(SC_FILE))
    except Exception: return None
def write_sc(o):
    fd = os.open(SC_FILE + '.tmp', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as f: json.dump(o, f)
    os.replace(SC_FILE + '.tmp', SC_FILE)
def http_req(url, data=None, headers={}):
    r = urllib.request.Request(url, data=data, headers=headers)
    try:
        with urllib.request.urlopen(r, timeout=10) as x: return x.status, x.read().decode('utf-8', 'ignore')
    except urllib.error.HTTPError as e: return e.code, ''
def sc_token(cfg, force=False):
    if not force and cfg.get('token') and cfg.get('exp', 0) > time.time() * 1000 + 60000: return cfg['token']
    h = {'Authorization': 'Basic ' + base64.b64encode((cfg['id'] + ':' + cfg['secret']).encode()).decode(), 'Content-Type': 'application/x-www-form-urlencoded', 'accept': 'application/json; charset=utf-8'}
    st, b = http_req('https://secure.soundcloud.com/oauth/token', b'grant_type=client_credentials', h)
    if st != 200: raise ValueError('SoundCloud accepteert deze Client ID / Secret niet.' if st in (400, 401) else 'SoundCloud gaf HTTP %d' % st)
    j = json.loads(b); cfg.update(token=j['access_token'], exp=time.time() * 1000 + j.get('expires_in', 3600) * 1000); write_sc(cfg)
    return cfg['token']
def sc_api(pathq):
    cfg = read_sc()
    if not cfg or not cfg.get('id'): raise LookupError('niet verbonden')
    url = 'https://api.soundcloud.com' + pathq
    st, b = http_req(url, None, {'Authorization': 'OAuth ' + sc_token(cfg), 'accept': 'application/json; charset=utf-8'})
    if st == 401: st, b = http_req(url, None, {'Authorization': 'OAuth ' + sc_token(cfg, True), 'accept': 'application/json; charset=utf-8'})
    if st != 200: raise ValueError('SoundCloud gaf HTTP %d' % st)
    l = json.loads(b); return l.get('collection', []) if isinstance(l, dict) else l
def sc_slim(t):
    u = t.get('user') or {}
    return {'id': t.get('id'), 'title': t.get('title'), 'user': u.get('username', ''), 'userUrl': u.get('permalink_url', ''), 'artist': (t.get('publisher_metadata') or {}).get('artist', ''),
            'url': t.get('permalink_url'), 'dur': t.get('duration'), 'full': t.get('full_duration') or t.get('duration'), 'access': t.get('access'), 'waveform': t.get('waveform_url'),
            'created': t.get('created_at') or '', 'release': t.get('release_date') or '', 'label': t.get('label_name') or '', 'art': t.get('artwork_url') or '', 'desc': str(t.get('description') or '')[:6000]}
def sc_search(q, limit=20):
    return [sc_slim(t) for t in sc_api('/tracks?limit=%d&access=playable&q=%s' % (min(50, limit), urllib.parse.quote(q)))]
def sc_artist(name):
    nn = lambda s: re.sub(r'[^a-z0-9]+', '', str(s or '').lower())
    try: users = sc_api('/users?limit=10&q=' + urllib.parse.quote(name))
    except Exception: users = []
    u = next((x for x in users if nn(name) in (nn(x.get('username')), nn(x.get('full_name')), nn(x.get('permalink')))), None)
    own = []
    if u:
        try: own = [sc_slim(t) for t in sc_api('/users/%s/tracks?limit=100&access=playable' % (u.get('urn') or u.get('id')))]
        except Exception: pass
    try: other = sc_search(name, 50)
    except Exception: other = []
    return {'user': {'name': u.get('username'), 'url': u.get('permalink_url')} if u else None, 'own': own, 'other': other}
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=DIR, **k)
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache'); super().end_headers()
    def reply(self, code, body, ctype='application/json'):
        self.send_response(code); self.send_header('Content-Type', ctype); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/__backup':
            try: self.reply(200, open(DATA, 'rb').read())
            except OSError: self.reply(404, b'{}')
            return
        if path == '/__info':
            c = read_sc() or {}; return self.reply(200, json.dumps({'server': SERVER_VERSION, 'sc': bool(c.get('id'))}).encode())
        if path == '/__sc/config':
            c = read_sc() or {}; return self.reply(200, json.dumps({'connected': bool(c.get('id')), 'id': c['id'][:4] + '…' if c.get('id') else ''}).encode())
        if path == '/__s79':
            pth = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get('p', [''])[0]
            if not re.match(r'^/(dj|tracklist)/[^?#]+$', pth): return self.reply(400, b'{"error":"alleen set79"}')
            st, b = http_req('https://set79.com' + urllib.parse.quote(pth), None, {'accept': 'text/html', 'user-agent': 'Mozilla/5.0 (Macintosh) DiggingTool'})
            return self.reply(st or 502, (b or '').encode(), 'text/html; charset=utf-8')
        if path == '/__mc':
            t = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get('u', [''])[0]
            if not t.startswith('https://api.mixcloud.com/'): return self.reply(400, b'{"error":"alleen Mixcloud"}')
            st, b = http_req(t, None, {'accept': 'application/json'})
            return self.reply(st or 502, (b or '{}').encode())
        if path == '/__sc/artist':
            n = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get('name', [''])[0]
            try: return self.reply(200, json.dumps(sc_artist(n)).encode())
            except LookupError as e: return self.reply(412, json.dumps({'error': str(e)}).encode())
            except Exception as e: return self.reply(502, json.dumps({'error': str(e)}).encode())
        if path == '/__sc/search':
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query); q = qs.get('q', [''])[0]
            try: return self.reply(200, json.dumps(sc_search(q, int(qs.get('limit', ['20'])[0] or 20))).encode())
            except LookupError as e: return self.reply(412, json.dumps({'error': str(e)}).encode())
            except Exception as e: return self.reply(502, json.dumps({'error': str(e)}).encode())
        if path == '/': self.path = '/digging.html'; path = '/digging.html'
        if path == '/digging.html': pick_update()
        super().do_GET()
    def do_POST(self):
        path = self.path.split('?')[0]
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        if path == '/__update':
            t = body.decode('utf-8', 'ignore'); v = ver_of(t)
            if not v: return self.reply(400, 'Geen Digging Tool-bestand.'.encode(), 'text/plain; charset=utf-8')
            if v <= installed(): return self.reply(409, 'Deze versie is niet nieuwer.'.encode(), 'text/plain; charset=utf-8')
            install_html(t); return self.reply(200, ('{"ok":true,"version":%d}' % v).encode())
        if path == '/__sc/config':
            if 'application/json' not in (self.headers.get('Content-Type') or ''): return self.reply(415, b'{}')
            try: o = json.loads(body); cfg = {'id': str(o.get('id', '')).strip(), 'secret': str(o.get('secret', '')).strip()}
            except Exception: return self.reply(400, b'{"error":"bad json"}')
            if not cfg['id'] or not cfg['secret']: return self.reply(400, json.dumps({'error': 'Vul Client ID en Client Secret in.'}).encode())
            try: sc_token(cfg, True); return self.reply(200, b'{"ok":true}')
            except Exception as e: return self.reply(400, json.dumps({'error': str(e)}).encode())
        if path != '/__backup': self.send_error(404); return
        try: json.loads(body)
        except Exception: self.send_error(400); return
        open(DATA + '.tmp', 'wb').write(body); os.replace(DATA + '.tmp', DATA)
        os.makedirs(BK, exist_ok=True)
        open(os.path.join(BK, 'digging-data-%s.json' % datetime.date.today()), 'wb').write(body)
        self.reply(200, b'{"ok":true}')
    def do_DELETE(self):
        if self.path.split('?')[0] == '/__sc/config':
            try: os.remove(SC_FILE)
            except OSError: pass
            return self.reply(200, b'{"ok":true}')
        self.send_error(404)
    def log_message(self, *a): pass
pick_update()
print('Digging Tool (versie %d) draait op http://127.0.0.1:%d/digging.html' % (installed(), PORT))
http.server.ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
