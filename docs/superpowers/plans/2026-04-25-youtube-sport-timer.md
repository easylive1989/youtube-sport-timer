# YouTube Sport Timer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web app that silently plays YouTube workout videos and fires synchronized audio beeps whenever the original video's timer bells would have sounded.

**Architecture:** Vanilla JS frontend on GitHub Pages; Python FastAPI backend on Render. Backend downloads audio via yt-dlp, detects electronic beeps with librosa onset detection, and returns timestamps. Frontend embeds the YouTube IFrame Player API (muted), polls `getCurrentTime()` every 100ms, and fires Web Audio API beeps at the detected timestamps.

**Tech Stack:** Python 3.11, FastAPI, yt-dlp, librosa, soundfile, pytest; Vanilla JS, YouTube IFrame Player API, Web Audio API; GitHub Pages, Render, GitHub Actions.

---

## File Map

```
youtube-sport-timer/
├── frontend/
│   ├── index.html          ← page structure, loads scripts
│   ├── style.css           ← responsive portrait + landscape layout
│   ├── config.js           ← API_BASE_URL constant (update after Render deploy)
│   ├── storage.js          ← localStorage CRUD
│   ├── api.js              ← fetch wrapper for POST /analyze
│   └── app.js              ← YouTube IFrame + Timer orchestration (main logic)
├── backend/
│   ├── main.py             ← FastAPI app: CORS, /health, /analyze, in-memory cache
│   ├── analyzer.py         ← download_audio() + detect_beeps()
│   ├── requirements.txt
│   ├── test_health.py
│   ├── test_analyzer.py
│   └── test_analyze_endpoint.py
├── render.yaml
└── .github/
    └── workflows/
        └── deploy-frontend.yml
```

---

## Task 1: Project Scaffold

**Files:**
- Create: `backend/requirements.txt`
- Create: `.gitignore`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p frontend backend .github/workflows
```

- [ ] **Step 2: Write requirements.txt**

`backend/requirements.txt`:
```
fastapi>=0.115.0
uvicorn[standard]>=0.32.0
yt-dlp>=2025.1.0
librosa>=0.10.2
soundfile>=0.12.1
numpy>=1.26.0,<2.0
httpx>=0.27.0
pytest>=8.0.0
```

- [ ] **Step 3: Write .gitignore**

`.gitignore`:
```
__pycache__/
*.pyc
.env
.venv/
venv/
*.egg-info/
dist/
build/
.pytest_cache/
/tmp/
*.wav
*.m4a
*.webm
*.opus
node_modules/
.DS_Store
```

- [ ] **Step 4: Commit**

```bash
git add backend/requirements.txt .gitignore
git commit -m "chore: project scaffold"
```

---

## Task 2: Backend — FastAPI Setup + Health Endpoint

**Files:**
- Create: `backend/main.py`
- Create: `backend/test_health.py`

- [ ] **Step 1: Write the failing test**

`backend/test_health.py`:
```python
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_health_returns_ok():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}

def test_cors_header_present():
    # Default ALLOWED_ORIGINS includes localhost:5500 for local dev
    response = client.get(
        "/health",
        headers={"Origin": "http://localhost:5500"},
    )
    assert "access-control-allow-origin" in response.headers
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd backend && pip install -r requirements.txt && pytest test_health.py -v
```

Expected: `ModuleNotFoundError: No module named 'main'`

- [ ] **Step 3: Write main.py (health endpoint only)**

`backend/main.py`:
```python
import os
import re
import shutil
import time
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

_allowed_origins = os.getenv(
    "ALLOWED_ORIGINS", "http://127.0.0.1:5500,http://localhost:5500"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

_cache: dict = {}
_cache_times: dict = {}
CACHE_TTL = 600  # seconds


@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
cd backend && pytest test_health.py -v
```

Expected: `2 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/main.py backend/test_health.py
git commit -m "feat(backend): FastAPI setup with health endpoint"
```

---

## Task 3: Backend — Beep Detection Algorithm

**Files:**
- Create: `backend/analyzer.py`
- Create: `backend/test_analyzer.py`

- [ ] **Step 1: Write the failing tests**

`backend/test_analyzer.py`:
```python
import numpy as np
import soundfile as sf
import tempfile
import os
import pytest
from analyzer import detect_beeps


def make_beep_audio(beep_times, sr=22050, duration=60.0):
    """Generate low-noise audio with 880 Hz sine beeps at given times."""
    audio = np.random.randn(int(sr * duration)) * 0.005
    for t in beep_times:
        start = int(t * sr)
        end = min(start + int(0.2 * sr), len(audio))
        t_arr = np.arange(end - start) / sr
        audio[start:end] += 0.8 * np.sin(2 * np.pi * 880 * t_arr)
    return audio, sr


@pytest.fixture
def beep_file(tmp_path):
    """Write a WAV file with beeps at 10s, 25s, 40s."""
    audio, sr = make_beep_audio([10.0, 25.0, 40.0])
    path = str(tmp_path / "beeps.wav")
    sf.write(path, audio, sr)
    return path


def test_detects_three_beeps(beep_file):
    result = detect_beeps(beep_file)
    assert len(result) == 3


def test_beep_times_within_half_second(beep_file):
    result = detect_beeps(beep_file)
    for expected, got in zip([10.0, 25.0, 40.0], sorted(result)):
        assert abs(expected - got) < 0.5


def test_returns_empty_for_silence(tmp_path):
    sr = 22050
    silence = np.zeros(sr * 10)
    path = str(tmp_path / "silence.wav")
    sf.write(path, silence, sr)
    assert detect_beeps(path) == []


def test_returns_floats(beep_file):
    result = detect_beeps(beep_file)
    assert all(isinstance(t, float) for t in result)
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd backend && pytest test_analyzer.py -v
```

Expected: `ModuleNotFoundError: No module named 'analyzer'`

- [ ] **Step 3: Write analyzer.py (detect_beeps only)**

`backend/analyzer.py`:
```python
import glob
import os
import tempfile
from typing import Tuple

import librosa
import numpy as np
import yt_dlp


def detect_beeps(audio_path: str) -> list[float]:
    """Return timestamps (seconds) of electronic beeps in an audio file."""
    y, sr = librosa.load(audio_path, sr=22050, mono=True)
    if len(y) == 0:
        return []

    hop_length = 512
    frame_length = 2048

    onset_frames = librosa.onset.onset_detect(
        y=y, sr=sr, units="frames", hop_length=hop_length
    )
    if len(onset_frames) == 0:
        return []

    onset_times = librosa.frames_to_time(onset_frames, sr=sr, hop_length=hop_length)

    rms = librosa.feature.rms(y=y, frame_length=frame_length, hop_length=hop_length)[0]
    spectral_centroid = librosa.feature.spectral_centroid(
        y=y, sr=sr, hop_length=hop_length
    )[0]

    # Adaptive energy threshold: 75th percentile across all detected onsets
    onset_energies = [
        float(rms[min(int(f), len(rms) - 1)]) for f in onset_frames
    ]
    energy_threshold = float(np.percentile(onset_energies, 75))

    candidates = []
    for t, frame_idx, energy in zip(onset_times, onset_frames, onset_energies):
        if energy < energy_threshold:
            continue
        centroid = spectral_centroid[min(int(frame_idx), len(spectral_centroid) - 1)]
        if not (400.0 <= centroid <= 4000.0):
            continue
        candidates.append(float(t))

    if not candidates:
        return []

    # Merge onsets within 200ms
    merged = [candidates[0]]
    for t in candidates[1:]:
        if t - merged[-1] >= 0.2:
            merged.append(t)

    return [round(t, 2) for t in merged]


def download_audio(url: str) -> Tuple[str, str, str]:
    """Download audio from YouTube URL. Returns (file_path, title, video_id)."""
    tmp_dir = tempfile.mkdtemp()
    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": os.path.join(tmp_dir, "%(id)s.%(ext)s"),
        "quiet": True,
        "no_warnings": True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        title = info.get("title", "")
        video_id = info.get("id", "")

    files = glob.glob(os.path.join(tmp_dir, f"{video_id}.*"))
    if not files:
        raise FileNotFoundError(f"Downloaded file not found for {video_id}")

    return files[0], title, video_id
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
cd backend && pytest test_analyzer.py -v
```

Expected: `4 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/analyzer.py backend/test_analyzer.py
git commit -m "feat(backend): beep detection with librosa onset analysis"
```

---

## Task 4: Backend — Analyze Endpoint

**Files:**
- Modify: `backend/main.py` (add `/analyze` route + `extract_video_id`)
- Create: `backend/test_analyze_endpoint.py`

- [ ] **Step 1: Write the failing tests**

`backend/test_analyze_endpoint.py`:
```python
import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient
from main import app, _cache, _cache_times

client = TestClient(app)


@pytest.fixture(autouse=True)
def clear_cache():
    _cache.clear()
    _cache_times.clear()
    yield
    _cache.clear()
    _cache_times.clear()


def test_analyze_returns_beeps():
    with patch("analyzer.download_audio") as mock_dl, patch("analyzer.detect_beeps") as mock_det:
        mock_dl.return_value = ("/tmp/fake/abc123xyz.wav", "Test Video", "abc123xyz")
        mock_det.return_value = [10.5, 25.0, 40.0]

        response = client.post(
            "/analyze", json={"url": "https://www.youtube.com/watch?v=abc123xyz"}
        )

    assert response.status_code == 200
    data = response.json()
    assert data["video_id"] == "abc123xyz"
    assert data["title"] == "Test Video"
    assert data["beeps"] == [10.5, 25.0, 40.0]


def test_analyze_invalid_url():
    response = client.post("/analyze", json={"url": "not-a-url"})
    assert response.status_code == 422
    assert "YouTube" in response.json()["detail"]


def test_analyze_missing_url_field():
    response = client.post("/analyze", json={})
    assert response.status_code == 422


def test_analyze_caches_result():
    with patch("analyzer.download_audio") as mock_dl, patch("analyzer.detect_beeps") as mock_det:
        mock_dl.return_value = ("/tmp/fake/abc123xyz.wav", "Test Video", "abc123xyz")
        mock_det.return_value = [10.5]

        client.post("/analyze", json={"url": "https://youtu.be/abc123xyz"})
        client.post("/analyze", json={"url": "https://youtu.be/abc123xyz"})

    assert mock_dl.call_count == 1


def test_analyze_download_failure_returns_422():
    with patch("analyzer.download_audio") as mock_dl:
        mock_dl.side_effect = Exception("access denied")

        response = client.post(
            "/analyze", json={"url": "https://www.youtube.com/watch?v=abc123xyz"}
        )

    assert response.status_code == 422
    assert "私人" in response.json()["detail"]
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd backend && pytest test_analyze_endpoint.py -v
```

Expected: `FAILED` — no `/analyze` route yet.

- [ ] **Step 3: Add extract_video_id + /analyze route to main.py**

Append to `backend/main.py` after the `health()` function:

```python
class AnalyzeRequest(BaseModel):
    url: str


def extract_video_id(url: str) -> str | None:
    patterns = [
        r"(?:v=)([A-Za-z0-9_-]{11})",
        r"(?:youtu\.be/)([A-Za-z0-9_-]{11})",
        r"(?:embed/)([A-Za-z0-9_-]{11})",
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


@app.post("/analyze")
async def analyze(request: AnalyzeRequest):
    from analyzer import download_audio, detect_beeps

    video_id = extract_video_id(request.url)
    if not video_id:
        raise HTTPException(status_code=422, detail="請輸入有效的 YouTube 網址")

    now = time.time()
    if video_id in _cache and now - _cache_times[video_id] < CACHE_TTL:
        return _cache[video_id]

    try:
        file_path, title, vid_id = download_audio(request.url)
    except Exception:
        raise HTTPException(status_code=422, detail="無法存取此影片，可能為私人或地區限制")

    try:
        beeps = detect_beeps(file_path)
    except Exception:
        raise HTTPException(status_code=500, detail="音頻下載失敗，請稍後再試")
    finally:
        shutil.rmtree(os.path.dirname(file_path), ignore_errors=True)

    result = {"video_id": vid_id, "title": title, "beeps": beeps}
    _cache[video_id] = result
    _cache_times[video_id] = now
    return result
```

- [ ] **Step 4: Run all backend tests**

```bash
cd backend && pytest -v
```

Expected: `9 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/main.py backend/test_analyze_endpoint.py
git commit -m "feat(backend): POST /analyze endpoint with caching"
```

---

## Task 5: Frontend — HTML + CSS

**Files:**
- Create: `frontend/index.html`
- Create: `frontend/style.css`

- [ ] **Step 1: Write index.html**

`frontend/index.html`:
```html
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>YouTube Sport Timer</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <div id="app">
    <section id="input-section">
      <div id="input-row">
        <input type="text" id="url-input" placeholder="貼上 YouTube 網址" autocomplete="off" />
        <button id="analyze-btn">分析</button>
      </div>
      <p id="status-msg"></p>
    </section>

    <section id="player-section" hidden>
      <div id="player-wrapper">
        <div id="youtube-player"></div>
      </div>
      <div id="timer-bar">
        <div id="countdown-fill"></div>
      </div>
      <div id="controls">
        <button id="play-pause-btn">▶ 播放</button>
        <span id="next-beep-label">--</span>
      </div>
    </section>

    <section id="history-section">
      <h2>歷史紀錄</h2>
      <ul id="history-list"></ul>
    </section>
  </div>

  <div id="flash-overlay" hidden></div>

  <script src="https://www.youtube.com/iframe_api"></script>
  <script src="config.js"></script>
  <script src="storage.js"></script>
  <script src="api.js"></script>
  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write style.css**

`frontend/style.css`:
```css
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #111;
  color: #eee;
  min-height: 100vh;
}

#app {
  max-width: 900px;
  margin: 0 auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Input */
#input-row {
  display: flex;
  gap: 8px;
}

#url-input {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid #444;
  border-radius: 6px;
  background: #222;
  color: #eee;
  font-size: 15px;
  min-width: 0;
}

button {
  padding: 10px 16px;
  border: none;
  border-radius: 6px;
  background: #e53e3e;
  color: white;
  font-size: 15px;
  cursor: pointer;
  white-space: nowrap;
}

button:hover { background: #c53030; }
button:disabled { opacity: 0.5; cursor: not-allowed; }

#status-msg {
  font-size: 13px;
  color: #aaa;
  margin-top: 6px;
  min-height: 18px;
}

/* Player — portrait */
#player-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

#player-wrapper {
  position: relative;
  width: 100%;
  padding-bottom: 56.25%;
  background: #000;
  border-radius: 8px;
  overflow: hidden;
}

#player-wrapper > div,
#player-wrapper iframe {
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  width: 100% !important;
  height: 100% !important;
}

#timer-bar {
  height: 8px;
  background: #333;
  border-radius: 4px;
  overflow: hidden;
}

#countdown-fill {
  height: 100%;
  width: 0%;
  background: linear-gradient(90deg, #e53e3e, #fc8181);
  transition: width 0.1s linear;
  border-radius: 4px;
}

#controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

#next-beep-label {
  font-size: 16px;
  color: #aaa;
}

/* History */
#history-section h2 {
  font-size: 14px;
  color: #777;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

#history-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

#history-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #1e1e1e;
  padding: 10px 14px;
  border-radius: 6px;
  gap: 8px;
}

#history-list .title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
}

#history-list .actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

#history-list .actions button {
  padding: 5px 10px;
  font-size: 13px;
  background: #2d2d2d;
}

#history-list .actions button.delete-btn {
  background: #742a2a;
}

#history-list .empty {
  color: #555;
  font-size: 14px;
}

/* Flash overlay */
#flash-overlay {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 999;
}

#flash-overlay.flash {
  animation: flash 0.25s ease-out forwards;
}

@keyframes flash {
  0%   { background: rgba(252, 129, 129, 0.45); }
  100% { background: transparent; }
}

/* Landscape mobile */
@media (orientation: landscape) and (max-height: 500px) {
  #player-section {
    display: grid;
    grid-template-columns: 1fr 180px;
    grid-template-rows: auto auto;
    column-gap: 12px;
    row-gap: 8px;
  }

  #player-wrapper {
    grid-column: 1;
    grid-row: 1 / 3;
    padding-bottom: 0;
    height: 220px;
  }

  #timer-bar {
    grid-column: 2;
    grid-row: 1;
    align-self: center;
  }

  #controls {
    grid-column: 2;
    grid-row: 2;
    flex-direction: column;
    align-items: flex-start;
  }
}
```

- [ ] **Step 3: Manual check**

Open `frontend/index.html` in a browser (via Live Server or `open frontend/index.html`). Verify:
- Input field and Analyze button visible
- Page is dark-themed
- No JS errors in console

- [ ] **Step 4: Commit**

```bash
git add frontend/index.html frontend/style.css
git commit -m "feat(frontend): HTML structure and responsive CSS"
```

---

## Task 6: Frontend — storage.js

**Files:**
- Create: `frontend/storage.js`

- [ ] **Step 1: Write storage.js**

`frontend/storage.js`:
```javascript
const Storage = (() => {
  const PREFIX = 'yst_';

  function save(videoId, data) {
    localStorage.setItem(PREFIX + videoId, JSON.stringify(data));
  }

  function load(videoId) {
    const raw = localStorage.getItem(PREFIX + videoId);
    return raw ? JSON.parse(raw) : null;
  }

  function remove(videoId) {
    localStorage.removeItem(PREFIX + videoId);
  }

  function all() {
    return Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .map((k) => JSON.parse(localStorage.getItem(k)));
  }

  return { save, load, remove, all };
})();
```

- [ ] **Step 2: Manual check in browser console**

Open `frontend/index.html`. In DevTools console:
```javascript
Storage.save('test123', { url: 'https://example.com', title: 'Test', beeps: [10, 20], analyzed_at: new Date().toISOString() });
console.log(Storage.load('test123'));   // → {url: ..., title: 'Test', beeps: [...]}
console.log(Storage.all().length);      // → 1
Storage.remove('test123');
console.log(Storage.load('test123'));   // → null
```

- [ ] **Step 3: Commit**

```bash
git add frontend/storage.js
git commit -m "feat(frontend): localStorage CRUD (storage.js)"
```

---

## Task 7: Frontend — config.js + api.js

**Files:**
- Create: `frontend/config.js`
- Create: `frontend/api.js`

- [ ] **Step 1: Write config.js**

`frontend/config.js`:
```javascript
// Update API_BASE_URL after getting the Render service URL
const CONFIG = {
  API_BASE_URL: 'https://youtube-sport-timer.onrender.com',
};
```

- [ ] **Step 2: Write api.js**

`frontend/api.js`:
```javascript
const API = (() => {
  async function analyze(url) {
    const response = await fetch(`${CONFIG.API_BASE_URL}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || `伺服器錯誤 (${response.status})`);
    }
    return response.json();
  }

  return { analyze };
})();
```

- [ ] **Step 3: Commit**

```bash
git add frontend/config.js frontend/api.js
git commit -m "feat(frontend): API client and config"
```

---

## Task 8: Frontend — app.js (YouTube + Timer)

**Files:**
- Create: `frontend/app.js`

- [ ] **Step 1: Write app.js**

`frontend/app.js`:
```javascript
// --- State ---
let ytPlayer = null;
let currentBeeps = [];
let playedBeepIndices = new Set();
let timerIntervalId = null;
let isPlaying = false;
let lastKnownTime = 0;
let audioCtx = null;

// --- YouTube IFrame API callback (must be global) ---
window.onYouTubeIframeAPIReady = function () {
  renderHistory();
};

// --- Player ---
function initPlayer(videoId) {
  const container = document.getElementById('youtube-player');
  container.innerHTML = '';
  ytPlayer = new YT.Player('youtube-player', {
    videoId,
    playerVars: { mute: 1, rel: 0, modestbranding: 1 },
    events: { onStateChange: onPlayerStateChange },
  });
}

function onPlayerStateChange(event) {
  if (event.data === YT.PlayerState.PLAYING && !isPlaying) {
    isPlaying = true;
    document.getElementById('play-pause-btn').textContent = '⏸ 暫停';
    startTicker();
  } else if (
    (event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.ENDED) &&
    isPlaying
  ) {
    isPlaying = false;
    document.getElementById('play-pause-btn').textContent = '▶ 播放';
    stopTicker();
  }
}

// --- Timer ---
function startTicker() {
  if (timerIntervalId) clearInterval(timerIntervalId);
  timerIntervalId = setInterval(tick, 100);
}

function stopTicker() {
  if (timerIntervalId) {
    clearInterval(timerIntervalId);
    timerIntervalId = null;
  }
}

function tick() {
  if (!ytPlayer || typeof ytPlayer.getCurrentTime !== 'function') return;
  const currentTime = ytPlayer.getCurrentTime();

  // Detect backward seek → allow already-played beeps to fire again
  if (currentTime < lastKnownTime - 1.0) {
    playedBeepIndices.clear();
  }
  lastKnownTime = currentTime;

  // Fire beeps in window [beepTime - 0.05, beepTime + 0.15]
  currentBeeps.forEach((beepTime, i) => {
    if (
      !playedBeepIndices.has(i) &&
      currentTime >= beepTime - 0.05 &&
      currentTime <= beepTime + 0.15
    ) {
      playedBeepIndices.add(i);
      playBeep();
      flashScreen();
    }
  });

  updateCountdown(currentTime);
}

function updateCountdown(currentTime) {
  const nextIdx = currentBeeps.findIndex(
    (t, i) => !playedBeepIndices.has(i) && t > currentTime
  );
  const fill = document.getElementById('countdown-fill');
  const label = document.getElementById('next-beep-label');

  if (nextIdx === -1) {
    fill.style.width = '100%';
    label.textContent = '--';
    return;
  }

  const nextBeep = currentBeeps[nextIdx];
  const prevBeep = nextIdx > 0 ? currentBeeps[nextIdx - 1] : 0;
  const interval = nextBeep - prevBeep;
  const timeToNext = nextBeep - currentTime;
  const fraction = Math.max(0, Math.min(1, 1 - timeToNext / interval));

  fill.style.width = `${fraction * 100}%`;
  label.textContent = `下一聲：${Math.ceil(timeToNext)}s`;
}

// --- Audio + Visual ---
function playBeep() {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.frequency.value = 880;
  osc.type = 'sine';
  gain.gain.setValueAtTime(0.6, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
  osc.start(audioCtx.currentTime);
  osc.stop(audioCtx.currentTime + 0.2);
}

function flashScreen() {
  const overlay = document.getElementById('flash-overlay');
  overlay.removeAttribute('hidden');
  overlay.classList.remove('flash');
  // Force reflow so the animation restarts
  void overlay.offsetWidth;
  overlay.classList.add('flash');
  setTimeout(() => {
    overlay.setAttribute('hidden', '');
    overlay.classList.remove('flash');
  }, 300);
}

// --- History ---
function renderHistory() {
  const list = document.getElementById('history-list');
  const items = Storage.all().sort(
    (a, b) => new Date(b.analyzed_at) - new Date(a.analyzed_at)
  );
  list.innerHTML = '';
  if (items.length === 0) {
    list.innerHTML = '<li class="empty">尚無歷史紀錄</li>';
    return;
  }
  items.forEach((item) => {
    const li = document.createElement('li');
    const safeId = item.video_id.replace(/[^A-Za-z0-9_-]/g, '');
    li.innerHTML = `
      <span class="title">${escapeHtml(item.title || item.video_id)}</span>
      <div class="actions">
        <button onclick="loadFromHistory('${safeId}')">載入</button>
        <button class="delete-btn" onclick="deleteFromHistory('${safeId}')">刪除</button>
      </div>
    `;
    list.appendChild(li);
  });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function loadFromHistory(videoId) {
  const item = Storage.load(videoId);
  if (!item) return;
  document.getElementById('url-input').value = item.url;
  setBeeps(item.beeps);
  document.getElementById('status-msg').textContent =
    `已載入：${item.beeps.length} 個嗶聲`;
  showPlayer(videoId);
}

function deleteFromHistory(videoId) {
  Storage.remove(videoId);
  renderHistory();
}

function setBeeps(beeps) {
  currentBeeps = beeps;
  playedBeepIndices.clear();
  lastKnownTime = 0;
}

function showPlayer(videoId) {
  const section = document.getElementById('player-section');
  section.removeAttribute('hidden');
  stopTicker();
  isPlaying = false;
  document.getElementById('play-pause-btn').textContent = '▶ 播放';
  document.getElementById('countdown-fill').style.width = '0%';
  document.getElementById('next-beep-label').textContent = '--';
  initPlayer(videoId);
}

// --- DOM Events ---
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('analyze-btn').addEventListener('click', async () => {
    const url = document.getElementById('url-input').value.trim();
    if (!url) return;

    const statusMsg = document.getElementById('status-msg');
    const btn = document.getElementById('analyze-btn');
    btn.disabled = true;
    statusMsg.textContent = '分析中... 首次可能需 30–60 秒';

    try {
      const result = await API.analyze(url);
      setBeeps(result.beeps);
      Storage.save(result.video_id, {
        url,
        video_id: result.video_id,
        title: result.title,
        beeps: result.beeps,
        analyzed_at: new Date().toISOString(),
      });
      statusMsg.textContent =
        result.beeps.length > 0
          ? `找到 ${result.beeps.length} 個嗶聲`
          : '未偵測到計時嗶聲';
      showPlayer(result.video_id);
      renderHistory();
    } catch (err) {
      statusMsg.textContent = `錯誤：${err.message}`;
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('play-pause-btn').addEventListener('click', () => {
    if (!ytPlayer || typeof ytPlayer.playVideo !== 'function') return;
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    if (isPlaying) {
      ytPlayer.pauseVideo();
    } else {
      ytPlayer.playVideo();
    }
  });
});
```

- [ ] **Step 2: Manual end-to-end test (requires backend running locally)**

Start backend:
```bash
cd backend && uvicorn main:app --reload --port 8000
```

Update `frontend/config.js` temporarily:
```javascript
const CONFIG = { API_BASE_URL: 'http://127.0.0.1:8000' };
```

Open `frontend/index.html` via Live Server (port 5500). Then:
1. Paste a YouTube URL of a HIIT video → click Analyze → confirm status shows beep count
2. Click ▶ 播放 → confirm YouTube plays (muted) and countdown bar animates
3. Click ⏸ 暫停 → confirm both video and timer pause
4. Reload page → confirm history list shows the saved video
5. Click 載入 → confirm video reloads and is ready to play (not auto-playing)
6. On mobile: rotate to landscape → confirm grid layout

- [ ] **Step 3: Revert config.js to production URL**

`frontend/config.js`:
```javascript
const CONFIG = {
  API_BASE_URL: 'https://youtube-sport-timer.onrender.com',
};
```

- [ ] **Step 4: Commit**

```bash
git add frontend/app.js frontend/config.js
git commit -m "feat(frontend): YouTube IFrame + timer orchestration (app.js)"
```

---

## Task 9: Deployment Config + GitHub Push

**Files:**
- Create: `render.yaml`
- Create: `.github/workflows/deploy-frontend.yml`

- [ ] **Step 1: Write render.yaml**

`render.yaml`:
```yaml
services:
  - type: web
    name: youtube-sport-timer
    runtime: python
    rootDir: backend
    buildCommand: pip install -r requirements.txt
    startCommand: uvicorn main:app --host 0.0.0.0 --port $PORT
    envVars:
      - key: ALLOWED_ORIGINS
        value: https://easylive1989.github.io
    autoDeploy: true
```

- [ ] **Step 2: Write GitHub Actions workflow**

`.github/workflows/deploy-frontend.yml`:
```yaml
name: Deploy Frontend to GitHub Pages

on:
  push:
    branches: [main]
    paths:
      - 'frontend/**'

permissions:
  contents: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./frontend
          cname: ''
```

- [ ] **Step 3: Commit deployment config**

```bash
git add render.yaml .github/workflows/deploy-frontend.yml
git commit -m "chore: deployment config for Render and GitHub Pages"
```

- [ ] **Step 4: Create GitHub repo and push**

```bash
gh repo create youtube-sport-timer --public --source=. --remote=origin --push
```

Expected output: repo created at `https://github.com/easylive1989/youtube-sport-timer`

- [ ] **Step 5: Verify GitHub Pages is enabled**

```bash
gh api repos/easylive1989/youtube-sport-timer/pages \
  --method POST \
  --field source='{"branch":"gh-pages","path":"/"}' \
  2>/dev/null || echo "Pages may already be configured or needs manual enable"
```

If the above fails, go to: `https://github.com/easylive1989/youtube-sport-timer/settings/pages` → Source: `gh-pages` branch → Save.

- [ ] **Step 6: Connect Render**

1. Go to [https://dashboard.render.com](https://dashboard.render.com) → New Web Service
2. Connect GitHub → select `easylive1989/youtube-sport-timer`
3. Render auto-detects `render.yaml` → review settings → Create
4. Note the assigned service URL (e.g. `https://youtube-sport-timer.onrender.com`)
5. If the URL differs from the default in `config.js`, update `frontend/config.js`:
   ```javascript
   const CONFIG = { API_BASE_URL: 'https://<actual-render-url>.onrender.com' };
   ```
   Then commit and push:
   ```bash
   git add frontend/config.js
   git commit -m "chore: update Render service URL"
   git push
   ```

- [ ] **Step 7: Verify live deployment**

After GitHub Actions completes (check at `https://github.com/easylive1989/youtube-sport-timer/actions`):
```bash
open https://easylive1989.github.io/youtube-sport-timer/
```

Test: paste a YouTube HIIT video URL → click Analyze → confirm backend responds → play video muted → confirm timer beeps fire.
