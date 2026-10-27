// Minimal IndexedDB wrapper. Every write is a single transaction that resolves
// only once the browser reports it as committed (oncomplete).

const DB_NAME = 'monthly-planner';
const DB_VERSION = 1;
const STORES = ['kv', 'months', 'transactions'];

let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in self)) return reject(new Error('IndexedDB is not available in this browser.'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Future schema changes go here as `if (event.oldVersion < N)` steps — never drop stores.
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('months')) db.createObjectStore('months', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('transactions')) {
        db.createObjectStore('transactions', { keyPath: 'id' }).createIndex('monthId', 'monthId');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close(); // let a newer tab upgrade
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Close other open copies of the app and try again.'));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted'));
  });
}

export async function getAll(store) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function get(store, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Apply many puts/deletes atomically: ops = [{ store, value } | { store, delete: key }] */
export async function batch(ops) {
  if (!ops.length) return;
  const db = await openDb();
  const stores = [...new Set(ops.map((o) => o.store))];
  const tx = db.transaction(stores, 'readwrite');
  for (const op of ops) {
    const os = tx.objectStore(op.store);
    if ('delete' in op) os.delete(op.delete);
    else os.put(op.value);
  }
  return done(tx);
}

/** Replace the entire database content in one atomic transaction (used by restore). */
export async function replaceAll({ kv, months, transactions }) {
  const db = await openDb();
  const tx = db.transaction(STORES, 'readwrite');
  for (const s of STORES) tx.objectStore(s).clear();
  for (const r of kv) tx.objectStore('kv').put(r);
  for (const m of months) tx.objectStore('months').put(m);
  for (const t of transactions) tx.objectStore('transactions').put(t);
  return done(tx);
}
