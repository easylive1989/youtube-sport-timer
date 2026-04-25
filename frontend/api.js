const API = (() => {
  async function analyze(url) {
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
