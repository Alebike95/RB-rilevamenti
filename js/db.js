// Salvataggio locale (IndexedDB). Tutto resta sul dispositivo finche' non si preme Reset.

const DB_NAME = 'rb-rilevamenti';
const DB_VER = 2; // v2: archivio note vocali
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('points')) db.createObjectStore('points', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('track')) db.createObjectStore('track', { autoIncrement: true });
      if (!db.objectStoreNames.contains('voices')) db.createObjectStore('voices', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    const r = fn(s);
    if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const db = {
  get: (store, key) => tx(store, 'readonly', (s) => s.get(key)),
  put: (store, val, key) => tx(store, 'readwrite', (s) => (key === undefined ? s.put(val) : s.put(val, key))),
  del: (store, key) => tx(store, 'readwrite', (s) => s.delete(key)),
  all: (store) => tx(store, 'readonly', (s) => s.getAll()),
  clear: (store) => tx(store, 'readwrite', (s) => s.clear()),
  // aggiunge molti punti traccia in una sola transazione
  addMany: (store, vals) => tx(store, 'readwrite', (s) => { for (const v of vals) s.add(v); }),
  async clearAll() {
    for (const s of ['kv', 'points', 'photos', 'track', 'voices']) await this.clear(s);
  }
};

export async function askPersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const already = await navigator.storage.persisted();
      return already || (await navigator.storage.persist());
    }
  } catch (e) { /* ignora */ }
  return false;
}

export async function storageInfo() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      return { usedMB: (e.usage || 0) / 1048576, quotaMB: (e.quota || 0) / 1048576 };
    }
  } catch (e) { /* ignora */ }
  return null;
}
