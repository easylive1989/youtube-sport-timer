# Custom Seeker Bar — Design Spec
Date: 2026-05-19

## Overview

YouTube 原生的 seeker bar 太細（約 3–4px），手機上難拖動、難點擊精確位置。
在影片底部疊一層**較粗的客製 seeker bar**，提供更大 hit area、即時拖動 seek、
並在 bar 上顯示所有 beep timer 的位置，讓使用者一眼看清楚並可直接跳轉。

---

## 目標

- Seeker bar 厚度足以用手指輕鬆拖動（portrait 20px、landscape 16px）
- 永遠顯示，不像 YouTube 原生會自動隱藏
- 顯示所有 beep 標記，幫助使用者導覽
- 拖動中即時 seek，提供即時視覺回饋

## 非目標

- 不補回 YouTube 原生控制條的 fullscreen、播放速度、畫質、時間顯示等功能
- 不加 hover tooltip 顯示時間（thick bar + 即時 seek 已足夠）
- 不變更現有 timer / beep 邏輯

---

## 架構

```
#player-wrapper (position: relative)
├── #youtube-player           ← iframe，playerVars.controls = 0（隱藏原生 UI）
├── #player-click-overlay     ← 透明，吃 click 切換 play/pause
└── #seeker-bar               ← 絕對定位於底部，z-index 高於 click overlay
    ├── #seeker-track         ← 灰底，承載 hit area
    ├── #seeker-fill          ← 紅色漸層，目前進度
    └── #seeker-beep-markers  ← 多個小直條，依 beep 時間定位
```

### 為什麼隱藏 YouTube 原生控制條

`controls=0` 是最乾淨的方式，畫面不會出現雙重 seeker。代價是失去 fullscreen 等
原生按鈕，但本 app 主要為計時器，這些非核心功能，先不補回。日後若需要，可在
`#seeker-bar` 右側加小按鈕。

---

## 視覺規格

| 屬性 | Portrait | Landscape mobile |
|---|---|---|
| Bar 高度 | 20px | 16px |
| 底部位置 | `bottom: 0` | `bottom: 0` |
| 寬度 | 100% | 100% |
| 背景 | `rgba(255,255,255,0.25)` | 同左 |
| 進度 fill | `linear-gradient(90deg, #e53e3e, #fc8181)`（沿用既有風格） | 同左 |
| Beep 標記 | 4px 寬黃色 `#fbbf24`，貫穿 bar 高度 | 3px 寬 |
| Hover/touch | 變高 4px、背景加深至 `rgba(255,255,255,0.4)` | 同左 |

整體 z-index 配置：

- `#youtube-player` iframe：自然層級
- `#player-click-overlay`：z-index 1，覆蓋整個 wrapper
- `#seeker-bar`：z-index 2，覆蓋在 click overlay 之上

---

## 互動行為

### 點擊 seek

點 bar 任一位置（包含 beep marker）→ 立即 `ytPlayer.seekTo(目標時間, true)`。

目標時間 = `(clickX − barLeft) / barWidth × duration`，clamp 到 `[0, duration]`。

### 拖動 seek（pointer events）

統一用 PointerEvent 處理 mouse + touch：

1. **pointerdown**：
   - 記錄 `wasPlaying = (player state === PLAYING)`
   - 暫停影片（避免拖動時播放跑掉造成抖動）
   - `setPointerCapture(pointerId)`
   - 標記 `isDragging = true`
2. **pointermove**（拖動中）：
   - 計算目標時間
   - 即時更新 `#seeker-fill` 寬度
   - 用 `requestAnimationFrame` throttle 呼叫 `seekTo`（每幀最多一次）
3. **pointerup / pointercancel**：
   - `isDragging = false`
   - `releasePointerCapture`
   - 若 `wasPlaying`，呼叫 `playVideo()` 恢復播放

### 點擊影片 = play/pause

`#player-click-overlay` 接 click 事件，切換 `playVideo()` / `pauseVideo()`。
`#seeker-bar` 的 pointerdown / click 需 `stopPropagation()`，避免拖動時誤觸暫停。

---

## 進度同步

`duration` 在 `onReady` 時讀取並快取為 module-level 變數 `videoDuration`。
切換影片時於 `initPlayer` 重置為 0。

`tick()`（既有，100ms 一次）內新增更新 seeker fill 的邏輯：

```js
if (!isDragging && videoDuration > 0) {
  const pct = (currentTime / videoDuration) * 100;
  document.getElementById('seeker-fill').style.width = `${pct}%`;
}
```

拖動中 `isDragging === true`，跳過 tick 的 fill 更新，避免覆蓋使用者位置。

---

## Beep 標記渲染

每次 `setBeeps()` 之後重新渲染 markers：

- 清空 `#seeker-beep-markers` 內容
- 對 `currentBeeps` 中每個 `t`：建立一個 div，`left: (t / videoDuration) * 100%`
- 若 `videoDuration` 還沒 ready，延後到 `onReady` 後再渲染一次

Markers 設為 `pointer-events: none`，讓 click 事件由 `#seeker-bar` 統一接收，
不需個別綁定。

---

## 檔案影響範圍

| 檔案 | 變更 |
|---|---|
| `frontend/index.html` | `#player-wrapper` 內新增 `#player-click-overlay` 與 `#seeker-bar`（含子元素） |
| `frontend/style.css` | 新增 seeker bar 樣式（portrait + landscape 兩套），調整 z-index |
| `frontend/app.js` | `initPlayer` 設 `controls: 0`；新增 `videoDuration` 快取、`isDragging` 狀態；`onReady` 讀 duration 並渲染 markers；`tick` 更新 seeker fill；新增 pointer event handlers；`setBeeps` 觸發 marker 重繪 |

---

## 邊界情況

- **影片還沒 ready / duration 為 0**：bar 顯示但 pointer events 不做事
- **切換影片**：重置 `videoDuration = 0`，清空 markers，等 `onReady` 重新讀取
- **拖動到端點**：clamp 到 `[0, duration]`
- **點 bar 但拖動極短距離**（誤觸）：仍當作 seek 處理，因為點擊本身也是 seek，行為一致
- **影片載入失敗**：bar 維持在初始狀態（fill 0%，無 markers），不影響其他功能

---

## 測試（手動）

- [ ] Portrait 模式：bar 在影片底部、20px 厚、永遠可見
- [ ] Landscape 模式：bar 16px 厚、佈局不破版
- [ ] 點 bar 中間 → 影片跳到約 50% 位置
- [ ] 拖動 bar → fill 即時跟手指走，影片即時跟著 seek
- [ ] 放手後若原本在播放 → 自動恢復播放
- [ ] 點影片區域（非 bar） → 切換 play/pause
- [ ] Beep markers 顯示在正確位置
- [ ] 點 beep marker → seek 到該 beep 時間
- [ ] 觸控裝置（手機）拖動順暢、不會選到文字
- [ ] 切換不同影片 → markers 與 duration 正確更新
