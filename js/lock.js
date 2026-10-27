// App password. The password itself is never stored or published — only a salted
// PBKDF2-SHA256 hash, kept in this device's IndexedDB. It locks the app's screens;
// it is not encryption, and there is no recovery other than erasing and restoring a backup.

const ITERATIONS = 210000;
export const MIN_LENGTH = 4;

const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

/** Make a lock record for a new password. */
export async function createLock(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return { v: 1, salt: b64(salt), hash: b64(hash), iterations: ITERATIONS };
}

/** Constant-time check of a password against a lock record. */
export async function verifyLock(lock, password) {
  if (!lock?.salt || !lock?.hash) return false;
  const got = await derive(password, unb64(lock.salt), lock.iterations || ITERATIONS);
  const want = unb64(lock.hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}
