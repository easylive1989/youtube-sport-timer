# Custom Seeker Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace YouTube's hard-to-drag native seeker with a thicker custom overlay at the video bottom, displaying beep timer markers and supporting click + drag-to-seek.

**Architecture:** Hide YouTube native controls (`controls: 0`), add a transparent click overlay over the player iframe for play/pause toggle, and overlay a custom thick seeker bar at the bottom with beep markers. Drag uses PointerEvents (works for mouse + touch). Fill updates piggyback on the existing 100ms `tick()`.

**Tech Stack:** Vanilla JS (no test framework — verification is manual in browser), YouTube IFrame Player API, CSS Grid (existing landscape layout).

**Reference:** spec at `docs/superpowers/specs/2026-05-19-custom-seeker-bar-design.md`

---

## File Map

| File | Responsibility | Changes |
|---|---|---|
| `frontend/index.html` | Page structure | Add `#player-click-overlay` + `#seeker-bar` (with children) inside `#player-wrapper` |
| `frontend/style.css` | Styling | Add overlay + seeker bar styles for portrait and landscape modes; z-index layering |
| `frontend/app.js` | YouTube + UI logic | Set `controls: 0`; cache `videoDuration`; click overlay handler; pointer drag handlers; marker rendering; tick update for seeker fill |

No new files. No test files (project has no JS test infrastructure — verification is manual via `./dev.sh` and browser inspection).

---

## Conventions

- Each task ends with a manual browser verification step. Run `./dev.sh` once at start; it auto-reloads CSS/HTML but **app.js changes require a hard refresh** (Cmd+Shift+R).
- Each task ends with a commit. Use the prefix style of the repo: `feat:`, `fix:`, `ui:`, `refactor:`.
- Where a code block shows full file content, replace the file entirely. Where it shows a snippet with context (e.g. `+++ ADD before line X`), make a surgical edit.

---

## Task 1: Hide YouTube native controls + add click-to-play/pause overlay

**Files:**
- Modify: `frontend/index.html` (inside `#player-wrapper`)
- Modify: `frontend/style.css` (add `#player-click-overlay` rules)
- Modify: `frontend/app.js` (`initPlayer` playerVars; add click handler)

- [ ] **Step 1: Add click overlay div to HTML**

In `frontend/index.html`, inside `#player-wrapper`, add a new `div` after `#youtube-player`:

```html
<div id="player-wrapper">
  <div id="youtube-player"></div>
  <div id="player-click-overlay"></div>
</div>
```

- [ ] **Step 2: Style the click overlay**

In `frontend/style.css`, after the existing `#player-wrapper > div, #player-wrapper iframe` rule (around line 84), add:

```css
#player-click-overlay {
  position: absolute;
  inset: 0;
  z-index: 1;
  cursor: pointer;
  /* leave bottom space for seeker bar (added in Task 2) */
  bottom: 20px;
}
```

- [ ] **Step 3: Hide YouTube native controls and wire click handler**

In `frontend/app.js`, modify `initPlayer` (around line 45) to add `controls: 0` to `playerVars`:

```js
ytPlayer = new YT.Player('youtube-player', {
  videoId,
  playerVars: { mute: 1, rel: 0, modestbranding: 1, controls: 0 },
  events: {
    onReady: (e) => {
      e.target.mute();
      e.target.setVolume(0);
      const title = e.target.getVideoData()?.title;
      if (title && currentVideoId) {
        const record = Storage.load(currentVideoId);
        if (record && !record.title) {
          Storage.save(currentVideoId, { ...record, title });
          renderHistory();
        }
      }
    },
    onStateChange: onPlayerStateChange,
  },
});
```

At the end of the `DOMContentLoaded` listener in `app.js` (before the closing `});` around line 560), add the click overlay handler:

```js
document.getElementById('player-click-overlay').addEventListener('click', () => {
  if (!ytPlayer || typeof ytPlayer.getPlayerState !== 'function') return;
  const state = ytPlayer.getPlayerState();
  if (state === YT.PlayerState.PLAYING) {
    ytPlayer.pauseVideo();
  } else {
    ytPlayer.playVideo();
  }
});
```

- [ ] **Step 4: Verify in browser**

Hard refresh (Cmd+Shift+R). Paste any YouTube URL → load video.

Expected:
- YouTube native control bar at bottom is gone (no play button, no seeker, no fullscreen)
- Clicking video area toggles play/pause
- Bottom ~20px of the video has no clickable behavior (reserved for seeker in Task 2 — fine)

- [ ] **Step 5: Commit**

```bash
git add frontend/index.html frontend/style.css frontend/app.js
git commit -m "feat: hide YouTube native controls and add click-to-play overlay"
```

---

## Task 2: Add seeker bar skeleton (HTML + CSS, no JS interaction yet)

**Files:**
- Modify: `frontend/index.html` (inside `#player-wrapper`)
- Modify: `frontend/style.css`

- [ ] **Step 1: Add seeker bar HTML**

In `frontend/index.html`, inside `#player-wrapper`, add a new `div` after `#player-click-overlay`:

```html
<div id="player-wrapper">
  <div id="youtube-player"></div>
  <div id="player-click-overlay"></div>
  <div id="seeker-bar">
    <div id="seeker-track"></div>
    <div id="seeker-fill"></div>
    <div id="seeker-beep-markers"></div>
  </div>
</div>
```

- [ ] **Step 2: Style the seeker bar (portrait + landscape)**

In `frontend/style.css`, after the `#player-click-overlay` rule from Task 1, add:

```css
#seeker-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 20px;
  z-index: 2;
  cursor: pointer;
  touch-action: none; /* let pointermove fire without page scroll on mobile */
  user-select: none;
}

#seeker-track {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.25);
  transition: background 0.15s ease;
}

#seeker-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 0%;
  background: linear-gradient(90deg, #e53e3e, #fc8181);
  pointer-events: none;
}

#seeker-beep-markers {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

#seeker-bar:hover #seeker-track {
  background: rgba(255, 255, 255, 0.4);
}

/* Landscape mobile: thinner bar */
@media (orientation: landscape) and (max-height: 500px) {
  #seeker-bar {
    height: 16px;
  }
  #player-click-overlay {
    bottom: 16px;
  }
}
```

- [ ] **Step 3: Verify in browser**

Hard refresh. Load a video.

Expected:
- A 20px tall semi-transparent grey bar appears across the bottom of the video
- Hovering the bar makes the grey slightly more opaque
- No fill yet (0% width)
- No interaction yet
- In landscape mobile (DevTools responsive mode, 800x400 e.g.) the bar is 16px tall and layout doesn't break

- [ ] **Step 4: Commit**

```bash
git add frontend/index.html frontend/style.css
git commit -m "ui: add custom seeker bar skeleton at video bottom"
```

---

## Task 3: Sync seeker fill with playback (read-only display)

**Files:**
- Modify: `frontend/app.js`

- [ ] **Step 1: Add `videoDuration` state and reset on init**

In `frontend/app.js`, near the top with the other state variables (around line 1-17), add:

```js
let videoDuration = 0;
let isDragging = false;
```

In `initPlayer`, reset `videoDuration` at the top (before creating the player):

```js
function initPlayer(videoId) {
  if (typeof YT === 'undefined' || typeof YT.Player !== 'function') {
    pendingVideoId = videoId;
    return;
  }
  videoDuration = 0;
  if (ytPlayer && typeof ytPlayer.destroy === 'function') {
    ytPlayer.destroy();
  }
  ...
```

In the `onReady` callback, cache `getDuration()`:

```js
onReady: (e) => {
  e.target.mute();
  e.target.setVolume(0);
  videoDuration = e.target.getDuration() || 0;
  const title = e.target.getVideoData()?.title;
  if (title && currentVideoId) {
    const record = Storage.load(currentVideoId);
    if (record && !record.title) {
      Storage.save(currentVideoId, { ...record, title });
      renderHistory();
    }
  }
},
```

- [ ] **Step 2: Update seeker fill in `tick()`**

In `tick()` (around line 94), after the existing `updateCountdown(currentTime); updateAddCurrentLabel();` add a call to a new helper:

```js
function tick() {
  if (!ytPlayer || typeof ytPlayer.getCurrentTime !== 'function') return;

  // Keep AudioContext alive on mobile (browsers suspend it in background)
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

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
  updateAddCurrentLabel();
  updateSeekerFill(currentTime);
}
```

Add the new helper function next to the other UI helpers (e.g. after `updateCountdown` ends, around line 146):

```js
function updateSeekerFill(currentTime) {
  if (isDragging || videoDuration <= 0) return;
  const fill = document.getElementById('seeker-fill');
  if (!fill) return;
  const pct = Math.max(0, Math.min(100, (currentTime / videoDuration) * 100));
  fill.style.width = `${pct}%`;
}
```

- [ ] **Step 3: Reset fill when player section shows**

In `showPlayer` (around line 258), after the existing `document.getElementById('countdown-fill').style.width = '0%';`, also reset seeker fill:

```js
function showPlayer(videoId) {
  currentVideoId = videoId;
  const section = document.getElementById('player-section');
  section.removeAttribute('hidden');
  stopTicker();
  isPlaying = false;
  document.getElementById('countdown-fill').style.width = '0%';
  document.getElementById('next-beep-label').textContent = '--';
  const seekerFill = document.getElementById('seeker-fill');
  if (seekerFill) seekerFill.style.width = '0%';
  updateURL();
  initPlayer(videoId);
}
```

- [ ] **Step 4: Verify in browser**

Hard refresh. Load a video and let it play.

Expected:
- The red gradient fill in the seeker bar grows from 0% to 100% as the video plays
- The fill matches the actual playback progress
- Switching to a different video resets the fill to 0%
- The native YouTube progress remains hidden (Task 1 already verified)

- [ ] **Step 5: Commit**

```bash
git add frontend/app.js
git commit -m "feat: sync seeker bar fill with video playback"
```

---

## Task 4: Click-to-seek on seeker bar

**Files:**
- Modify: `frontend/app.js`

- [ ] **Step 1: Add helper to compute target time from pointer X**

In `frontend/app.js`, near `updateSeekerFill` (or grouped together), add:

```js
function seekerTimeFromPointer(clientX) {
  const bar = document.getElementById('seeker-bar');
  if (!bar || videoDuration <= 0) return null;
  const rect = bar.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  return ratio * videoDuration;
}
```

- [ ] **Step 2: Wire click handler with stopPropagation**

At the end of the `DOMContentLoaded` listener (alongside the Task 1 click overlay handler), add:

```js
const seekerBar = document.getElementById('seeker-bar');
seekerBar.addEventListener('click', (e) => {
  e.stopPropagation(); // don't let it bubble to player-click-overlay
  if (!ytPlayer || typeof ytPlayer.seekTo !== 'function') return;
  const t = seekerTimeFromPointer(e.clientX);
  if (t === null) return;
  ytPlayer.seekTo(t, true);
  // Update fill immediately so user sees response before next tick
  const fill = document.getElementById('seeker-fill');
  if (fill) fill.style.width = `${(t / videoDuration) * 100}%`;
});
```

- [ ] **Step 3: Verify in browser**

Hard refresh. Load a video.

Expected:
- Click the middle of the bar → video jumps to ~50%, fill updates immediately
- Click near the right end → video jumps near the end
- Clicking the bar does NOT toggle play/pause (the click overlay below is not triggered)
- Clicking the video area (not on bar) still toggles play/pause

- [ ] **Step 4: Commit**

```bash
git add frontend/app.js
git commit -m "feat: support click-to-seek on custom seeker bar"
```

---

## Task 5: Drag-to-seek with pointer events

**Files:**
- Modify: `frontend/app.js`

- [ ] **Step 1: Add drag state and rAF-throttled seek**

In `frontend/app.js`, near the other state variables, add:

```js
let dragWasPlaying = false;
let dragRafPending = false;
let dragLatestTime = 0;
```

Add this helper function next to `seekerTimeFromPointer`:

```js
function applyDragSeek() {
  dragRafPending = false;
  if (!isDragging || !ytPlayer || typeof ytPlayer.seekTo !== 'function') return;
  ytPlayer.seekTo(dragLatestTime, true);
  const fill = document.getElementById('seeker-fill');
  if (fill && videoDuration > 0) {
    fill.style.width = `${(dragLatestTime / videoDuration) * 100}%`;
  }
}
```

- [ ] **Step 2: Wire pointer event handlers**

At the end of the `DOMContentLoaded` listener (after the click handler from Task 4), add:

```js
seekerBar.addEventListener('pointerdown', (e) => {
  if (!ytPlayer || typeof ytPlayer.seekTo !== 'function' || videoDuration <= 0) return;
  e.preventDefault();
  isDragging = true;
  dragWasPlaying = ytPlayer.getPlayerState() === YT.PlayerState.PLAYING;
  if (dragWasPlaying) ytPlayer.pauseVideo();
  seekerBar.setPointerCapture(e.pointerId);
  const t = seekerTimeFromPointer(e.clientX);
  if (t !== null) {
    dragLatestTime = t;
    if (!dragRafPending) {
      dragRafPending = true;
      requestAnimationFrame(applyDragSeek);
    }
  }
});

seekerBar.addEventListener('pointermove', (e) => {
  if (!isDragging) return;
  const t = seekerTimeFromPointer(e.clientX);
  if (t === null) return;
  dragLatestTime = t;
  // Update fill immediately for smooth visual feedback (cheap)
  const fill = document.getElementById('seeker-fill');
  if (fill && videoDuration > 0) {
    fill.style.width = `${(t / videoDuration) * 100}%`;
  }
  // Throttle the actual seekTo call to once per frame
  if (!dragRafPending) {
    dragRafPending = true;
    requestAnimationFrame(applyDragSeek);
  }
});

function endDrag(e) {
  if (!isDragging) return;
  isDragging = false;
  try { seekerBar.releasePointerCapture(e.pointerId); } catch (_) {}
  if (dragWasPlaying && ytPlayer && typeof ytPlayer.playVideo === 'function') {
    ytPlayer.playVideo();
  }
  dragWasPlaying = false;
}

seekerBar.addEventListener('pointerup', endDrag);
seekerBar.addEventListener('pointercancel', endDrag);
```

- [ ] **Step 3: Suppress the click handler firing after drag**

A drag generates a `click` event at pointerup. The click handler from Task 4 would seek again to the release point (usually harmless, but redundant). Guard against re-entry:

In the click handler (from Task 4), add an early bail if a drag just happened. Replace the click handler with:

```js
seekerBar.addEventListener('click', (e) => {
  e.stopPropagation();
  if (isDragging) return; // shouldn't happen, but guard
  // pointerup fires before click; if a drag occurred, dragWasPlaying was reset
  // and applyDragSeek already handled the position. A pure click (no drag)
  // still falls through here and seeks.
  if (!ytPlayer || typeof ytPlayer.seekTo !== 'function') return;
  const t = seekerTimeFromPointer(e.clientX);
  if (t === null) return;
  ytPlayer.seekTo(t, true);
  const fill = document.getElementById('seeker-fill');
  if (fill && videoDuration > 0) {
    fill.style.width = `${(t / videoDuration) * 100}%`;
  }
});
```

Note: the `click` event after a `pointerdown+pointerup` sequence still fires for pure taps (no movement), so this remains the path for pure-click seeks. For drags, `applyDragSeek` already moved the player and the redundant click-seek hits the same target position — acceptable.

- [ ] **Step 4: Verify in browser (desktop)**

Hard refresh. Load a video and start playback.

Expected:
- Pressing and dragging on the bar with mouse → fill follows cursor smoothly, video pauses during drag, seeks live to the dragged position
- Releasing the mouse → if video was playing, it resumes
- Pure click (no drag) → seek to that point, playback state preserved

- [ ] **Step 5: Verify in browser (mobile / touch)**

Open DevTools → toggle device toolbar (touch mode), or test on a phone if available.

Expected:
- Touch + drag on the bar works the same as mouse drag
- Page doesn't scroll while dragging (thanks to `touch-action: none`)
- Tap (no drag) seeks to that point

- [ ] **Step 6: Commit**

```bash
git add frontend/app.js
git commit -m "feat: support drag-to-seek with pointer events on seeker bar"
```

---

## Task 6: Beep markers on seeker bar

**Files:**
- Modify: `frontend/style.css`
- Modify: `frontend/app.js`

- [ ] **Step 1: Style the marker class**

In `frontend/style.css`, after the `#seeker-beep-markers` rule, add:

```css
.seeker-beep-marker {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 4px;
  margin-left: -2px; /* center on the time position */
  background: #fbbf24;
  pointer-events: none;
}

@media (orientation: landscape) and (max-height: 500px) {
  .seeker-beep-marker {
    width: 3px;
    margin-left: -1.5px;
  }
}
```

- [ ] **Step 2: Add marker render function in JS**

In `frontend/app.js`, add a new function near the other UI helpers:

```js
function renderSeekerBeepMarkers() {
  const container = document.getElementById('seeker-beep-markers');
  if (!container) return;
  container.innerHTML = '';
  if (videoDuration <= 0 || currentBeeps.length === 0) return;
  currentBeeps.forEach((t) => {
    if (t < 0 || t > videoDuration) return;
    const marker = document.createElement('div');
    marker.className = 'seeker-beep-marker';
    marker.style.left = `${(t / videoDuration) * 100}%`;
    container.appendChild(marker);
  });
}
```

- [ ] **Step 3: Call render from `setBeeps` and `onReady`**

At the bottom of `setBeeps` (after the existing `updateCountdown(t);`), add:

```js
function setBeeps(beeps) {
  currentBeeps = [...beeps].sort((a, b) => a - b);
  playedBeepIndices.clear();
  lastKnownTime = 0;
  if (
    expandedBeepTime !== null &&
    !currentBeeps.some((b) => Math.abs(b - expandedBeepTime) < 0.005)
  ) {
    expandedBeepTime = null;
    loopFormDraft = { time: null, interval: '', count: '' };
  }
  renderTimerList();
  updateAddCurrentLabel();
  const t = (ytPlayer && typeof ytPlayer.getCurrentTime === 'function')
    ? ytPlayer.getCurrentTime() : 0;
  updateCountdown(t);
  renderSeekerBeepMarkers();
}
```

In `onReady` (Task 3 modified this already), after `videoDuration = e.target.getDuration() || 0;` add a `renderSeekerBeepMarkers();` call:

```js
onReady: (e) => {
  e.target.mute();
  e.target.setVolume(0);
  videoDuration = e.target.getDuration() || 0;
  renderSeekerBeepMarkers();
  const title = e.target.getVideoData()?.title;
  if (title && currentVideoId) {
    const record = Storage.load(currentVideoId);
    if (record && !record.title) {
      Storage.save(currentVideoId, { ...record, title });
      renderHistory();
    }
  }
},
```

- [ ] **Step 4: Verify in browser**

Hard refresh. Load a video that has existing beeps in history (or use a shared URL with `?v=...&t=10,20,30`).

Expected:
- Yellow vertical lines appear on the seeker bar at the time positions of each beep
- Adding a beep via "新增 Timer" or `+5/+10/+20/+40` buttons → marker immediately appears
- Deleting a beep → marker disappears
- Clicking on a marker (it's `pointer-events: none`, but the bar below handles it) → seeks to that position
- Switching videos → markers refresh with the new video's beeps

- [ ] **Step 5: Commit**

```bash
git add frontend/style.css frontend/app.js
git commit -m "feat: show beep markers on custom seeker bar"
```

---

## Task 7: Full manual regression sweep

**Files:** none (verification only)

- [ ] **Step 1: Run dev server and walk the checklist**

Run `./dev.sh`. Open `http://localhost:5500` in Chrome.

Walk through the spec's test checklist:

- [ ] Portrait mode: bar at video bottom, 20px thick, always visible
- [ ] Landscape mobile (DevTools 800x400): bar 16px thick, layout doesn't break
- [ ] Click bar middle → video jumps to ~50%
- [ ] Drag bar → fill follows finger/cursor, video seeks live
- [ ] Release while playing → video resumes
- [ ] Click video area (not on bar) → toggles play/pause
- [ ] Beep markers visible at correct positions
- [ ] Click on a beep marker → seeks to that beep
- [ ] Touch drag (DevTools touch mode or real phone) → smooth, no page scroll
- [ ] Switch to a different video → markers and duration refresh correctly
- [ ] Video with no beeps → bar still works for seeking, no markers
- [ ] Video load failure (paste a bogus 11-char ID) → no JS errors, bar inert

- [ ] **Step 2: Fix anything that fails**

If any item fails, fix inline and commit with appropriate `fix:` prefix. Re-run the failing item.

- [ ] **Step 3: Final commit (if any docs need updating)**

If `CLAUDE.md` mentions YouTube native controls or related behavior that this change invalidates, update it:

```bash
# inspect first
grep -n -i "control" CLAUDE.md
```

Update if relevant, then:

```bash
git add CLAUDE.md
git commit -m "docs: note custom seeker bar replaces YouTube native controls"
```

---

## Self-Review Notes

Reviewed plan against spec:

- ✅ Spec §架構 (3 layers: youtube-player / click-overlay / seeker-bar) → Tasks 1 + 2
- ✅ Spec §視覺規格 (20px / 16px, colors, hover) → Task 2 + Task 6 (marker styles)
- ✅ Spec §互動行為 (click + drag with pointer events + rAF throttle) → Tasks 4 + 5
- ✅ Spec §進度同步 (videoDuration cache, isDragging skip in tick) → Task 3 + Task 5
- ✅ Spec §Beep 標記渲染 (render in setBeeps + onReady, pointer-events: none) → Task 6
- ✅ Spec §邊界情況 (duration 0, switch video, clamp, load fail) → Tasks 3, 4, 7
- ✅ Spec §測試 checklist → Task 7

Type/name consistency check:
- `videoDuration`, `isDragging`, `dragWasPlaying`, `dragRafPending`, `dragLatestTime` consistent across Tasks 3, 5, 6
- `seekerTimeFromPointer`, `applyDragSeek`, `renderSeekerBeepMarkers`, `updateSeekerFill` referenced consistently
- DOM IDs `#seeker-bar`, `#seeker-track`, `#seeker-fill`, `#seeker-beep-markers`, `#player-click-overlay` consistent throughout
- `.seeker-beep-marker` class name matches between CSS (Task 6 Step 1) and JS (Task 6 Step 2)

No placeholders.
