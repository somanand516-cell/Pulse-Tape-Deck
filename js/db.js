/* Storage helpers: IndexedDB for files, tag cache and folder handles; localStorage for small state. */
const DB = (() => {
  const NAME = 'pulse-player', VERSION = 1;
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let result;
      const r = fn(s);
      if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  const local = {
    get(key, fallback) {
      try { const v = localStorage.getItem('pulse.' + key); return v == null ? fallback : JSON.parse(v); }
      catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('pulse.' + key, JSON.stringify(value)); } catch { /* quota or private mode */ }
    },
  };

  return {
    local,
    put: (store, value) => tx(store, 'readwrite', s => s.put(value)).catch(e => console.warn('db put', e)),
    get: (store, key) => tx(store, 'readonly', s => s.get(key)).catch(() => undefined),
    del: (store, key) => tx(store, 'readwrite', s => s.delete(key)).catch(() => {}),
    all: (store) => tx(store, 'readonly', s => s.getAll()).catch(() => []),
    clear: (store) => tx(store, 'readwrite', s => s.clear()).catch(() => {}),
  };
})();
