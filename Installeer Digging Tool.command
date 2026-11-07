#!/bin/bash
# Eenmalige installatie: zet de Digging Tool in ~/DiggingTool en laat hem vanzelf draaien
# (ook na een herstart). Daarna open je de app gewoon via het icoon "Digging Tool" op je bureaublad
# of via http://127.0.0.1:8765. Je kunt dit opnieuw uitvoeren om een nieuwe versie te installeren.
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/DiggingTool"
PORT=8765
LABEL="nl.diggingtool.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

mkdir -p "$DEST" "$HOME/Library/LaunchAgents"
# app files; your data (digging-data.json, backups/) in DEST is left alone
ver(){ v=$(sed -n 's/.*name="dt-version" content="\([0-9]*\)".*/\1/p' "$1" 2>/dev/null | head -1); echo "${v:-0}"; }
for f in server.js server.py; do [ -f "$SRC/$f" ] && cp "$SRC/$f" "$DEST/"; done
# only replace the app with a version that is at least as new as the one already installed
if [ -f "$SRC/digging.html" ] && [ "$(ver "$SRC/digging.html")" -ge "$(ver "$DEST/digging.html")" ]; then cp "$SRC/digging.html" "$DEST/"; fi

NODE="$(command -v node || true)"
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

# stop an older server (from the start script or a previous install), then start this one
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
OLD=$(lsof -ti tcp:$PORT -sTCP:LISTEN 2>/dev/null || true); [ -n "$OLD" ] && kill $OLD 2>/dev/null || true
sleep 0.5
launchctl bootstrap "gui/$(id -u)" "$PLIST"

# desktop shortcut that opens the app in your browser
cat > "$HOME/Desktop/Digging Tool.webloc" <<WL 2>/dev/null || true
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>URL</key><string>http://127.0.0.1:$PORT/digging.html</string></dict></plist>
WL

for i in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null "http://127.0.0.1:$PORT/digging.html" && break; sleep 0.5; done
open "http://127.0.0.1:$PORT/digging.html"
echo ""
echo "Klaar! De Digging Tool draait nu vanzelf, ook na een herstart."
echo "Open hem voortaan via 'Digging Tool' op je bureaublad of http://127.0.0.1:$PORT/digging.html"
echo "Je kunt dit venster sluiten."
