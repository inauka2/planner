// On-device profiles, no passwords. Each profile has its own data database on this iPhone.
// The app opens straight into the last-used profile; nothing is sent anywhere.

const AUTH_DB = 'planner-auth';
const FIRST_DATA_DB = 'monthly-planner'; // the first profile adopts data saved before profiles existed
const SESSION_KEY = 'planner.session'; // mirror of the session in localStorage

let authDb = null;
function open() {
  if (authDb) return authDb;
  authDb = new Promise((resolve, reject) => {
    const req = indexedDB.open(AUTH_DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('users', { keyPath: 'id' });
      req.result.createObjectStore('kv', { keyPath: 'key' });
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => { req.result.close(); authDb = null; }; // let upgrades/deletes through
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
  authDb.catch(() => { authDb = null; });
  return authDb;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

/** All profiles on this iPhone, oldest first. */
export const allUsers = async () => (await run('users', 'readonly', (s) => s.getAll()))
  .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
const putUser = (u) => run('users', 'readwrite', (s) => s.put(u));

async function setSession(userId) {
  try {
    if (userId) localStorage.setItem(SESSION_KEY, userId);
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* private mode */ }
  await run('kv', 'readwrite', (s) => (userId ? s.put({ key: 'session', userId }) : s.delete('session')));
}

/** The profile in use, or null. */
export async function currentUser() {
  let id = (await run('kv', 'readonly', (s) => s.get('session')))?.userId;
  if (!id) { try { id = localStorage.getItem(SESSION_KEY); } catch { /* ignore */ } }
  if (!id) return null;
  return (await allUsers()).find((u) => u.id === id) || null;
}

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

/**
 * Open without a password: the profile in use, else the only profile, else a new one.
 * Returns null only when several profiles exist and none is in use, so the person can pick.
 */
export async function startSession() {
  const cur = await currentUser();
  if (cur) return cur;
  const users = await allUsers();
  if (users.length === 1) { await setSession(users[0].id); return users[0]; }
  if (users.length > 1) return null;
  const user = { id: newId(), email: '', createdAt: new Date().toISOString(), dataDb: FIRST_DATA_DB };
  await putUser(user);
  await setSession(user.id);
  return user;
}

export async function useProfile(id) {
  const user = (await allUsers()).find((u) => u.id === id);
  if (!user) throw new Error('That profile no longer exists.');
  await setSession(user.id);
  return user;
}

/** A display name for a profile: the part of its email before @, or “This iPhone”. */
export const profileName = (u) => (u?.email ? u.email.split('@')[0] : 'This iPhone');
