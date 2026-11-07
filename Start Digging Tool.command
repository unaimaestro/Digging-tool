#!/bin/bash
# Start de Digging Tool op http://127.0.0.1:8765.
# Heb je "Installeer Digging Tool.command" al gedaan, dan opent dit alleen de app (en neemt een nieuwere versie mee).
cd "$(dirname "$0")" || exit 1
PORT=8765
URL="http://127.0.0.1:$PORT/digging.html"
DEST="$HOME/DiggingTool"
PLIST="$HOME/Library/LaunchAgents/nl.diggingtool.server.plist"
ver(){ v=$(sed -n 's/.*name="dt-version" content="\([0-9]*\)".*/\1/p' "$1" 2>/dev/null | head -1); echo "${v:-0}"; }
if [ -f "$PLIST" ] && [ -f "$DEST/digging.html" ]; then
  # installed: hand a newer app to the installed version and just open it
  if [ "$(ver digging.html)" -gt "$(ver "$DEST/digging.html")" ]; then
    mkdir -p "$DEST/backups"; cp "$DEST/digging.html" "$DEST/backups/digging-v$(ver "$DEST/digging.html").html"; cp digging.html "$DEST/"
    for f in server.js server.py; do [ -f "$f" ] && cp "$f" "$DEST/"; done
    launchctl kickstart -k "gui/$(id -u)/nl.diggingtool.server" 2>/dev/null; sleep 1
  fi
  curl -s -o /dev/null "$URL" || { launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null; sleep 1; }
  open "$URL"; exit 0
fi
# not installed: run the server from this folder (close this window to stop it)
OLD=$(lsof -ti tcp:$PORT -sTCP:LISTEN 2>/dev/null); [ -n "$OLD" ] && kill $OLD 2>/dev/null && sleep 0.5
(sleep 1; open "$URL") &
if command -v node >/dev/null 2>&1; then
  exec node server.js $PORT
elif xcode-select -p >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then
  exec python3 server.py $PORT
else
  echo "Geen node of python3 gevonden. Installeer Node.js via https://nodejs.org en probeer opnieuw."
  read -r -p "Druk op Enter om te sluiten."
fi
