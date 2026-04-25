# YouTube Sport Timer — Design Spec
Date: 2026-04-25

## Overview

A web app that lets users silently watch YouTube workout videos while a synchronized audio timer fires beeps at the exact moments the original video's timer bells would have sounded. The tool analyzes a YouTube video's audio to detect electronic beep sounds, stores the timestamps, and plays them back in sync with the muted video.

---

## Architecture

```
Frontend (GitHub Pages)
  https://easylive1989.github.io/youtube-sport-timer/

Backend (Render - FastAPI)
  https://<service-name>.onrender.com
```

**Repo structure:**
```
youtube-sport-timer/
├── frontend/
│   ├── index.html
│   ├── app.js        ← YouTube IFrame + Timer orchestration
│   ├── storage.js    ← localStorage CRUD
│   ├── api.js        ← Backend API calls
│   └── style.css     ← Responsive layout
├── backend/
│   ├── main.py       ← FastAPI routes
│   ├── analyzer.py   ← yt-dlp + librosa beep detection
│   └── requirements.txt
├── render.yaml
└── .github/
    └── workflows/
        └── deploy-frontend.yml
```

---

## Frontend

### UI Layout

**Portrait (mobile / desktop):**
```
┌─────────────────────────────┐
│ [YouTube 網址輸入] [分析]   │
├─────────────────────────────┤
│   YouTube IFrame（靜音）    │  ← 16:9 ratio
│  ══════════════════  3s     │  ← countdown progress bar
│  [⏸ 暫停]   下一聲：03s    │
├─────────────────────────────┤
│ 歷史紀錄                    │
│ • 影片 A  [載入] [刪除]     │
└─────────────────────────────┘
```

**Landscape (mobile horizontal):**
```
┌──────────────────┬──────────────────┐
│                  │ 下一聲：03s      │
│  YouTube IFrame  │ ══════════════   │
│    （靜音）      │                  │
│                  │ [▶/⏸]           │
└──────────────────┴──────────────────┘
```

### Components

- **Input area**: YouTube URL text input + Analyze button + status message
- **Player area**: YouTube IFrame (muted, 16:9) + countdown bar + play/pause button
- **History list**: Saved videos from localStorage, each with Load and Delete actions. Clicking Load populates the URL input and immediately renders the YouTube IFrame ready to play (does not auto-play)
- **Timer overlay**: Countdown bar showing seconds to next beep; flashes + plays beep sound on trigger

### YouTube Sync

- Uses YouTube IFrame Player API (`onStateChange`)
- On Play: loads video (muted), waits for state `YT.PlayerState.PLAYING` (which fires after ads end), then starts Timer
- On Pause (user clicks our button or interacts with IFrame directly): Timer pauses
- Timer polls `player.getCurrentTime()` every 100ms to stay in sync with video position (handles seeks)

### Timer Sound

- Web Audio API `OscillatorNode`: 880 Hz, 200ms duration, no audio file required
- On each beep: plays sound + brief screen flash (CSS animation)

### localStorage Schema

```json
{
  "<video_id>": {
    "url": "https://youtube.com/watch?v=<video_id>",
    "title": "影片標題",
    "beeps": [12.5, 45.3, 78.1],
    "analyzed_at": "2026-04-25T10:00:00Z"
  }
}
```

---

## Backend

### API

```
POST /analyze
Content-Type: application/json
Body:    { "url": "https://youtube.com/watch?v=..." }
Response: { "video_id": "abc123", "title": "...", "beeps": [12.5, 45.3, 78.1] }

GET /health
Response: { "status": "ok" }
```

### Beep Detection Algorithm (`analyzer.py`)

1. Download audio-only stream with `yt-dlp` (m4a/webm, temp file)
2. Load with `librosa` (mono, sr=22050)
3. Run `librosa.onset.onset_detect` to find all transient onset times
4. For each onset, extract a short window and compute spectral centroid
5. Filter: spectral centroid in 400–4000 Hz range AND RMS duration < 500ms AND onset energy above the 75th percentile of all detected onset energies (adaptive threshold, avoids false positives from quiet background sounds)
6. Merge onsets closer than 200ms (treat as same beep)
7. Delete temp audio file
8. Return timestamp array (seconds, float)

### Caching

In-memory dict keyed by `video_id`, TTL 10 minutes. Avoids re-analyzing the same video within a session.

### Error Handling

| Condition | HTTP | Message |
|---|---|---|
| Private / region-locked video | 422 | "無法存取此影片，可能為私人或地區限制" |
| No beeps detected | 200 | `beeps: []`, frontend shows "未偵測到計時嗶聲" |
| yt-dlp failure | 500 | "音頻下載失敗，請稍後再試" |
| Invalid URL | 422 | "請輸入有效的 YouTube 網址" |

### CORS

`ALLOWED_ORIGINS=https://easylive1989.github.io` — set as environment variable on Render.

---

## Deployment

### Frontend → GitHub Pages

- Static files in `frontend/`
- GitHub Actions workflow (`.github/workflows/deploy-frontend.yml`) deploys `frontend/` to `gh-pages` branch on every push to `main`
- Live URL: `https://easylive1989.github.io/youtube-sport-timer/`

### Backend → Render

- `render.yaml` defines a Web Service (Python 3.11, `pip install -r requirements.txt`, `uvicorn main:app`)
- Auto-deploys on push to `main` after one-time manual connection in Render dashboard
- Free tier has ~30–60s cold start; frontend shows a "首次分析約需 30–60 秒" notice

### Initial Setup Commands (run once)

```bash
cd /path/to/youtube-sport-timer
gh repo create youtube-sport-timer --public --source=. --remote=origin --push
```

Then in Render dashboard: New Web Service → connect `easylive1989/youtube-sport-timer` → set `ALLOWED_ORIGINS`.

---

## Out of Scope

- User authentication / cross-device sync (localStorage only)
- Manual timestamp editing UI
- Non-YouTube video sources
- Offline mode
