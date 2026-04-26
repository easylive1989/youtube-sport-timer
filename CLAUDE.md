# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概述

YouTube Sport Timer — 分析 YouTube 影片音訊，偵測計時嗶聲（如運動賽事的電子計時器），並在播放時同步觸發聲音與視覺提示。

- **Backend**：Python FastAPI，部署在 Render（`render.yaml`）
- **Frontend**：原生 HTML/CSS/JS，部署在 GitHub Pages（`https://easylive1989.github.io`）

## 開發環境啟動

```bash
# 同時啟動 backend（port 8000）與 frontend（port 5500）
./dev.sh
```

`dev.sh` 會自動偵測 virtualenv 路徑、安裝缺少套件，並在啟動後開啟瀏覽器。

## Backend

### 常用指令

```bash
cd backend

# 建立並啟動 virtualenv（首次）
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 執行所有測試
pytest

# 執行單一測試檔
pytest test_analyzer.py

# 執行單一測試
pytest test_analyzer.py::test_detects_three_beeps

# 啟動開發伺服器（hot reload）
uvicorn main:app --reload
```

### 架構

- `main.py`：FastAPI 應用，含 `/health` 與 `/analyze` 兩個端點。嗶聲結果以 JSON 檔案快取在 `CACHE_DIR`（預設 `/opt/app/cache`，本機開發時由 env 覆寫）。
- `analyzer.py`：音訊分析核心。流程：`download_audio`（`yt-dlp`）→ `_to_wav`（`ffmpeg`，重新取樣至 11025 Hz mono）→ `detect_beeps`（`librosa` onset detection + RMS/spectral centroid 過濾 → 合併相距 0.3s 以內的候選點）。
- `YOUTUBE_COOKIES` 環境變數：base64 編碼的 cookies.txt，用於存取受限影片。可用 `deploy-cookies.sh` 部署至 VPS。

### 測試結構

- `test_health.py`：健康檢查端點
- `test_analyze_endpoint.py`：API 端點（mock `download_audio` / `detect_beeps`）
- `test_analyzer.py`：`detect_beeps` 演算法（產生合成音訊波形進行驗證）

### CORS

`ALLOWED_ORIGINS` 環境變數（逗號分隔），本機預設允許 `http://127.0.0.1:5500,http://localhost:5500`，正式環境設為 `https://easylive1989.github.io`。

## Frontend

### 架構

單頁應用，腳本載入順序為：`config.js` → `storage.js` → `api.js` → `app.js`

- `config.js`：依 `hostname` 自動切換 API base URL（localhost → `http://localhost:8000`，其他 → `https://api.paul-learning.dev`）
- `storage.js`：以 `yst_` 為 prefix 存取 localStorage，保存分析歷史
- `api.js`：`API.analyze(url)` — 呼叫後端 `/analyze`
- `app.js`：YouTube IFrame Player API 整合、計時 ticker（100ms interval）、嗶聲觸發（Web Audio API 880 Hz sine wave + screen flash）

### 響應式佈局

CSS 針對兩種模式設計：

- **Portrait（預設）**：`#player-section` 垂直堆疊
- **Landscape mobile**（`@media (orientation: landscape) and (max-height: 500px)`）：`#player-section` 改為 grid 佈局，影片占左欄、計時器與控制按鈕置於右欄

**前端開發新功能時，必須同時考慮 portrait 與 landscape 兩種顯示模式。**

### 本機測試前端

```bash
python3 -m http.server 5500 --directory frontend
# 瀏覽器開啟 http://localhost:5500
```

## 部署

- **Backend**：push 至 main 自動部署（Render `autoDeploy: true`）
- **Frontend**：GitHub Pages，從 `frontend/` 目錄提供靜態檔案
- **Cookies 更新**：`./deploy-cookies.sh /path/to/cookies.txt`（SSH 到 VPS，環境變數寫入 `/etc/youtube-sport.env`）
