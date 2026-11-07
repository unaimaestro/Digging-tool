// Digging Tool local server: serves the app and keeps an automatic backup of your data
// in digging-data.json (plus one copy per day in backups/).
// Updates: a newer digging.html in ~/Downloads (or a "digging-tool" folder there) is taken over automatically.
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const DIR = __dirname, PORT = +process.argv[2] || 8765;
const APP = path.join(DIR, 'digging.html');
const DATA = path.join(DIR, 'digging-data.json'), BK = path.join(DIR, 'backups');
const DL = process.env.DT_DOWNLOADS || path.join(os.homedir(), 'Downloads');
const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json'};
const verOf = t => { const m = /name="dt-version" content="(\d+)"/.exec(t); return m && /<title>Digging Tool<\/title>/.test(t) ? +m[1] : 0; };
const installed = () => { try { return verOf(fs.readFileSync(APP, 'utf8')); } catch(e){ return 0; } };
function installHtml(html){
  try { fs.mkdirSync(BK, {recursive: true}); fs.copyFileSync(APP, path.join(BK, 'digging-v' + installed() + '.html')); } catch(e){}
  fs.writeFileSync(APP + '.tmp', html); fs.renameSync(APP + '.tmp', APP);
}
// look for a newer digging*.html in Downloads (top level and digging* folders one level down)
function pickUpdate(){
  try {
    const cur = installed(), dirs = [DL];
    for (const n of fs.readdirSync(DL)){ if (/^digging/i.test(n)){ const p = path.join(DL, n); try { if (fs.statSync(p).isDirectory()) dirs.push(p); } catch(e){} } }
    let best = null;
    for (const d of dirs){
      if (path.resolve(d) === path.resolve(DIR)) continue;
      for (const n of fs.readdirSync(d)){
        if (!/^digging.*\.html?$/i.test(n)) continue;
        const p = path.join(d, n), t = fs.readFileSync(p, 'utf8'), v = verOf(t);
        if (v > cur && (!best || v > best.v)) best = {v, t, p};
      }
    }
    if (best){ installHtml(best.t); console.log('Update geinstalleerd: versie ' + best.v + ' uit ' + best.p); }
  } catch(e){ /* no access to Downloads: the in-app "Installeer update" button still works */ }
}
http.createServer((q, s) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  if (u === '/__backup'){
    if (q.method === 'GET'){
      fs.readFile(DATA, (e, d) => { s.writeHead(e ? 404 : 200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}); s.end(e ? '{}' : d); });
      return;
    }
    if (q.method === 'POST'){
      let body = '';
      q.on('data', c => { body += c; if (body.length > 50e6) q.destroy(); });
      q.on('end', () => {
        try { JSON.parse(body); } catch(e){ s.writeHead(400); return s.end('bad json'); }
        fs.writeFile(DATA + '.tmp', body, e => {
          if (e){ s.writeHead(500); return s.end(String(e)); }
          fs.renameSync(DATA + '.tmp', DATA);
          try { fs.mkdirSync(BK, {recursive: true}); fs.writeFileSync(path.join(BK, 'digging-data-' + new Date().toISOString().slice(0, 10) + '.json'), body); } catch(e){}
          s.writeHead(200, {'Content-Type': 'application/json'}); s.end('{"ok":true}');
        });
      });
      return;
    }
  }
  if (u === '/__update' && q.method === 'POST'){
    let body = '';
    q.on('data', c => { body += c; if (body.length > 20e6) q.destroy(); });
    q.on('end', () => {
      const v = verOf(body);
      if (!v){ s.writeHead(400); return s.end('Geen Digging Tool-bestand.'); }
      if (v <= installed()){ s.writeHead(409); return s.end('Deze versie is niet nieuwer.'); }
      try { installHtml(body); s.writeHead(200, {'Content-Type': 'application/json'}); s.end('{"ok":true,"version":' + v + '}'); }
      catch(e){ s.writeHead(500); s.end(String(e)); }
    });
    return;
  }
  let f = u === '/' ? '/digging.html' : u;
  if (f === '/digging.html') pickUpdate();
  const p = path.join(DIR, path.normalize(f));
  if (!p.startsWith(DIR)){ s.writeHead(403); return s.end(); }
  fs.readFile(p, (e, d) => {
    if (e){ s.writeHead(404); return s.end('not found'); }
    s.writeHead(200, {'Content-Type': types[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache'}); s.end(d);
  });
}).listen(PORT, '127.0.0.1', () => { pickUpdate(); console.log('Digging Tool (versie ' + installed() + ') draait op http://127.0.0.1:' + PORT + '/digging.html'); });
