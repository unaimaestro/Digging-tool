# Digging Tool local server (Python fallback): serves the app and keeps digging-data.json as automatic backup.
# Updates: a newer digging.html in ~/Downloads (or a "digging-tool" folder there) is taken over automatically.
import http.server, json, os, sys, re, shutil, datetime
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
        if path != '/__backup': self.send_error(404); return
        try: json.loads(body)
        except Exception: self.send_error(400); return
        open(DATA + '.tmp', 'wb').write(body); os.replace(DATA + '.tmp', DATA)
        os.makedirs(BK, exist_ok=True)
        open(os.path.join(BK, 'digging-data-%s.json' % datetime.date.today()), 'wb').write(body)
        self.reply(200, b'{"ok":true}')
    def log_message(self, *a): pass
pick_update()
print('Digging Tool (versie %d) draait op http://127.0.0.1:%d/digging.html' % (installed(), PORT))
http.server.ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
