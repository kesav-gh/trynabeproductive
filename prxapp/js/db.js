/*
  Minimal IndexedDB wrapper. No external libraries -- keeps the PWA
  100% offline-installable with nothing to fetch from a CDN at runtime.
  Schema (object stores, all keyed by auto-increment "id"):
    plans        { id, name, isActive }
    planDays     { id, planId, weekday (0-6, 0=Sun), label }
    exercises    { id, planDayId, name, targetReps, targetSets }
    logEntries   { id, exerciseId, date (YYYY-MM-DD), reps, sets, weight, isPR, ts }
    profileStore { id: 1 (singleton), weight, height, age, gender, activityLevel }
    streakState  -- legacy, unused since the rolling-window engine replaced it. Left
                    in place so opening an old DB doesn't error; nothing reads/writes it.
*/

const DB_NAME = 'pr-logger';
const DB_VERSION = 2;
let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('plans')) {
        db.createObjectStore('plans', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('planDays')) {
        const s = db.createObjectStore('planDays', { keyPath: 'id', autoIncrement: true });
        s.createIndex('planId', 'planId');
        s.createIndex('weekday', 'weekday');
      }
      if (!db.objectStoreNames.contains('exercises')) {
        const s = db.createObjectStore('exercises', { keyPath: 'id', autoIncrement: true });
        s.createIndex('planDayId', 'planDayId');
      }
      if (!db.objectStoreNames.contains('logEntries')) {
        const s = db.createObjectStore('logEntries', { keyPath: 'id', autoIncrement: true });
        s.createIndex('exerciseId', 'exerciseId');
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('streakState')) {
        db.createObjectStore('streakState', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('profileStore')) {
        db.createObjectStore('profileStore', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(storeName, mode) {
  return openDB().then(db => db.transaction(storeName, mode).objectStore(storeName));
}

const DB = {
  add(store, value) {
    return tx(store, 'readwrite').then(s => new Promise((res, rej) => {
      const r = s.add(value);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
  },
  put(store, value) {
    return tx(store, 'readwrite').then(s => new Promise((res, rej) => {
      const r = s.put(value);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
  },
  get(store, key) {
    return tx(store, 'readonly').then(s => new Promise((res, rej) => {
      const r = s.get(key);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
  },
  getAll(store) {
    return tx(store, 'readonly').then(s => new Promise((res, rej) => {
      const r = s.getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
  },
  getAllByIndex(store, indexName, value) {
    return tx(store, 'readonly').then(s => new Promise((res, rej) => {
      const r = s.index(indexName).getAll(value);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
  },
  delete(store, key) {
    return tx(store, 'readwrite').then(s => new Promise((res, rej) => {
      const r = s.delete(key);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    }));
  }
};
