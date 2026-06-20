(function(){
  "use strict";

  /* ============================================================
     運動節奏計時器 — 核心引擎
     資料模型：TS = 時間點陣列（秒）。
       phases[0] = 準備（0 → TS[0]）
       之後每個 TS 區間交替為 運動 / 休息
       （奇數點開始運動、偶數點開始休息）
     每支影片的時間點存於 Storage（per-video），key = video id。
     ============================================================ */

  /* ---------- config / params ---------- */
  var DEFAULT_VIDEO = "LmrKejHOaG4";
  var DEFAULT_TS = [40.49,85.09,100.59,145.56,160.59,205.56,220.59,265.56,280.59,325.56,
    340.59,385.56,400.59,445.56,460.59,505.56,520.59,565.56,580.59,625.56,640.59,685.56,
    700.59,745.56,760.59,805.56,820.59,865.56,880.59,925.56,940.59,985.56,1000.59,1045.56,
    1060.59,1105.56,1120.59,1165.56,1180.59,1225.56,1240.59];

  var libApiUrl = (window.YST_CONFIG && window.YST_CONFIG.sharedApiUrl) || "";
  var AV_COLORS = ["oklch(0.70 0.185 42)","oklch(0.74 0.115 205)","oklch(0.76 0.16 152)","oklch(0.84 0.155 92)","oklch(0.7 0.16 330)"];

  var params = new URLSearchParams(location.search);
  function ls(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function lsSet(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }

  var urlV = params.get("v"), urlT = params.get("t");
  var VIDEO = (urlV && urlV.trim()) ? urlV.trim() : (ls("yst-video") || DEFAULT_VIDEO);

  var TS = null;
  if (urlT && urlT.indexOf(",") !== -1){
    var a = urlT.split(",").map(function(s){return parseFloat(s);}).filter(function(x){return isFinite(x);});
    if (a.length >= 2) TS = a;
  }
  // 其次：該影片在 Storage 內既有的時間點
  if (!TS){
    try{
      var rec = Storage.load(VIDEO);
      if (rec && Array.isArray(rec.beeps) && rec.beeps.length >= 2) TS = rec.beeps.slice();
    }catch(e){}
  }
  if (!TS) TS = DEFAULT_TS.slice();

  // 提示音量採對數（感知）刻度：每一階提升的響度感受一致
  var VOL_CURVE = [0, 0.1, 0.14, 0.2, 0.28, 0.4, 0.55, 0.7, 0.82, 0.92, 1.0];
  var level = 6; var _lv = parseInt(ls("yst-vol"),10); if (!isNaN(_lv) && _lv>=0 && _lv<=10) level = _lv;
  var masterVol = VOL_CURVE[level];

  var phases = [], W = 0, TOTAL_WORK = 0, T_START = 0, T_END = 0;

  /* ---------- elements ---------- */
  var app = document.getElementById("app");
  var elPhase = document.getElementById("phaseLabel");
  var elRep   = document.getElementById("rep");
  var elCount = document.getElementById("count");
  var elNext  = document.getElementById("next");
  var elRing  = document.getElementById("ringProg");
  var elElapsed = document.getElementById("elapsed");
  var elProgress = document.getElementById("progress");
  var elProgressTrack = document.getElementById("progressTrack");
  var elProgressThumb = document.getElementById("progressThumb");
  var startBtn = document.getElementById("startBtn");
  var playBtn  = document.getElementById("playBtn");
  var beepBtn  = document.getElementById("beepBtn");

  var RING_C = 2 * Math.PI * 86;
  elRing.style.strokeDasharray = RING_C.toFixed(1);
  elRing.style.strokeDashoffset = RING_C.toFixed(1);

  /* segmented progress bar + phase rebuild */
  var segEls = [];
  function buildProgress(){
    elProgress.innerHTML = "";
    segEls = [];
    var span = (T_END - T_START) || 1;
    for (var k=1; k<TS.length; k++){
      var d = TS[k]-TS[k-1];
      var isWork = ((k-1)%2===0);
      var seg = document.createElement("div");
      seg.className = "pseg " + (isWork?"work":"rest");
      seg.style.flex = (d/span).toFixed(4) + " 1 0";
      var fill = document.createElement("div");
      fill.className = "fill";
      seg.appendChild(fill);
      elProgress.appendChild(seg);
      segEls.push({el:seg, fill:fill, start:TS[k-1], end:TS[k]});
    }
  }
  function rebuild(){
    TS = TS.filter(function(x){return isFinite(x) && x>=0;}).sort(function(a,b){return a-b;});
    phases = []; W = 0;
    if (TS.length>0){
      phases.push({type:"ready", start:0, end:TS[0], workNo:0});
      for (var i=1; i<TS.length; i++){
        var isWork = ((i-1)%2===0); if (isWork) W++;
        phases.push({type:isWork?"work":"rest", start:TS[i-1], end:TS[i], workNo:W});
      }
    }
    TOTAL_WORK = W;
    T_START = TS.length ? TS[0] : 0;
    T_END = TS.length ? TS[TS.length-1] : 0;
    buildProgress();
    if (typeof renderTimers === "function") renderTimers();
    prevIdx = -99; lastBeepR = -1;
    var cv = document.getElementById("curVid"); if (cv) cv.textContent = VIDEO;
    var tc = document.getElementById("tCount"); if (tc) tc.textContent = TS.length;
  }

  /* ---------- audio ---------- */
  var actx = null, beepOn = true;
  function ensureAudio(){
    if (!actx){
      try { actx = new (window.AudioContext||window.webkitAudioContext)(); }
      catch(e){ return; }
    }
    if (actx.state === "suspended") actx.resume();
  }
  function tone(freq, dur, when, type, gainVal){
    if (!actx || !beepOn || masterVol<=0) return;
    var t0 = actx.currentTime + (when||0);
    var o = actx.createOscillator(), g = actx.createGain();
    o.type = type||"sine"; o.frequency.value = freq;
    o.connect(g); g.connect(actx.destination);
    var peak = Math.max(0.0002, (gainVal||0.18) * masterVol);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0+0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
    o.start(t0); o.stop(t0+dur+0.03);
  }
  function beepCount(){ tone(880,0.12,0,"square",0.16); }                 // 3-2-1
  function cueWork(){ tone(1318,0.16,0,"sawtooth",0.20); tone(1760,0.20,0.14,"sawtooth",0.18); }
  function cueRest(){ tone(523,0.40,0,"sine",0.18); }
  function cueDone(){ [659,880,1175,1568].forEach(function(f,i){ tone(f,0.24,i*0.16,"triangle",0.17); }); }

  /* ---------- youtube player ---------- */
  var player=null, playerReady=false, playerOk=false;
  // 影片本身完全靜音：只靠 app 產生的提示音來提示換動作
  function muteVideo(){
    try{ player.mute(); player.setVolume(0); }catch(e){}
  }
  // 取得影片標題並存入該影片的歷史紀錄（供歷史清單顯示真實標題）
  function captureTitle(){
    try{
      var data = player.getVideoData && player.getVideoData();
      var title = data && data.title;
      if (!title) return;
      var stored = Storage.load(VIDEO);
      if (stored && !stored.title){
        Storage.save(VIDEO, Object.assign({}, stored, { title: title }));
        if (typeof renderHistory === "function") renderHistory();
      }
    }catch(e){}
  }
  window.onYouTubeIframeAPIReady = function(){
    try{
      player = new YT.Player("player", {
        videoId: VIDEO,
        playerVars:{ mute:1, controls:0, modestbranding:1, rel:0, playsinline:1, iv_load_policy:3, fs:0, disablekb:1 },
        events:{
          onReady:function(){
            playerReady=true; playerOk=true;
            muteVideo();
            captureTitle();
            if (restoreTime>1){ try{ player.seekTo(restoreTime,true); player.pauseVideo(); }catch(e){} }
          },
          onError:function(){ playerOk=false; },
          onStateChange:function(e){
            if (e.data === YT.PlayerState.PLAYING){ muteVideo(); captureTitle(); setPlaying(true,true); }
            else if (e.data === YT.PlayerState.PAUSED){ setPlaying(false,true); }
            else if (e.data === YT.PlayerState.ENDED){ setPlaying(false,true); }
          }
        }
      });
    }catch(e){ playerOk=false; }
  };

  /* ---------- engine state ---------- */
  var clock = 0, playing = false, started = false;
  var prevIdx = -99, lastBeepR = -1;
  var lastSave = 0;
  var restoreTime = 0;

  function usingPlayer(){ return playerReady && playerOk && player && typeof player.getCurrentTime === "function"; }

  function findPhase(t){
    if (t >= T_END) return {idx: phases.length, done:true};
    if (t < TS[0])  return {idx:0, phase:phases[0], done:false};
    for (var k=1; k<phases.length; k++){
      if (t < phases[k].end) return {idx:k, phase:phases[k], done:false};
    }
    return {idx:phases.length, done:true};
  }

  var PH_TEXT = { ready:"準備", work:"運動", rest:"休息", done:"完成" };
  var PH_LIT = { ready:"oklch(0.84 0.155 92)", work:"oklch(0.70 0.185 42)", rest:"oklch(0.74 0.115 205)", done:"oklch(0.76 0.16 152)" };

  function setPlaying(v, fromPlayer){
    playing = v;
    app.setAttribute("data-playing", v?"true":"false");
    if (!fromPlayer && usingPlayer()){
      if (v) { try{ player.playVideo(); }catch(e){} }
      else   { try{ player.pauseVideo(); }catch(e){} }
    }
  }

  function start(){
    started = true;
    ensureAudio();
    startBtn.classList.add("hidden");
    startBtn.style.display = "none";
    setPlaying(true,false);
  }

  function setPhaseTheme(type){
    var cur = app.getAttribute("data-phase");
    if (cur !== type){
      app.setAttribute("data-phase", type);
      document.documentElement.style.setProperty("--phase", PH_LIT[type]);
    }
  }

  function fmt(s){
    s = Math.max(0, Math.floor(s));
    var m = Math.floor(s/60), ss = s%60;
    return (m<10?"0":"")+m+":"+(ss<10?"0":"")+ss;
  }

  function pulse(){
    app.classList.remove("pulse"); void app.offsetWidth; app.classList.add("pulse");
  }

  function update(t){
    var r = findPhase(t);
    var idx = r.idx;
    var type, timeLeft, dur, ph;

    if (r.done){
      type = "done"; timeLeft = 0; dur = 1;
    } else {
      ph = r.phase; type = ph.type;
      timeLeft = Math.max(0, ph.end - t);
      dur = ph.end - ph.start || 1;
    }

    setPhaseTheme(type);

    // phase change -> cue + pulse
    if (idx !== prevIdx){
      if (prevIdx !== -99 && started){
        if (type === "work") cueWork();
        else if (type === "rest") cueRest();
        else if (type === "done") cueDone();
        pulse();
      }
      prevIdx = idx;
      lastBeepR = -1;
    }

    // countdown beeps (last 3s of any timed phase, incl. 準備)
    if (!r.done){
      var rc = Math.ceil(timeLeft - 1e-6);
      if (rc !== lastBeepR && rc >= 1 && rc <= 3 && started){
        beepCount();
        lastBeepR = rc;
      } else if (rc > 3){
        lastBeepR = rc;
      }
    }

    // text
    elPhase.textContent = PH_TEXT[type];
    if (r.done){
      elCount.textContent = "✓";
      elRep.textContent = "全部完成 · " + TOTAL_WORK + " 組";
      elNext.innerHTML = '<span class="dot"></span>做得好！';
    } else {
      elCount.textContent = Math.ceil(timeLeft - 1e-6);
      if (type === "ready"){
        elRep.textContent = "準備開始 · 共 " + TOTAL_WORK + " 組";
        elNext.innerHTML = '<span class="dot"></span>接下來：運動';
      } else if (type === "work"){
        elRep.innerHTML = "第 <b>" + ph.workNo + "</b> / " + TOTAL_WORK + " 組";
        elNext.innerHTML = '<span class="dot"></span>' + (ph.workNo>=TOTAL_WORK ? "接下來：完成" : "接下來：休息");
      } else { // rest
        elRep.innerHTML = "休息中 · 下一組 <b>" + Math.min(ph.workNo+1, TOTAL_WORK) + "</b>";
        elNext.innerHTML = '<span class="dot"></span>接下來：運動';
      }
    }

    // ring (remaining fraction)
    var frac = r.done ? 0 : Math.max(0, Math.min(1, timeLeft / dur));
    elRing.style.strokeDashoffset = (RING_C * (1 - frac)).toFixed(1);

    // progress segments
    for (var i=0; i<segEls.length; i++){
      var s = segEls[i], p;
      if (t >= s.end) p = 100;
      else if (t <= s.start) p = 0;
      else p = ((t - s.start)/(s.end - s.start))*100;
      s.fill.style.width = p.toFixed(2) + "%";
    }

    // elapsed label
    elElapsed.textContent = fmt(Math.min(t, T_END)) + " / " + fmt(T_END);

    // persist playback position
    if (t - lastSave > 1 || lastSave - t > 1){
      lastSave = t;
      try{ localStorage.setItem("yst-time", String(t)); }catch(e){}
    }
  }

  /* ---------- raf loop ---------- */
  var lastNow = performance.now();
  function frame(now){
    var dt = (now - lastNow)/1000; lastNow = now;
    if (dt > 0.5) dt = 0;
    if (usingPlayer()){
      try{ clock = player.getCurrentTime() || clock; }catch(e){}
    } else if (playing){
      clock += dt;
      if (clock >= T_END) { clock = T_END; setPlaying(false,false); }
    }
    update(clock);
    updateThumb(clock);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* ---------- interactions ---------- */
  startBtn.addEventListener("click", start);
  playBtn.addEventListener("click", function(){
    ensureAudio();
    if (!started){ start(); return; }
    setPlaying(!playing, false);
  });

  beepBtn.addEventListener("click", function(){
    beepOn = !beepOn;
    beepBtn.setAttribute("data-on", beepOn?"true":"false");
    try{ localStorage.setItem("yst-beep", beepOn?"1":"0"); }catch(e){}
    if (beepOn){ ensureAudio(); tone(880,0.1,0,"square",0.14); }
  });

  /* ---------- progress drag ---------- */
  function seekToFrac(frac){
    frac = Math.max(0, Math.min(1, frac));
    var target = T_START + frac*(T_END - T_START);
    clock = target;
    prevIdx = -99; lastBeepR = -1;
    if (usingPlayer()){ try{ player.seekTo(target, true); }catch(err){} }
    update(clock);
    if (elProgressThumb && elProgressTrack){
      var trackW = elProgressTrack.getBoundingClientRect().width;
      var px = frac * (trackW - 28) + 14;
      elProgressThumb.style.left = px.toFixed(1) + "px";
    }
  }
  function fracFromEvent(e){
    var rect = elProgressTrack.getBoundingClientRect();
    var px = (e.touches ? e.touches[0].clientX : e.clientX);
    return (px - rect.left) / rect.width;
  }
  var dragging = false;
  elProgressTrack.addEventListener("mousedown", function(e){
    dragging = true; elProgressTrack.classList.add("dragging");
    seekToFrac(fracFromEvent(e)); e.preventDefault();
  });
  document.addEventListener("mousemove", function(e){
    if (!dragging) return;
    seekToFrac(fracFromEvent(e));
  });
  document.addEventListener("mouseup", function(){
    if (dragging){ dragging = false; elProgressTrack.classList.remove("dragging"); }
  });
  elProgressTrack.addEventListener("touchstart", function(e){
    dragging = true; elProgressTrack.classList.add("dragging");
    seekToFrac(fracFromEvent(e)); e.preventDefault();
  }, {passive:false});
  document.addEventListener("touchmove", function(e){
    if (!dragging) return;
    seekToFrac(fracFromEvent(e)); e.preventDefault();
  }, {passive:false});
  document.addEventListener("touchend", function(){
    if (dragging){ dragging = false; elProgressTrack.classList.remove("dragging"); }
  });
  function updateThumb(t){
    if (dragging || !elProgressThumb || !elProgressTrack || T_END <= T_START) return;
    var frac = Math.max(0, Math.min(1, (t - T_START)/(T_END - T_START)));
    var trackW = elProgressTrack.getBoundingClientRect().width;
    if (trackW > 0){
      var px = frac * (trackW - 28) + 14;
      elProgressThumb.style.left = px.toFixed(1) + "px";
    }
  }

  /* ---------- 共用小工具 ---------- */
  function statsOf(ts){
    if (!Array.isArray(ts) || ts.length < 2) return {work:0, dur:0};
    return {
      work: Math.ceil((ts.length - 1) / 2),
      dur:  Math.round(ts[ts.length-1] - ts[0])
    };
  }
  function fmtDurSec(s){
    s = Math.round(Math.abs(s||0));
    var m = Math.floor(s/60), ss = s%60;
    return m + ":" + (ss<10?"0":"") + ss;
  }
  function avColor(name){
    var h = 0;
    for (var i=0; i<(name||"").length; i++) h = (h*31 + name.charCodeAt(i)) % AV_COLORS.length;
    return AV_COLORS[h];
  }

  /* ---------- 多抽屜系統 ---------- */
  var drawerBg  = document.getElementById("drawerBg");
  var drawer    = document.getElementById("drawer");      // 設定（右）
  var histDrawer = document.getElementById("histDrawer"); // 歷史（左）
  var libDrawer  = document.getElementById("libDrawer");  // 共享清單（左）

  var openEl = null;
  var _bgT   = null;

  function openDrawer(el){
    if (_bgT){ clearTimeout(_bgT); _bgT = null; }
    // 關掉已開的抽屜（不觸發 backdrop 消失）
    if (openEl && openEl !== el){
      var wasLeft = openEl.classList.contains("left");
      openEl.style.transform = wasLeft ? "translateX(-100%)" : "translateX(100%)";
      openEl.setAttribute("aria-hidden","true");
    }
    openEl = el;
    el.setAttribute("aria-hidden","false");
    el.style.transform = "translateX(0)";
    drawerBg.hidden = false;
    requestAnimationFrame(function(){ drawerBg.style.opacity = "1"; });
  }
  function closeDrawer(){
    if (openEl){
      var left = openEl.classList.contains("left");
      openEl.style.transform = left ? "translateX(-100%)" : "translateX(100%)";
      openEl.setAttribute("aria-hidden","true");
      openEl = null;
    }
    drawerBg.style.opacity = "0";
    _bgT = setTimeout(function(){ drawerBg.hidden = true; _bgT = null; }, 280);
  }

  function openSettings(){
    urlInput.value = ""; urlInput.placeholder = "目前 ID：" + VIDEO;
    openDrawer(drawer);
  }
  function openHistory(){ renderHistory(); openDrawer(histDrawer); }
  function openLibrary(){ renderLibrary(); openDrawer(libDrawer); }

  // fab 按鈕
  document.getElementById("settingsBtn").addEventListener("click", openSettings);
  document.getElementById("historyBtn").addEventListener("click", openHistory);
  document.getElementById("libraryBtn").addEventListener("click", openLibrary);

  // 關閉
  document.getElementById("drawerClose").addEventListener("click", closeDrawer);
  document.getElementById("histClose").addEventListener("click", closeDrawer);
  document.getElementById("libClose").addEventListener("click", closeDrawer);
  drawerBg.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", function(e){ if (e.key==="Escape") closeDrawer(); });

  /* ---------- 歷史紀錄抽屜 ---------- */
  var histList    = document.getElementById("histList");
  var clearHistBtn = document.getElementById("clearHistBtn");

  function makeHistCard(rec){
    var id = rec.video_id;
    var title = (rec.title && rec.title.trim()) ? rec.title.trim() : id;
    var ts = Array.isArray(rec.beeps) ? rec.beeps : [];
    var st = statsOf(ts);
    var card = document.createElement("button");
    card.className = "card" + (id === VIDEO ? " active" : "");
    card.innerHTML =
      '<span class="thumb">'+
        '<span class="ph">'+
          '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="rgba(255,255,255,.8)"/></svg>'+
        '</span>'+
        '<img src="https://i.ytimg.com/vi/'+id+'/mqdefault.jpg" alt="" onerror="this.style.display=\'none\'">'+
        (st.dur ? '<span class="dur">'+fmtDurSec(st.dur)+'</span>' : '')+
      '</span>'+
      '<span class="meta">'+
        '<span class="ttl">'+title+'</span>'+
        '<span class="by"><span class="av" style="background:oklch(0.7 0.12 42)">自</span>自訂</span>'+
        '<span class="stats">'+
          (st.work ? '<span class="pill"><b>'+st.work+'</b> 組</span>' : '')+
          (st.dur  ? '<span class="pill">'+fmtDurSec(st.dur)+'</span>' : '')+
        '</span>'+
      '</span>'+
      '<span class="del2" role="button" aria-label="刪除">✕</span>';
    card.addEventListener("click", function(e){
      if (e.target.classList && e.target.classList.contains("del2")){
        e.stopPropagation();
        try{ Storage.remove(id); }catch(err){}
        renderHistory();
        return;
      }
      if (id !== VIDEO){ loadVideo(id); syncURL(); }
      closeDrawer();
    });
    return card;
  }

  function renderHistory(){
    if (!histList) return;
    var items = [];
    try{ items = Storage.all().filter(function(r){ return r && r.video_id; }); }catch(e){ items=[]; }
    items.sort(function(a,b){ return new Date(b.analyzed_at||0) - new Date(a.analyzed_at||0); });
    histList.innerHTML = "";
    if (!items.length){
      var em = document.createElement("div"); em.className="lib-empty";
      em.textContent="還沒有紀錄。載入任一計時後就會出現在這裡。";
      histList.appendChild(em); return;
    }
    items.forEach(function(rec){ histList.appendChild(makeHistCard(rec)); });
  }

  clearHistBtn.addEventListener("click", function(){
    // 清除所有 yst_ 開頭（per-video）的 localStorage 項目
    try{
      Object.keys(localStorage)
        .filter(function(k){ return k.startsWith("yst_"); })
        .forEach(function(k){ localStorage.removeItem(k); });
    }catch(e){}
    renderHistory();
  });

  /* ---------- 共享清單抽屜 ---------- */
  var libList    = document.getElementById("libList");
  var publishBtn = document.getElementById("publishBtn");
  var authorInput = document.getElementById("authorInput");

  // 初始化暱稱
  (function(){
    var saved = ls("yst-name");
    if (saved && authorInput) authorInput.value = saved;
  })();
  if (authorInput){
    authorInput.addEventListener("change", function(){
      lsSet("yst-name", authorInput.value.trim());
    });
  }

  function makeLibCard(item){
    var ts = Array.isArray(item.ts) ? item.ts : [];
    var st = statsOf(ts);
    var av = avColor(item.author||"?");
    var card = document.createElement("button");
    card.className = "card";
    card.innerHTML =
      '<span class="thumb">'+
        '<span class="ph">'+
          '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="rgba(255,255,255,.8)"/></svg>'+
        '</span>'+
        '<img src="https://i.ytimg.com/vi/'+(item.video||'')+'/mqdefault.jpg" alt="" onerror="this.style.display=\'none\'">'+
        (st.dur ? '<span class="dur">'+fmtDurSec(st.dur)+'</span>' : '')+
      '</span>'+
      '<span class="meta">'+
        '<span class="ttl">'+(item.title||'未命名訓練')+'</span>'+
        '<span class="by">'+
          '<span class="av" style="background:'+av+'">'+(item.author||'?').slice(0,1)+'</span>'+
          (item.author||'匿名')+
        '</span>'+
        '<span class="stats">'+
          (st.work ? '<span class="pill"><b>'+st.work+'</b> 組</span>' : '')+
          (st.dur  ? '<span class="pill">'+fmtDurSec(st.dur)+'</span>' : '')+
        '</span>'+
      '</span>';
    card.addEventListener("click", function(){
      if (ts.length >= 2) loadTimerSet(item.video||VIDEO, ts);
    });
    return card;
  }

  function fetchShared(callback){
    var xhr = new XMLHttpRequest();
    xhr.open("GET", libApiUrl, true);
    xhr.onload = function(){
      if (xhr.status >= 200 && xhr.status < 300){
        try{ callback(JSON.parse(xhr.responseText)); }
        catch(e){ callback(null,"PARSE_ERR"); }
      } else { callback(null,"HTTP_ERR"); }
    };
    xhr.onerror = function(){ callback(null,"NET_ERR"); };
    xhr.send();
  }

  function publishShared(data, callback){
    var xhr = new XMLHttpRequest();
    xhr.open("POST", libApiUrl, true);
    // text/plain 避免觸發 preflight OPTIONS（Apps Script 無法回應）
    xhr.setRequestHeader("Content-Type","text/plain;charset=utf-8");
    xhr.onload = function(){
      var resp = null;
      try{ resp = JSON.parse(xhr.responseText); }catch(e){}
      var httpOk = xhr.status >= 200 && xhr.status < 300;
      // 後端可能回 {ok:false, error:"duplicate"}（HTTP 仍是 200）
      var ok = httpOk && (!resp || resp.ok !== false);
      callback(ok, resp);
    };
    xhr.onerror = function(){ callback(false, null); };
    xhr.send(JSON.stringify(data));
  }

  // 把時間點陣列正規化成可比對的字串（四捨五入到小數兩位）
  function normTs(arr){
    return (arr||[]).map(function(x){ return Math.round(x*100)/100; }).join(",");
  }
  // 從共享項目取出時間點陣列（Sheets 以逗號字串儲存）
  function itemTsArr(it){
    return typeof it.ts === "string"
      ? it.ts.split(",").map(Number).filter(isFinite)
      : (Array.isArray(it.ts) ? it.ts : []);
  }

  function renderLibrary(){
    if (!libList) return;
    if (!libApiUrl){
      libList.innerHTML = '<div class="lib-empty">尚未設定共享來源。請在 config.js 填入 Google Apps Script URL 後重新整理。</div>';
      return;
    }
    libList.innerHTML = '<div class="lib-empty">載入中…</div>';
    fetchShared(function(items, err){
      libList.innerHTML = "";
      if (err || !items){
        var em = document.createElement("div"); em.className="lib-empty";
        em.textContent="無法載入共享清單，請稍後再試。";
        libList.appendChild(em); return;
      }
      if (!items.length){
        var em2 = document.createElement("div"); em2.className="lib-empty";
        em2.textContent="清單還沒有內容，成為第一個分享的人吧！";
        libList.appendChild(em2); return;
      }
      items.forEach(function(it){
        // ts 在 Google Sheets 以逗號分隔字串儲存，需轉回陣列
        var ts = typeof it.ts === "string"
          ? it.ts.split(",").map(Number).filter(isFinite)
          : (Array.isArray(it.ts) ? it.ts : []);
        it.ts = ts;
        libList.appendChild(makeLibCard(it));
      });
    });
  }

  function loadTimerSet(video, ts){
    TS = ts.slice();
    if (video && video !== VIDEO){
      VIDEO = video;
      clock = 0; prevIdx = -99; lastBeepR = -1;
      started = false; setPlaying(false,false);
      startBtn.style.display = ""; startBtn.classList.remove("hidden");
      if (player && playerReady){ try{ player.cueVideoById(video); playerOk = true; }catch(e){} }
      var cv = document.getElementById("curVid"); if (cv) cv.textContent = VIDEO;
    } else {
      clock = 0; started = false; setPlaying(false,false);
      startBtn.style.display = ""; startBtn.classList.remove("hidden");
    }
    rebuild(); syncURL(); saveConfig();
    closeDrawer();
  }

  if (publishBtn) publishBtn.addEventListener("click", function(){
    if (!libApiUrl){
      alert("請先在 config.js 填入共享清單 URL。");
      return;
    }
    if (TS.length < 2){
      alert("目前沒有時間點可以分享。");
      return;
    }
    var st = statsOf(TS);
    var stored = null;
    try{ stored = Storage.load(VIDEO); }catch(e){}
    var title = (stored && stored.title && stored.title.trim())
      ? stored.title.trim()
      : ("自訂訓練 · " + st.work + " 組 " + fmtDurSec(st.dur));
    var author = (authorInput && authorInput.value.trim()) ? authorInput.value.trim() : "匿名";
    lsSet("yst-name", author);

    var orig = publishBtn.textContent;
    var myKey = VIDEO + "|" + normTs(TS);

    function resetBtn(msg){
      publishBtn.disabled = false;
      publishBtn.textContent = msg;
      setTimeout(function(){ publishBtn.textContent = orig; }, 2000);
    }

    function doPublish(){
      publishBtn.textContent = "上傳中…";
      publishShared({
        id: "u-" + Date.now(),
        title: title,
        author: author,
        video: VIDEO,
        ts: normTs(TS)
      }, function(ok, resp){
        if (ok){
          publishBtn.disabled = false;
          publishBtn.textContent = "已加入清單 ✓";
          renderLibrary();
          setTimeout(function(){ publishBtn.textContent = orig; }, 2000);
        } else if (resp && resp.error === "duplicate"){
          // 後端擋下的重複（並發情況）
          resetBtn("已有相同的分享了");
          renderLibrary();
        } else {
          resetBtn("上傳失敗，請稍後再試");
        }
      });
    }

    // 送出前先抓最新清單，比對是否已有「同影片 + 相同時間點」的分享
    publishBtn.textContent = "檢查中…";
    publishBtn.disabled = true;
    fetchShared(function(items, err){
      if (!err && Array.isArray(items)){
        var dup = items.some(function(it){
          return ((it.video||"") + "|" + normTs(itemTsArr(it))) === myKey;
        });
        if (dup){ resetBtn("已有相同的分享了"); return; }
      }
      // 抓清單失敗就直接送出，交由後端做最終把關
      doPublish();
    });
  });

  /* ---------- 設定抽屜 ---------- */
  var urlInput  = document.getElementById("urlInput");
  var loadBtn   = document.getElementById("loadBtn");
  var volRange  = document.getElementById("volRange");
  var vlevel    = document.getElementById("vlevel");
  var volDown   = document.getElementById("volDown");
  var volUp     = document.getElementById("volUp");
  var addNow    = document.getElementById("addNow");
  var tlist     = document.getElementById("tlist");
  var copyLink  = document.getElementById("copyLink");
  var resetBtn  = document.getElementById("resetBtn");

  function fmtMs(s){
    var neg = s<0; s = Math.abs(s);
    var m = Math.floor(s/60), rem = s - m*60;
    var w = Math.floor(rem), cs = Math.round((rem-w)*100);
    if (cs===100){ cs=0; w++; }
    return (neg?"-":"") + m + ":" + (w<10?"0":"") + w + "." + (cs<10?"0":"") + cs;
  }

  function renderTimers(){
    if (!tlist) return;
    tlist.innerHTML = "";
    TS.forEach(function(v, i){
      var isWork = (i%2===0);
      var row = document.createElement("div");
      row.className = "trow";
      row.innerHTML =
        '<span class="ti">'+(i+1)+'</span>'+
        '<span class="tt">'+fmtMs(v)+'</span>'+
        '<span class="tag '+(isWork?"work":"rest")+'">'+(isWork?"運動":"休息")+'</span>'+
        '<button class="del" aria-label="刪除">✕</button>';
      row.querySelector(".del").addEventListener("click", function(){
        TS.splice(i,1); rebuild(); syncURL(); saveConfig();
      });
      tlist.appendChild(row);
    });
  }

  function parseVideoId(s){
    s = (s||"").trim();
    if (!s) return "";
    var m = s.match(/(?:v=|\/embed\/|youtu\.be\/|\/shorts\/|\/v\/)([\w-]{11})/);
    if (m) return m[1];
    if (/^[\w-]{11}$/.test(s)) return s;
    return "";
  }

  function syncURL(){
    try{
      var u = new URL(location.href);
      u.searchParams.set("v", VIDEO);
      u.searchParams.set("t", TS.map(function(x){return Math.round(x*100)/100;}).join(","));
      history.replaceState(null, "", u.pathname + "?" + u.searchParams.toString());
    }catch(e){}
  }

  function saveConfig(){
    lsSet("yst-video", VIDEO);
    lsSet("yst-vol", String(level));
    // per-video 時間點存進 Storage（沿用專案既有資料結構）
    try{
      var existing = Storage.load(VIDEO) || {};
      Storage.save(VIDEO, {
        url: existing.url || ("https://www.youtube.com/watch?v=" + VIDEO),
        video_id: VIDEO,
        title: existing.title || "",
        beeps: TS.slice(),
        analyzed_at: existing.analyzed_at || new Date().toISOString()
      });
    }catch(e){}
    if (typeof renderHistory === "function") renderHistory();
  }

  function loadVideo(id){
    if (!id) return;
    VIDEO = id;
    // 切換影片時，載入該影片既有時間點；若無則沿用目前的
    try{
      var rec = Storage.load(VIDEO);
      if (rec && Array.isArray(rec.beeps) && rec.beeps.length >= 2) TS = rec.beeps.slice();
    }catch(e){}
    clock = 0; prevIdx = -99; lastBeepR = -1;
    started = false; setPlaying(false,false);
    startBtn.style.display = ""; startBtn.classList.remove("hidden");
    if (player && playerReady){ try{ player.cueVideoById(id); playerOk = true; }catch(e){} }
    rebuild();
    var cv = document.getElementById("curVid"); if (cv) cv.textContent = VIDEO;
    saveConfig();
    update(clock);
  }

  function setVolume(v){
    level = Math.max(0, Math.min(10, v|0));
    masterVol = VOL_CURVE[level];
    if (volRange) volRange.value = level;
    if (vlevel) vlevel.textContent = level + " / 10";
    saveConfig();
  }

  loadBtn.addEventListener("click", function(){
    var id = parseVideoId(urlInput.value);
    if (id){ loadVideo(id); syncURL(); urlInput.value=""; urlInput.placeholder="目前 ID："+VIDEO; }
    else { urlInput.value=""; urlInput.placeholder="連結無效，請再試一次"; }
  });
  urlInput.addEventListener("keydown", function(e){ if (e.key==="Enter"){ e.preventDefault(); loadBtn.click(); } });

  volRange.addEventListener("input", function(){ setVolume(parseInt(volRange.value,10)); });
  volRange.addEventListener("change", function(){ ensureAudio(); tone(880,0.1,0,"square",0.16); });
  volDown.addEventListener("click", function(){ setVolume(level-1); ensureAudio(); tone(880,0.1,0,"square",0.16); });
  volUp.addEventListener("click", function(){ setVolume(level+1); ensureAudio(); tone(880,0.1,0,"square",0.16); });

  addNow.addEventListener("click", function(){
    var t = Math.round(Math.max(0, clock)*100)/100;
    TS.push(t); rebuild(); syncURL(); saveConfig();
  });

  copyLink.addEventListener("click", function(){
    syncURL();
    var orig = copyLink.textContent;
    var done = function(){ copyLink.textContent = "已複製連結 ✓"; setTimeout(function(){ copyLink.textContent = orig; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(location.href).then(done, done); }
    else { done(); }
  });

  resetBtn.addEventListener("click", function(){
    TS = DEFAULT_TS.slice();
    setVolume(6);
    loadVideo(DEFAULT_VIDEO);
    rebuild(); syncURL(); saveConfig();
  });

  /* ---------- restore + init ---------- */
  (function restore(){
    try{
      var bp = ls("yst-beep");
      if (bp === "0"){ beepOn=false; beepBtn.setAttribute("data-on","false"); }
    }catch(e){}

    if (volRange) volRange.value = level;
    if (vlevel) vlevel.textContent = level + " / 10";

    rebuild();

    var tt = parseFloat(ls("yst-time"));
    if (!isNaN(tt) && tt > 1 && tt < T_END){ restoreTime = tt; clock = tt; }

    document.documentElement.style.setProperty("--phase", PH_LIT.ready);
    var cv = document.getElementById("curVid"); if (cv) cv.textContent = VIDEO;
    saveConfig();      // 持久化目前影片與時間點（並渲染歷史）
    update(clock);
  })();

})();
