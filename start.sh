#!/bin/bash
# Bathy-Data one-click launcher for Linux.
cd "$(dirname "$0")" || exit 1

echo "Bathy-Data — starting up"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install it (https://nodejs.org) and run again."
  read -r -p "Press Enter to close."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run only)…"
  npm install || { echo "npm install failed."; read -r -p "Press Enter."; exit 1; }
fi

echo "Building the app…"
npm run build || { echo "Build failed."; read -r -p "Press Enter."; exit 1; }

echo "Opening http://localhost:8787 …  (Ctrl+C to stop)"
( sleep 2; xdg-open "http://localhost:8787" >/dev/null 2>&1 ) &
npm start
