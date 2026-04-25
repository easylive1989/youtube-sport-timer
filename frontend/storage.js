const Storage = (() => {
  const PREFIX = 'yst_';

  function save(videoId, data) {
    localStorage.setItem(PREFIX + videoId, JSON.stringify(data));
  }

  function load(videoId) {
    const raw = localStorage.getItem(PREFIX + videoId);
    return raw ? JSON.parse(raw) : null;
  }

  function remove(videoId) {
    localStorage.removeItem(PREFIX + videoId);
  }

  function all() {
    return Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .map((k) => JSON.parse(localStorage.getItem(k)));
  }

  return { save, load, remove, all };
})();
