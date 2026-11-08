// On-device profiles. Each profile has its own data database on this iPhone.
// A profile can be linked to a Google account (sign in once, stay signed in until you log out)
// and can be locked with Face ID. No passwords; your data is never sent anywhere.

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
 * The profile to open: the one in use, else (when no profile uses Google) the only profile or
 * a new one. Returns null when the person must choose or sign in with Google — after logging
 * out of a Google profile, or when several profiles exist.
 */
export async function startSession() {
  const cur = await currentUser();
  if (cur) return cur;
  const users = await allUsers();
  if (users.some((u) => u.googleSub)) return null;
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

/** A display name for a profile: its Google name, the part of its email before @, or “This iPhone”. */
export const profileName = (u) => u?.name || (u?.email ? u.email.split('@')[0] : 'This iPhone');

export async function updateUser(id, patch) {
  const u = (await allUsers()).find((x) => x.id === id);
  if (!u) throw new Error('That profile no longer exists.');
  const next = { ...u, ...patch };
  await putUser(next);
  return next;
}

const googleFields = (c) => ({ googleSub: c.sub, email: String(c.email).toLowerCase(), name: c.name || c.given_name || '' });

/**
 * After Google confirmed who you are: open the profile linked to this Google account; else adopt a
 * profile created earlier with the same email; else create one (its own, empty data).
 */
export async function signInWithGoogle(claims) {
  const users = await allUsers();
  const email = String(claims.email).toLowerCase();
  let user = users.find((u) => u.googleSub === claims.sub)
    || users.find((u) => !u.googleSub && u.email && u.email.toLowerCase() === email);
  if (user) user = { ...user, ...googleFields(claims) };
  else {
    const id = newId();
    user = { id, createdAt: new Date().toISOString(), dataDb: users.some((u) => u.dataDb === FIRST_DATA_DB) ? `monthly-planner-${id}` : FIRST_DATA_DB, ...googleFields(claims) };
  }
  await putUser(user);
  await setSession(user.id);
  return user;
}

/** Link a Google account to `profileId`. If another profile already uses it, open that one instead. */
export async function linkGoogle(profileId, claims) {
  const users = await allUsers();
  const other = users.find((u) => u.googleSub === claims.sub && u.id !== profileId);
  if (other) { await setSession(other.id); return { user: other, switched: true }; }
  const user = await updateUser(profileId, googleFields(claims));
  await setSession(user.id);
  return { user, switched: false };
}

export const logOut = () => setSession(null);
