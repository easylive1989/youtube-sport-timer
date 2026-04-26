const API = (() => {
  async function analyze(url, onProgress) {
    if (!url) throw new Error('請輸入有效的 YouTube 網址');

    onProgress?.('分析中...');
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
