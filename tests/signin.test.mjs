// Google ID-token checks and Face ID (WebAuthn) assertion checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyIdToken, b64url, unb64url } from '../js/google.js';
import { checkAssertion, derToRaw } from '../js/faceid.js';

const { subtle } = globalThis.crypto;
const enc = new TextEncoder();
const CLIENT = 'test-client.apps.googleusercontent.com';

async function googleKeyPair() {
  const pair = await subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = await subtle.exportKey('jwk', pair.publicKey);
  return { pair, jwk: { ...jwk, kid: 'k1' } };
}

async function makeToken(privateKey, claims, header = { alg: 'RS256', kid: 'k1', typ: 'JWT' }) {
  const h = b64url(enc.encode(JSON.stringify(header)));
  const p = b64url(enc.encode(JSON.stringify(claims)));
  const sig = await subtle.sign('RSASSA-PKCS1-v1_5', privateKey, enc.encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(sig)}`;
}

const now = Date.UTC(2026, 10, 8, 12);
const good = { iss: 'https://accounts.google.com', aud: CLIENT, sub: '1234', email: 'me@gmail.com', email_verified: true, nonce: 'n1', exp: now / 1000 + 3600, name: 'Me' };

test('google: base64url round trip', () => {
  const bytes = new Uint8Array([0, 251, 255, 62, 63, 1]);
  assert.deepEqual([...unb64url(b64url(bytes))], [...bytes]);
});

test('google: a valid ID token is accepted and returns its claims', async () => {
  const { pair, jwk } = await googleKeyPair();
  const token = await makeToken(pair.privateKey, good);
  const claims = await verifyIdToken(token, { clientId: CLIENT, nonce: 'n1', keys: [jwk], now });
  assert.equal(claims.email, 'me@gmail.com');
  assert.equal(claims.sub, '1234');
});

test('google: bad signature, other app, wrong nonce, expired or unverified email are rejected', async () => {
  const { pair, jwk } = await googleKeyPair();
  const other = await googleKeyPair();
  const check = async (claims, opts = {}, key = pair.privateKey) => verifyIdToken(await makeToken(key, claims), { clientId: CLIENT, nonce: 'n1', keys: [jwk], now, ...opts });
  await assert.rejects(check(good, {}, other.pair.privateKey), /verified/);
  await assert.rejects(check({ ...good, aud: 'someone-else' }), /another app/);
  await assert.rejects(check(good, { nonce: 'n2' }), /didn’t match/);
  await assert.rejects(check({ ...good, exp: now / 1000 - 3600 }), /expired/);
  await assert.rejects(check({ ...good, iss: 'https://evil.example' }), /Google/);
  await assert.rejects(check({ ...good, email_verified: false }), /isn’t verified/);
  await assert.rejects(verifyIdToken('not.a-token', { clientId: CLIENT, nonce: 'n1', keys: [jwk], now }), /unreadable/);
});

test('google: a tampered payload fails the signature check', async () => {
  const { pair, jwk } = await googleKeyPair();
  const token = await makeToken(pair.privateKey, good);
  const [h, , s] = token.split('.');
  const forged = `${h}.${b64url(enc.encode(JSON.stringify({ ...good, email: 'attacker@gmail.com' })))}.${s}`;
  await assert.rejects(verifyIdToken(forged, { clientId: CLIENT, nonce: 'n1', keys: [jwk], now }), /verified/);
});

// ---------- Face ID (WebAuthn assertion) ----------
function rawToDer(raw) {
  const int = (b) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    let v = b.slice(i);
    if (v[0] & 0x80) v = Uint8Array.from([0, ...v]);
    return Uint8Array.from([0x02, v.length, ...v]);
  };
  const r = int(raw.slice(0, 32));
  const s = int(raw.slice(32));
  return Uint8Array.from([0x30, r.length + s.length, ...r, ...s]);
}

async function passkey() {
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const spki = new Uint8Array(await subtle.exportKey('spki', pair.publicKey));
  return { pair, record: { credId: 'cred', publicKey: b64url(spki), alg: -7 } };
}

async function assertion(pair, { challenge, origin = 'https://inauka2.github.io', flags = 0x05, type = 'webauthn.get' }) {
  const clientDataJSON = enc.encode(JSON.stringify({ type, challenge: b64url(challenge), origin }));
  const authenticatorData = new Uint8Array(37);
  authenticatorData[32] = flags;
  const data = new Uint8Array(37 + 32);
  data.set(authenticatorData);
  data.set(new Uint8Array(await subtle.digest('SHA-256', clientDataJSON)), 37);
  const raw = new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, data));
  return { clientDataJSON, authenticatorData, signature: rawToDer(raw) };
}

test('face id: DER signatures convert to raw r‖s', () => {
  const raw = new Uint8Array(64).map((_, i) => (i === 0 || i === 32 ? 0x80 + i : i + 1));
  assert.deepEqual([...derToRaw(rawToDer(raw))], [...raw]);
  assert.equal(derToRaw(new Uint8Array([1, 2, 3])), null);
});

test('face id: a genuine unlock passes; wrong challenge, origin, flags or key fail', async () => {
  const { pair, record } = await passkey();
  const other = await passkey();
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const origin = 'https://inauka2.github.io';
  const ok = await assertion(pair, { challenge });
  assert.equal(await checkAssertion({ record, challenge, origin, ...ok }), true);

  const otherChallenge = crypto.getRandomValues(new Uint8Array(32));
  assert.equal(await checkAssertion({ record, challenge: otherChallenge, origin, ...ok }), false);
  assert.equal(await checkAssertion({ record, challenge, origin: 'https://evil.example', ...ok }), false);
  const notVerified = await assertion(pair, { challenge, flags: 0x01 }); // present but no Face ID
  assert.equal(await checkAssertion({ record, challenge, origin, ...notVerified }), false);
  const wrongType = await assertion(pair, { challenge, type: 'webauthn.create' });
  assert.equal(await checkAssertion({ record, challenge, origin, ...wrongType }), false);
  const byOtherKey = await assertion(other.pair, { challenge });
  assert.equal(await checkAssertion({ record, challenge, origin, ...byOtherKey }), false);
});
