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
  if (ytPlayer && typeof ytPlayer.destroy === 'function') {
    ytPlayer.destroy();
  }
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
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
  currentBeeps = [...beeps].sort((a, b) => a - b);
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
