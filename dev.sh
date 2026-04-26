#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Add common Node.js paths so yt-dlp can find a JS runtime
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

# Resolve python from venv or system
if [ -f "$ROOT/backend/.venv/bin/python" ]; then
  PYTHON="$ROOT/backend/.venv/bin/python"
elif [ -f "$ROOT/backend/venv/bin/python" ]; then
  PYTHON="$ROOT/backend/venv/bin/python"
else
  PYTHON="python3"
fi

# Verify backend packages are installed
if ! $PYTHON -c "import fastapi, uvicorn, yt_dlp, librosa" 2>/dev/null; then
  echo "安裝後端套件..."
  $PYTHON -m pip install -r "$ROOT/backend/requirements.txt" -q
fi

cleanup() {
  echo ""
  echo "停止伺服器..."
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null
}
trap cleanup EXIT INT TERM

# Start backend
cd "$ROOT/backend"
$PYTHON -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

# Start frontend
$PYTHON -m http.server 5500 --directory "$ROOT/frontend" &
FRONTEND_PID=$!

echo "Backend:  http://localhost:8000"
echo "Frontend: http://localhost:5500"
echo "按 Ctrl+C 停止"
echo ""

sleep 1
open "http://localhost:5500" 2>/dev/null || true

wait
