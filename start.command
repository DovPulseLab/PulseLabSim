#!/bin/bash
# Pulse Lab Simulator — launcher for macOS
# Double-click this file in Finder, or run:  bash start.command
cd "$(dirname "$0")" || exit 1

echo ""
echo "  Pulse Lab Simulator v2"
echo "  ----------------------"

if ! command -v npm >/dev/null 2>&1; then
  echo "  Node.js (npm) is not installed. Install it from https://nodejs.org, then run this again."
  echo "  The classic v1 simulator needs no install: open legacy-v1/index.html."
  open "legacy-v1/index.html"
  exit 1
fi
[ -d node_modules ] || npm install
echo "  Starting at http://localhost:5173/PulseLabSim/  (press Ctrl+C to stop)"
echo ""
npm run dev -- --open
