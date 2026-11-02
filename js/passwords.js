// Password hashing and email checks for on-device accounts. Pure (no storage) and tested.
// Passwords are never stored — only a salted PBKDF2-SHA256 hash.

const ITERATIONS = 210000;
export const MIN_PASSWORD = 6;

const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: b64(salt), hash: b64(await derive(password, salt, ITERATIONS)), iterations: ITERATIONS };
}

export async function verifyPassword(record, password) {
  if (!record?.salt || !record?.hash) return false;
  const got = await derive(password, unb64(record.salt), record.iterations || ITERATIONS);
  const want = unb64(record.hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

export const normalizeEmail = (email) => String(email ?? '').trim().toLowerCase();

export function checkEmail(email) {
  const e = normalizeEmail(email);
  if (!e) return 'Enter your email';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return 'That doesn’t look like an email address';
  return null;
}

export function checkNewPassword(pw) {
  if (!pw || pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters`;
  return null;
}
