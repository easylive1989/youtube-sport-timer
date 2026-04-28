#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

cleanup() {
  echo ""
  echo "停止伺服器..."
  kill "$FRONTEND_PID" 2>/dev/null
}
trap cleanup EXIT INT TERM

python3 -m http.server 5500 --directory "$ROOT/frontend" &
FRONTEND_PID=$!

echo "Frontend: http://localhost:5500"
echo "按 Ctrl+C 停止"
echo ""

sleep 1
open "http://localhost:5500" 2>/dev/null || true

wait
