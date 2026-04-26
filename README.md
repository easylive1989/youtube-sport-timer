# YouTube Sport Timer

分析 YouTube 運動影片的音訊，自動偵測電子計時嗶聲（如籃球、足球賽事的計時器），並在播放影片時同步發出提示音與視覺閃爍。

**Demo：** https://easylive1989.github.io/youtube-sport-timer

## 功能

- 貼上 YouTube 網址 → 後端下載音訊並偵測嗶聲時間點
- 播放影片時自動在嗶聲處觸發 880 Hz 提示音與全螢幕閃爍
- 倒數條顯示距下一聲的剩餘時間
- 分析結果儲存於本地歷史紀錄
- 手動增刪 timer（在當前播放位置新增、或輸入 mm:ss）

## 本機開發

需求：Python 3.12+、ffmpeg、Node.js（供 yt-dlp 解析 YouTube JS）

```bash
./dev.sh
```

啟動後：
- Frontend：http://localhost:5500
- Backend API：http://localhost:8000

## 架構

```
frontend/          原生 HTML/CSS/JS，GitHub Pages 部署
backend/
  main.py          FastAPI，/health、/analyze 端點，JSON 檔案快取
  analyzer.py      yt-dlp 下載音訊 → ffmpeg 轉 WAV → librosa 偵測嗶聲
```

偵測流程：onset detection → RMS 能量過濾（閾值 = 全局中位數 × 3）→ spectral centroid 過濾（400–4000 Hz）→ 合併相距 < 0.3s 的候選點。

## 部署

- **Frontend**：GitHub Pages（`frontend/` 目錄）
- **Backend**：VPS systemd service，API 掛載於 `https://api.paul-learning.dev`
- **Cookies 更新**（YouTube 限制影片需要）：
  ```bash
  ./deploy-cookies.sh /path/to/cookies.txt
  ```
