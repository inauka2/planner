// Sign in with Google, without a server: the page sends you to Google's own sign-in page, Google
// sends you back with a signed ID token in the address (#id_token=…), and the app checks that
// token's signature against Google's published keys before trusting the email in it.
// Only your Google account's id, email and name are read. Nothing about your money leaves the device.
import { GOOGLE_CLIENT_ID } from './config.js';

const PENDING_KEY = 'planner.google'; // { state, nonce, intent, profileId, at } while away at Google
const KEYS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export const googleEnabled = () => !!GOOGLE_CLIENT_ID;

const enc = new TextEncoder();
const randomId = () => b64url(crypto.getRandomValues(new Uint8Array(24)));

export function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64url(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** The address Google returns to: this page, without the #… part. Must be registered in Google Cloud. */
export const redirectUri = () => `${location.origin}${location.pathname}`;

/**
 * Leave for Google's sign-in page. `intent`: 'signin' (open the matching profile) or
 * 'link' (attach the Google account to `profileId`).
 */
export function startGoogleSignIn({ intent = 'signin', profileId = null } = {}) {
  if (!googleEnabled()) throw new Error('Google sign-in isn’t set up in this app yet.');
  const pending = { state: randomId(), nonce: randomId(), intent, profileId, at: Date.now() };
  localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  const q = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'id_token',
    scope: 'openid email profile',
    nonce: pending.nonce,
    state: pending.state,
    prompt: 'select_account',
  });
  location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
}

/**
 * On start-up: if Google just sent us back, check the answer and return
 * { claims, intent, profileId } or { error }. Returns null when this isn't a return from Google.
 * Always removes the token from the address bar.
 */
export async function readGoogleReturn() {
  const raw = location.hash.replace(/^#/, '');
  if (!/(^|&)(id_token|error)=/.test(raw) || !/(^|&)state=/.test(raw)) return null;
  const params = new URLSearchParams(raw);
  history.replaceState(null, '', `${location.pathname}#/accounts`);
  let pending = null;
  try { pending = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); } catch { /* ignore */ }
  localStorage.removeItem(PENDING_KEY);
  if (!pending || params.get('state') !== pending.state) return { error: 'The Google sign-in didn’t match this app. Please try again.' };
  if (Date.now() - pending.at > 15 * 60 * 1000) return { error: 'The Google sign-in took too long. Please try again.' };
  if (params.get('error')) return { error: params.get('error') === 'access_denied' ? 'Google sign-in was cancelled.' : `Google sign-in failed (${params.get('error')}).` };
  try {
    const keys = await fetchGoogleKeys();
    const claims = await verifyIdToken(params.get('id_token') || '', { clientId: GOOGLE_CLIENT_ID, nonce: pending.nonce, keys });
    return { claims, intent: pending.intent, profileId: pending.profileId };
  } catch (e) {
    return { error: e.message };
  }
}

async function fetchGoogleKeys() {
  let res;
  try { res = await fetch(KEYS_URL, { cache: 'no-store' }); } catch { throw new Error('Signing in with Google needs an internet connection.'); }
  if (!res.ok) throw new Error('Couldn’t reach Google to check the sign-in. Please try again.');
  return (await res.json()).keys || [];
}

/**
 * Check a Google ID token (RS256 JWT) and return its claims: signature by one of `keys`
 * (Google's JWKs), issuer, audience = our client id, not expired, our nonce, verified email.
 * Throws an Error with a readable message otherwise.
 */
export async function verifyIdToken(token, { clientId, nonce, keys, now = Date.now() }) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Google sent an unreadable sign-in.');
  let header;
  let claims;
  try {
    header = JSON.parse(new TextDecoder().decode(unb64url(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(unb64url(parts[1])));
  } catch { throw new Error('Google sent an unreadable sign-in.'); }
  if (header.alg !== 'RS256') throw new Error('Unexpected sign-in format.');
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('Couldn’t check the Google sign-in. Please try again.');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64url(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new Error('The Google sign-in couldn’t be verified.');
  if (!ISSUERS.includes(claims.iss)) throw new Error('The sign-in didn’t come from Google.');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId)) throw new Error('The Google sign-in was meant for another app.');
  if (!claims.exp || claims.exp * 1000 < now - 60_000) throw new Error('The Google sign-in has expired. Please try again.');
  if (claims.nonce !== nonce) throw new Error('The Google sign-in didn’t match this request. Please try again.');
  if (!claims.sub || !claims.email) throw new Error('Google didn’t share your email address.');
  if (claims.email_verified === false) throw new Error('Your Google email address isn’t verified.');
  return claims;
}
