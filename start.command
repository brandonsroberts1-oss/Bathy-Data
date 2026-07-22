#!/bin/bash
# Bathy-Data one-click launcher for macOS.
# Double-click this file in Finder. (First run: right-click > Open to approve it.)
cd "$(dirname "$0")" || exit 1

echo "======================================"
echo "   Bathy-Data — starting up"
echo "======================================"

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "Node.js is not installed."
  echo "Install the LTS version from https://nodejs.org, then run this again."
  echo
  read -r -p "Press Enter to close."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run only, ~30s)…"
  npm install || { echo "npm install failed."; read -r -p "Press Enter to close."; exit 1; }
fi

echo "Building the app…"
npm run build || { echo "Build failed."; read -r -p "Press Enter to close."; exit 1; }

echo
echo "Opening http://localhost:8787 in your browser…"
echo "Leave this window open while you use the app. Close it (or press Ctrl+C) to stop."
( sleep 2; open "http://localhost:8787" ) &
npm start
