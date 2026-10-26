#!/bin/bash
# Pulse Lab Simulator — launcher for macOS
# Double-click this file in Finder, or run:  bash start.command
cd "$(dirname "$0")" || exit 1
PORT=8765

echo ""
echo "  Pulse Lab Simulator"
echo "  -------------------"

if command -v python3 >/dev/null 2>&1; then
  echo "  Serving at http://localhost:$PORT  (press Ctrl+C to stop)"
  echo ""
  ( sleep 1 && open "http://localhost:$PORT" ) &
  python3 -m http.server "$PORT" --bind 127.0.0.1
else
  echo "  python3 not found — opening the file directly in your browser instead."
  open "index.html"
fi
