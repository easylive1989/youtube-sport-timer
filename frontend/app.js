// --- State ---
let ytPlayer = null;
let currentBeeps = [];
let playedBeepIndices = new Set();
let timerIntervalId = null;
let isPlaying = false;
let lastKnownTime = 0;
let audioCtx = null;
let currentVideoId = null;

// --- YouTube IFrame API callback (must be global) ---
window.onYouTubeIframeAPIReady = function () {
  renderHistory();
};

// Resume AudioContext when page comes back to foreground (mobile)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
});

// --- Player ---
function initPlayer(videoId) {
  if (ytPlayer && typeof ytPlayer.destroy === 'function') {
    ytPlayer.destroy();
  }
  ytPlayer = new YT.Player('youtube-player', {
    videoId,
    playerVars: { mute: 1, rel: 0, modestbranding: 1 },
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
}

function onPlayerStateChange(event) {
  if (event.data === YT.PlayerState.PLAYING && !isPlaying) {
    isPlaying = true;
    event.target.mute();
    event.target.setVolume(0);
    startTicker();
  } else if (
    (event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.ENDED) &&
    isPlaying
  ) {
    isPlaying = false;
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
  label.textContent = `${Math.ceil(timeToNext)}s`;
}

// --- Audio + Visual ---
async function playBeep() {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') await audioCtx.resume();
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
      <div class="history-actions">
        <button class="share-tile-btn" onclick="event.stopPropagation(); shareHistory('${safeId}', this)">分享</button>
        <button class="delete-btn" onclick="event.stopPropagation(); deleteFromHistory('${safeId}')">刪除</button>
      </div>
    `;
    li.style.cursor = 'pointer';
    li.addEventListener('click', () => loadFromHistory(safeId));
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

function shareHistory(videoId, btn) {
  const item = Storage.load(videoId);
  if (!item) return;
  const params = new URLSearchParams({ v: videoId });
  if (item.beeps?.length > 0) params.set('t', item.beeps.join(','));
  const url = `${location.origin}${location.pathname}?${params.toString()}`;
  navigator.clipboard.writeText(url).then(() => {
    const original = btn.textContent;
    btn.textContent = '已複製！';
    setTimeout(() => { btn.textContent = original; }, 1500);
  });
}

function loadFromHistory(videoId) {
  const item = Storage.load(videoId);
  if (!item) return;
  document.getElementById('url-input').value = item.url;
  setBeeps(item.beeps);
  document.getElementById('status-msg').textContent = '';
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
  renderTimerList();
  updateAddCurrentLabel();
}

function showPlayer(videoId) {
  currentVideoId = videoId;
  const section = document.getElementById('player-section');
  section.removeAttribute('hidden');
  stopTicker();
  isPlaying = false;
  document.getElementById('countdown-fill').style.width = '0%';
  document.getElementById('next-beep-label').textContent = '--';
  updateURL();
  initPlayer(videoId);
}

// --- Timer Edit ---
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}


function renderTimerList() {
  const list = document.getElementById('timer-list');
  const count = document.getElementById('timer-count');
  if (!list || !count) return;
  count.textContent = '';
  list.innerHTML = '';
  if (currentBeeps.length === 0) {
    list.innerHTML = '<li class="empty">新增一個 timer</li>';
    return;
  }
  currentBeeps.forEach((t, i) => {
    const li = document.createElement('li');
    const timeEl = document.createElement('span');
    timeEl.className = 'timer-time';
    timeEl.textContent = formatTime(t);
    timeEl.addEventListener('click', () => {
      if (ytPlayer && typeof ytPlayer.seekTo === 'function') {
        ytPlayer.seekTo(t, true);
      }
    });
    const actions = document.createElement('div');
    actions.className = 'timer-actions';
    [5, 10, 20, 40].forEach((offset) => {
      const btn = document.createElement('button');
      btn.className = 'offset-btn';
      btn.textContent = `+${offset}`;
      btn.addEventListener('click', () => addBeep(t + offset));
      actions.appendChild(btn);
    });
    const delBtn = document.createElement('button');
    delBtn.className = 'delete-btn';
    delBtn.textContent = '×';
    delBtn.addEventListener('click', () => removeBeepAt(i));
    actions.appendChild(delBtn);
    li.appendChild(timeEl);
    li.appendChild(actions);
    list.appendChild(li);
  });
}

function updateAddCurrentLabel() {}

function addBeep(t) {
  const rounded = Math.round(t * 100) / 100;
  if (currentBeeps.some((b) => Math.abs(b - rounded) < 0.005)) return;
  setBeeps([...currentBeeps, rounded]);
  persistCurrentBeeps();
}

function removeBeepAt(i) {
  setBeeps(currentBeeps.filter((_, idx) => idx !== i));
  persistCurrentBeeps();
}

function persistCurrentBeeps() {
  if (!currentVideoId) return;
  const record = Storage.load(currentVideoId);
  if (!record) return;
  Storage.save(currentVideoId, { ...record, beeps: [...currentBeeps] });
  renderHistory();
  updateURL();
}

function updateURL() {
  if (!currentVideoId) return;
  const params = new URLSearchParams();
  params.set('v', currentVideoId);
  if (currentBeeps.length > 0) params.set('t', currentBeeps.join(','));
  history.replaceState(null, '', '?' + params.toString());
}


// --- DOM Events ---
function extractVideoId(url) {
  const match = url.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return match ? match[1] : null;
}

document.addEventListener('DOMContentLoaded', () => {
  // Restore from URL params (bookmarks / shared links)
  const params = new URLSearchParams(window.location.search);
  const urlVideoId = params.get('v');
  if (urlVideoId) {
    const urlBeeps = params.get('t')
      ? params.get('t').split(',').map(Number).filter(n => !isNaN(n) && n >= 0)
      : null;
    const url = `https://www.youtube.com/watch?v=${urlVideoId}`;
    document.getElementById('url-input').value = url;
    if (!audioCtx) audioCtx = new AudioContext();
    const existing = Storage.load(urlVideoId);
    const beeps = urlBeeps ?? (existing?.beeps || []);
    if (!existing) {
      Storage.save(urlVideoId, { url, video_id: urlVideoId, title: '', beeps, analyzed_at: new Date().toISOString() });
    } else if (urlBeeps) {
      Storage.save(urlVideoId, { ...existing, beeps });
    }
    setBeeps(beeps);
    showPlayer(urlVideoId);
    renderHistory();
  }

  document.getElementById('load-btn').addEventListener('click', () => {
    const url = document.getElementById('url-input').value.trim();
    if (!url) return;

    const statusMsg = document.getElementById('status-msg');
    const videoId = extractVideoId(url);
    if (!videoId) {
      statusMsg.textContent = '無效的 YouTube 網址';
      return;
    }

    statusMsg.textContent = '';
    if (!audioCtx) audioCtx = new AudioContext();

    const existing = Storage.load(videoId);
    if (existing) {
      setBeeps(existing.beeps || []);
    } else {
      setBeeps([]);
      Storage.save(videoId, {
        url,
        video_id: videoId,
        title: '',
        beeps: [],
        analyzed_at: new Date().toISOString(),
      });
    }
    showPlayer(videoId);
    renderHistory();
  });

  document.getElementById('add-current-btn').addEventListener('click', () => {
    if (!ytPlayer || typeof ytPlayer.getCurrentTime !== 'function') return;
    addBeep(ytPlayer.getCurrentTime());
  });


});
