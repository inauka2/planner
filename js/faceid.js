// Unlock with Face ID: a passkey made on this iPhone (WebAuthn, platform authenticator).
// Turning it on creates the passkey (Face ID prompt); opening the app asks for it again.
// iOS falls back to your iPhone passcode if Face ID fails. The passkey's public key is kept
// with the profile and every unlock's signature is checked against it here.
import { b64url, unb64url } from './google.js';

const enc = new TextEncoder();

/** True when this device can do Face ID / Touch ID (or its passcode) for web apps. */
export async function faceIdAvailable() {
  try {
    return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch { return false; }
}

/** Create the passkey for `profile`. Returns the record to store: { credId, publicKey, alg, createdAt }. */
export async function enrollFaceId(profile) {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Planner' },
      user: { id: enc.encode(profile.id).slice(0, 64), name: profile.email || 'planner', displayName: profile.email || 'Planner' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000,
      attestation: 'none',
    },
  });
  if (!cred) throw new Error('Face ID wasn’t set up.');
  const r = cred.response;
  const spki = typeof r.getPublicKey === 'function' ? r.getPublicKey() : null;
  const alg = typeof r.getPublicKeyAlgorithm === 'function' ? r.getPublicKeyAlgorithm() : -7;
  return { credId: b64url(cred.rawId), publicKey: spki ? b64url(spki) : null, alg, createdAt: new Date().toISOString() };
}

/** Ask for Face ID. Resolves true when it succeeds; throws a readable error otherwise. */
export async function unlockWithFaceId(record) {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  let cred;
  try {
    cred = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ type: 'public-key', id: unb64url(record.credId), transports: ['internal', 'hybrid'] }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
  } catch (e) {
    if (e?.name === 'NotAllowedError') throw new Error('Face ID was cancelled or didn’t match.');
    throw new Error(`Face ID isn’t available: ${e?.message || e}`);
  }
  if (!cred) throw new Error('Face ID was cancelled.');
  const r = cred.response;
  const ok = await checkAssertion({
    record, challenge, origin: location.origin,
    clientDataJSON: new Uint8Array(r.clientDataJSON), authenticatorData: new Uint8Array(r.authenticatorData), signature: new Uint8Array(r.signature),
  });
  if (!ok) throw new Error('Face ID couldn’t be verified.');
  return true;
}

/**
 * Check a WebAuthn assertion: our challenge and origin, user present + verified flags, and
 * (when the public key is known) the signature over authenticatorData ‖ SHA-256(clientDataJSON).
 */
export async function checkAssertion({ record, challenge, origin, clientDataJSON, authenticatorData, signature }) {
  let client;
  try { client = JSON.parse(new TextDecoder().decode(clientDataJSON)); } catch { return false; }
  if (client.type !== 'webauthn.get' || client.challenge !== b64url(challenge) || client.origin !== origin) return false;
  const flags = authenticatorData[32];
  if (!(flags & 0x01) || !(flags & 0x04)) return false; // user present, user verified
  if (!record.publicKey) return true; // older iOS without getPublicKey(): rely on the checks above
  const data = new Uint8Array(authenticatorData.length + 32);
  data.set(authenticatorData, 0);
  data.set(new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSON)), authenticatorData.length);
  const spki = unb64url(record.publicKey);
  if (record.alg === -257) {
    const key = await crypto.subtle.importKey('spki', spki, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data);
  }
  const key = await crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const raw = derToRaw(signature);
  return !!raw && crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, raw, data);
}

/** ECDSA signatures from authenticators are DER (SEQUENCE of two INTEGERs); WebCrypto wants r ‖ s (64 bytes). */
export function derToRaw(der) {
  if (der[0] !== 0x30) return null;
  let i = 2;
  const out = new Uint8Array(64);
  for (let n = 0; n < 2; n++) {
    if (der[i] !== 0x02) return null;
    let len = der[i + 1];
    let start = i + 2;
    while (len > 32 && der[start] === 0) { start++; len--; }
    if (len > 32) return null;
    out.set(der.slice(start, start + len), n * 32 + (32 - len));
    i = i + 2 + der[i + 1];
  }
  return out;
}
