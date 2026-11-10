#!/bin/bash
# Eenmalige installatie van de HOUSE-versie: een tweede Digging Tool met een leeg soundprofiel,
# in ~/DiggingToolHouse, op http://127.0.0.1:8766. Je techno-tool (~/DiggingTool, poort 8765) blijft
# precies zoals hij is. Beide tools updaten zichzelf vanuit dezelfde app, dus een update komt op allebei.
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/DiggingToolHouse"
TECHNO="$HOME/DiggingTool"
PORT=8766
LABEL="nl.diggingtool.house"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
RAW="https://raw.githubusercontent.com/unaimaestro/Digging-tool/main"

mkdir -p "$DEST" "$HOME/Library/LaunchAgents"
ver(){ v=$(sed -n 's/.*name="dt-version" content="\([0-9]*\)".*/\1/p' "$1" 2>/dev/null | head -1); echo "${v:-0}"; }

# app files: next to this script, else from your techno install, else straight from GitHub.
# Your house data (digging-data.json, backups/) in DEST is never touched.
fetch(){ # $1 = file name
  for d in "$SRC" "$TECHNO"; do [ -f "$d/$1" ] && { cp "$d/$1" "$DEST/$1.new"; return 0; }; done
  curl -fsSL "$RAW/$1" -o "$DEST/$1.new" 2>/dev/null
}
for f in server.js server.py; do fetch "$f" && mv "$DEST/$f.new" "$DEST/$f" || rm -f "$DEST/$f.new"; done
# for the app itself take the newest version we can find (GitHub first, then local copies)
curl -fsSL "$RAW/digging.html" -o "$DEST/digging.html.gh" 2>/dev/null || rm -f "$DEST/digging.html.gh"
for c in "$DEST/digging.html.gh" "$SRC/digging.html" "$TECHNO/digging.html"; do
  [ -f "$c" ] && [ "$(ver "$c")" -gt "$(ver "$DEST/digging.html")" ] && cp "$c" "$DEST/digging.html"
done
rm -f "$DEST/digging.html.gh"
[ -f "$DEST/digging.html" ] && [ -f "$DEST/server.js" -o -f "$DEST/server.py" ] || { echo "Kon de app-bestanden niet vinden of downloaden."; read -r -p "Druk op Enter om te sluiten."; exit 1; }

NODE="$(command -v node || true)"
[ -z "$NODE" ] && [ -x /usr/local/bin/node ] && NODE=/usr/local/bin/node
[ -z "$NODE" ] && [ -x /opt/homebrew/bin/node ] && NODE=/opt/homebrew/bin/node

# first install only: take your Spotify Client ID over from the techno tool, so Spotify works right away
if [ ! -f "$DEST/digging-data.json" ] && [ -f "$TECHNO/digging-data.json" ]; then
  if [ -n "$NODE" ]; then
    "$NODE" -e 'const fs=require("fs");let d={};try{d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch(e){}const o={sets:[],likes:[],playlists:[]};["spClient","playerPref"].forEach(k=>{if(d[k])o[k]=d[k]});fs.writeFileSync(process.argv[2],JSON.stringify(o))' "$TECHNO/digging-data.json" "$DEST/digging-data.json" || true
  elif [ -x /usr/bin/python3 ]; then
    /usr/bin/python3 -c 'import json,sys
try: d=json.load(open(sys.argv[1]))
except Exception: d={}
o={"sets":[],"likes":[],"playlists":[]}
for k in ("spClient","playerPref"):
  if d.get(k): o[k]=d[k]
json.dump(o,open(sys.argv[2],"w"))' "$TECHNO/digging-data.json" "$DEST/digging-data.json" || true
  fi
fi

if [ -n "$NODE" ]; then
  ARGS="<string>$NODE</string><string>$DEST/server.js</string><string>$PORT</string>"
elif xcode-select -p >/dev/null 2>&1 && [ -x /usr/bin/python3 ]; then
  ARGS="<string>/usr/bin/python3</string><string>$DEST/server.py</string><string>$PORT</string>"
else
  echo "Geen Node.js of Python gevonden. Installeer Node.js via https://nodejs.org en voer dit opnieuw uit."
  read -r -p "Druk op Enter om te sluiten."; exit 1
fi

cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>$ARGS</array>
  <key>WorkingDirectory</key><string>$DEST</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DEST/server.log</string>
  <key>StandardErrorPath</key><string>$DEST/server.log</string>
</dict></plist>
PL

# (re)start only the house server; the techno server on 8765 is left alone
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
OLD=$(lsof -ti tcp:$PORT -sTCP:LISTEN 2>/dev/null || true); [ -n "$OLD" ] && kill $OLD 2>/dev/null || true
sleep 0.5
launchctl bootstrap "gui/$(id -u)" "$PLIST"

cat > "$HOME/Desktop/Digging Tool House.webloc" <<WL 2>/dev/null || true
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>URL</key><string>http://127.0.0.1:$PORT/digging.html</string></dict></plist>
WL

for i in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null "http://127.0.0.1:$PORT/digging.html" && break; sleep 0.5; done
open "http://127.0.0.1:$PORT/digging.html"
echo ""
echo "Klaar! Digging Tool House draait nu vanzelf, ook na een herstart."
echo "Open hem via 'Digging Tool House' op je bureaublad of http://127.0.0.1:$PORT/digging.html"
echo ""
echo "Spotify: voeg in je Spotify-app (developer.spotify.com > je app > Settings) deze Redirect URI toe:"
echo "    http://127.0.0.1:$PORT/digging.html"
echo "Je kunt dit venster sluiten."
