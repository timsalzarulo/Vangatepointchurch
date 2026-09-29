#!/bin/bash
# Double-click to start the Leadership Pipeline app on a Mac.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "Node.js is not installed."
  echo "Download the LTS version from https://nodejs.org, install it, then double-click this file again."
  echo ""
  read -r -p "Press Enter to close..."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "First run: installing (this takes a minute)..."
  npm install --no-fund --no-audit || { read -r -p "Install failed. Press Enter to close..."; exit 1; }
fi

# Open the browser once the server has had a moment to start.
(sleep 2; open "http://127.0.0.1:3000") &
npm start
read -r -p "The app has stopped. Press Enter to close..."
