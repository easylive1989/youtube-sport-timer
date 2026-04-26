const API = (() => {
  // Only instances with Access-Control-Allow-Origin: * (required for browser fetch)
  const PIPED_INSTANCES = [
    'https://api.piped.private.coffee',
  ];

  function extractVideoId(url) {
    const patterns = [
      /[?&]v=([A-Za-z0-9_-]{11})/,
      /youtu\.be\/([A-Za-z0-9_-]{11})/,
      /embed\/([A-Za-z0-9_-]{11})/,
    ];
    for (const pattern of patterns) {
      const m = url.match(pattern);
      if (m) return m[1];
    }
    return null;
  }

  async function getPipedStream(videoId) {
    for (const instance of PIPED_INSTANCES) {
      try {
        const resp = await fetch(`${instance}/streams/${videoId}`);
        if (!resp.ok) continue;
        const data = await resp.json();
        const streams = data.audioStreams || [];
        if (streams.length === 0) continue;
        const best = streams.sort((a, b) => b.bitrate - a.bitrate)[0];
        return { audioUrl: best.url, title: data.title || '', mimeType: best.mimeType || 'audio/webm' };
      } catch (_) {
        continue;
      }
    }
    throw new Error('無法從任何來源取得音訊串流，請稍後再試');
  }

  async function analyze(url, onProgress) {
    const videoId = extractVideoId(url);
    if (!videoId) throw new Error('請輸入有效的 YouTube 網址');

    onProgress?.('取得音訊串流...');
    const { audioUrl, title, mimeType } = await getPipedStream(videoId);

    onProgress?.('下載音訊中...');
    const audioResp = await fetch(audioUrl);
    if (!audioResp.ok) throw new Error(`音訊下載失敗 (${audioResp.status})`);
    const audioBlob = await audioResp.blob();

    onProgress?.('上傳並分析中...');
    const ext = mimeType.includes('mp4') ? 'm4a' : 'webm';
    const formData = new FormData();
    formData.append('video_id', videoId);
    formData.append('title', title);
    formData.append('audio', audioBlob, `${videoId}.${ext}`);

    const response = await fetch(`${CONFIG.API_BASE_URL}/analyze`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || `伺服器錯誤 (${response.status})`);
    }
    return response.json();
  }

  return { analyze };
})();
