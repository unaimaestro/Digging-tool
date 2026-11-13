// Digging Tool local server: serves the app and keeps an automatic backup of your data
// in digging-data.json (plus one copy per day in backups/).
// Updates: a newer digging.html in ~/Downloads (or a "digging-tool" folder there) is taken over automatically.
// SoundCloud: with your own SoundCloud app (Client ID + Secret, stored only on this Mac) the tool finds tracks on SoundCloud.
// The server also keeps itself up to date from GitHub, like the app does.
const SERVER_VERSION = 3;
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm');
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
// ---------- SoundCloud (official API, client-credentials flow) ----------
const SC_FILE = path.join(os.homedir(), '.digging-tool-soundcloud.json');   // shared by the techno and house tool
const readSc = () => { try { return JSON.parse(fs.readFileSync(SC_FILE, 'utf8')); } catch(e){ return null; } };
const writeSc = o => { fs.writeFileSync(SC_FILE + '.tmp', JSON.stringify(o), {mode: 0o600}); fs.renameSync(SC_FILE + '.tmp', SC_FILE); };
function req(url, {method = 'GET', headers = {}, body = null} = {}){
  return new Promise((res, rej) => {
    const r = https.request(url, {method, headers, timeout: 10000}, x => {
      if (x.statusCode >= 300 && x.statusCode < 400 && x.headers.location) return req(new URL(x.headers.location, url).href, {headers}).then(res, rej);
      let d = ''; x.setEncoding('utf8'); x.on('data', c => d += c); x.on('end', () => res({status: x.statusCode, body: d}));
    });
    r.on('timeout', () => r.destroy(new Error('timeout'))); r.on('error', rej);
    if (body) r.write(body); r.end();
  });
}
async function scToken(cfg, force){
  if (!force && cfg.token && cfg.exp > Date.now() + 60000) return cfg.token;
  const basic = Buffer.from(cfg.id + ':' + cfg.secret).toString('base64');
  const h = {'Authorization': 'Basic ' + basic, 'Content-Type': 'application/x-www-form-urlencoded', 'accept': 'application/json; charset=utf-8'};
  let r = null;
  if (cfg.refresh && !force) r = await req('https://secure.soundcloud.com/oauth/token', {method: 'POST', headers: h, body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(cfg.refresh)});
  if (!r || r.status !== 200) r = await req('https://secure.soundcloud.com/oauth/token', {method: 'POST', headers: h, body: 'grant_type=client_credentials'});
  if (r.status !== 200){ const e = new Error(r.status === 401 || r.status === 400 ? 'SoundCloud accepteert deze Client ID / Secret niet.' : r.status === 429 ? 'SoundCloud: te veel aanmeldingen, probeer het over een uur opnieuw.' : 'SoundCloud gaf HTTP ' + r.status); e.status = r.status; throw e; }
  const j = JSON.parse(r.body);
  Object.assign(cfg, {token: j.access_token, refresh: j.refresh_token || cfg.refresh, exp: Date.now() + (j.expires_in || 3600) * 1000});
  writeSc(cfg);
  return cfg.token;
}
async function scApi(pathq){
  const cfg = readSc(); if (!cfg || !cfg.id) { const e = new Error('niet verbonden'); e.status = 412; throw e; }
  const url = 'https://api.soundcloud.com' + pathq;
  const get = async force => req(url, {headers: {'Authorization': 'OAuth ' + await scToken(cfg, force), 'accept': 'application/json; charset=utf-8'}});
  let r = await get(false);
  if (r.status === 401) r = await get(true);
  if (r.status !== 200){ const e = new Error('SoundCloud gaf HTTP ' + r.status); e.status = 502; throw e; }
  const d = JSON.parse(r.body); return d && d.collection ? d.collection : (d || []);
}
const scSlim = t => ({id: t.id, title: t.title, user: (t.user || {}).username || '', userUrl: (t.user || {}).permalink_url || '', artist: (t.publisher_metadata || {}).artist || '',
  url: t.permalink_url, dur: t.duration, full: t.full_duration || t.duration, access: t.access, waveform: t.waveform_url, created: t.created_at || '', release: t.release_date || '', label: t.label_name || '', art: t.artwork_url || '', desc: String(t.description || '').slice(0, 6000)});
async function scSearch(q, limit = 20){
  return (await scApi('/tracks?limit=' + Math.min(50, limit) + '&access=playable&q=' + encodeURIComponent(q))).map(scSlim);
}
// an artist: their own SoundCloud account (if a name matches exactly) with its uploads, plus tracks by others that name them
async function scArtist(name){
  const nn = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');
  const users = await scApi('/users?limit=10&q=' + encodeURIComponent(name)).catch(() => []);
  const u = users.find(x => nn(x.username) === nn(name) || nn(x.full_name) === nn(name) || nn(x.permalink) === nn(name)) || null;
  const own = u ? (await scApi('/users/' + (u.urn || u.id) + '/tracks?limit=100&access=playable').catch(() => [])).map(scSlim) : [];
  const other = await scSearch(name, 50).catch(() => []);
  return {user: u ? {name: u.username, url: u.permalink_url} : null, own, other};
}
const json = (s, code, o) => { s.writeHead(code, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}); s.end(JSON.stringify(o)); };
function readBody(q, max, cb){ let b = ''; q.on('data', c => { b += c; if (b.length > max) q.destroy(); }); q.on('end', () => cb(b)); }

// ---------- self-update of this server file from GitHub ----------
const RAW = 'https://raw.githubusercontent.com/unaimaestro/Digging-tool/main/server.js';
async function serverUpdate(){
  try {
    const r = await req(RAW); if (r.status !== 200) return;
    const m = /const SERVER_VERSION = (\d+);/.exec(r.body);
    if (!m || +m[1] <= SERVER_VERSION || !/Digging Tool local server/.test(r.body)) return;
    new vm.Script(r.body);   // must at least compile
    const me = __filename;
    try { fs.mkdirSync(BK, {recursive: true}); fs.copyFileSync(me, path.join(BK, 'server-v' + SERVER_VERSION + '.js')); } catch(e){}
    fs.writeFileSync(me + '.tmp', r.body); fs.renameSync(me + '.tmp', me);
    console.log('Server bijgewerkt naar versie ' + m[1]);
    if (process.env.XPC_SERVICE_NAME || process.ppid === 1) setTimeout(() => process.exit(0), 500);   // launchd starts the new one
  } catch(e){}
}
setTimeout(serverUpdate, 20000); setInterval(serverUpdate, 3 * 3600e3);

http.createServer((q, s) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  if (u === '/__info') return json(s, 200, {server: SERVER_VERSION, sc: !!(readSc() || {}).id});
  if (u === '/__sc/search'){
    const qs = new URL(q.url, 'http://x').searchParams.get('q') || '';
    scSearch(qs, +new URL(q.url, 'http://x').searchParams.get('limit') || 20).then(r => json(s, 200, r), e => json(s, e.status || 500, {error: e.message}));
    return;
  }
  if (u === '/__sc/artist'){
    const name = new URL(q.url, 'http://x').searchParams.get('name') || '';
    scArtist(name).then(r => json(s, 200, r), e => json(s, e.status || 500, {error: e.message}));
    return;
  }
  if (u === '/__mc'){
    // Mixcloud API pass-through (only api.mixcloud.com), for when the browser can't reach it directly
    const t = new URL(q.url, 'http://x').searchParams.get('u') || '';
    if (!/^https:\/\/api\.mixcloud\.com\//.test(t)) return json(s, 400, {error: 'alleen Mixcloud'});
    req(t, {headers: {'accept': 'application/json'}}).then(r => { s.writeHead(r.status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}); s.end(r.body); }, e => json(s, 502, {error: e.message}));
    return;
  }
  if (u === '/__sc/config'){
    // JSON only: a browser won't send that from another site without asking us first, and we don't allow it
    if (q.method === 'GET'){ const c = readSc(); return json(s, 200, {connected: !!(c && c.id), id: c && c.id ? c.id.slice(0, 4) + '…' : ''}); }
    if (q.method === 'DELETE'){ try { fs.unlinkSync(SC_FILE); } catch(e){} return json(s, 200, {ok: true}); }
    if (q.method === 'POST'){
      if (!/application\/json/.test(q.headers['content-type'] || '')) return json(s, 415, {error: 'json'});
      return readBody(q, 4096, async b => {
        let o; try { o = JSON.parse(b); } catch(e){ return json(s, 400, {error: 'bad json'}); }
        const cfg = {id: String(o.id || '').trim(), secret: String(o.secret || '').trim()};
        if (!cfg.id || !cfg.secret) return json(s, 400, {error: 'Vul Client ID en Client Secret in.'});
        try { await scToken(cfg, true); json(s, 200, {ok: true}); } catch(e){ json(s, 400, {error: e.message}); }
      });
    }
  }
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
