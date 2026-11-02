// On-device accounts. Each account (email + password) has its own data database on this
// iPhone. Signing in once keeps you signed in until you log out. Nothing is sent anywhere.
import { hashPassword, verifyPassword, normalizeEmail, checkEmail, checkNewPassword } from './passwords.js';

const AUTH_DB = 'planner-auth';
const FIRST_DATA_DB = 'monthly-planner'; // the first account adopts data saved before accounts existed
const SESSION_KEY = 'planner.session'; // mirror of the session, so sign-in really happens only once

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

const allUsers = () => run('users', 'readonly', (s) => s.getAll());
const putUser = (u) => run('users', 'readwrite', (s) => s.put(u));
const findUser = async (email) => (await allUsers()).find((u) => u.email === normalizeEmail(email));

async function setSession(userId) {
  try {
    if (userId) localStorage.setItem(SESSION_KEY, userId);
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* private mode */ }
  await run('kv', 'readwrite', (s) => (userId ? s.put({ key: 'session', userId }) : s.delete('session')));
}

/** The signed-in account, or null. */
export async function currentUser() {
  let id = (await run('kv', 'readonly', (s) => s.get('session')))?.userId;
  if (!id) { try { id = localStorage.getItem(SESSION_KEY); } catch { /* ignore */ } }
  if (!id) return null;
  return (await allUsers()).find((u) => u.id === id) || null;
}

export async function hasAccounts() {
  return (await allUsers()).length > 0;
}

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export async function signUp(email, password) {
  const err = checkEmail(email) || checkNewPassword(password);
  if (err) throw new Error(err);
  if (await findUser(email)) throw new Error('An account with this email already exists on this iPhone. Sign in instead.');
  const users = await allUsers();
  const id = newId();
  const user = {
    id, email: normalizeEmail(email), createdAt: new Date().toISOString(),
    dataDb: users.some((u) => u.dataDb === FIRST_DATA_DB) ? `monthly-planner-${id}` : FIRST_DATA_DB,
    ...(await hashPassword(password)),
  };
  await putUser(user);
  await setSession(id);
  return user;
}

export async function signIn(email, password) {
  const err = checkEmail(email);
  if (err) throw new Error(err);
  const user = await findUser(email);
  if (!user) throw new Error('No account with this email on this iPhone.');
  if (!(await verifyPassword(user, password))) throw new Error('Wrong password.');
  await setSession(user.id);
  return user;
}

/**
 * The account lives only on this iPhone, so there is no email to send a reset link from.
 * Knowing the account's email is enough to choose a new password — your data is never locked away.
 */
export async function resetPassword(email, password) {
  const err = checkEmail(email) || checkNewPassword(password);
  if (err) throw new Error(err);
  const user = await findUser(email);
  if (!user) throw new Error('No account with this email on this iPhone.');
  await putUser({ ...user, ...(await hashPassword(password)) });
  await setSession(user.id);
  return user;
}

export async function changePassword(user, current, next) {
  if (!(await verifyPassword(user, current))) throw new Error('That’s not your current password.');
  const err = checkNewPassword(next);
  if (err) throw new Error(err);
  await putUser({ ...user, ...(await hashPassword(next)) });
}

export const logOut = () => setSession(null);
