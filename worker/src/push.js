/**
 * Web Push delivery (VAPID + RFC 8291 `aes128gcm`).
 *
 * Implemented directly on WebCrypto so the Worker needs no dependencies:
 *   - an ES256 VAPID JWT signs every request,
 *   - the payload is encrypted with ECDH + HKDF + AES-128-GCM.
 *
 * The VAPID key pair is generated on first use and stored in `settings`, so a
 * fresh deployment needs no extra setup. `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`
 * (base64url, uncompressed P-256 point + raw scalar) override the stored pair.
 */
import { deletePushSubscription, getSettings, listPushSubscriptions, saveSettings } from './db.js';

const encoder = new TextEncoder();
const RECORD_SIZE = 4096;
const JWT_LIFETIME = 12 * 60 * 60;

/* ---------------------------------------------------------------- base64url */

export function b64urlToBytes(value) {
  const normalized = String(value ?? '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToB64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/* --------------------------------------------------------------------- hkdf */

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

/* -------------------------------------------------------------------- vapid */

/** A stored key pair is one raw public point plus one raw private scalar. */
function keysFromRaw(publicKey, privateKey) {
  const point = b64urlToBytes(publicKey);
  if (point.length !== 65 || point[0] !== 4) throw new Error('VAPID 公钥格式不正确');
  return {
    publicKey,
    privateKey,
    jwk: {
      kty: 'EC',
      crv: 'P-256',
      x: bytesToB64url(point.slice(1, 33)),
      y: bytesToB64url(point.slice(33, 65)),
      d: privateKey,
    },
  };
}

async function generateVapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicPoint = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { publicKey: bytesToB64url(publicPoint), privateKey: jwk.d };
}

function envValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** The key pair used to sign pushes; generated and persisted on first use. */
export async function getVapidKeys(db, env = {}) {
  const publicKey = envValue(env.VAPID_PUBLIC_KEY);
  const privateKey = envValue(env.VAPID_PRIVATE_KEY);
  if (publicKey && privateKey) return keysFromRaw(publicKey, privateKey);

  const settings = await getSettings(db);
  if (settings.vapidPublicKey && settings.vapidPrivateKey) {
    return keysFromRaw(settings.vapidPublicKey, settings.vapidPrivateKey);
  }

  const generated = await generateVapidKeys();
  await saveSettings(db, { vapidPublicKey: generated.publicKey, vapidPrivateKey: generated.privateKey });
  return keysFromRaw(generated.publicKey, generated.privateKey);
}

async function vapidAuthorization(endpoint, keys, subject) {
  const header = bytesToB64url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = bytesToB64url(
    encoder.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(Date.now() / 1000) + JWT_LIFETIME,
        sub: subject,
      }),
    ),
  );
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey('jwk', keys.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(signingInput)),
  );
  return `vapid t=${signingInput}.${bytesToB64url(signature)},k=${keys.publicKey}`;
}

/* ---------------------------------------------------------------- encryption */

/** One `aes128gcm` record: header ‖ AES-128-GCM(plaintext ‖ 0x02). */
export async function encryptPayload(payload, p256dh, authSecretB64) {
  const uaPublic = b64urlToBytes(p256dh);
  const authSecret = b64urlToBytes(authSecretB64);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('订阅公钥格式不正确');
  if (authSecret.length !== 16) throw new Error('订阅 auth 密钥格式不正确');

  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256),
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const ikm = await hkdf(
    authSecret,
    sharedSecret,
    concat(encoder.encode('WebPush: info\0'), uaPublic, asPublic),
    32,
  );
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, concat(payload, new Uint8Array([2]))),
  );

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, RECORD_SIZE);
  return concat(salt, recordSize, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

/* ------------------------------------------------------------------ delivery */

/** Kept well under the 4 KB record limit every push service enforces. */
function payloadFor(message, extra = {}) {
  return encoder.encode(
    JSON.stringify({
      title: String(message.title ?? '订阅提醒').slice(0, 120),
      body: String(message.body ?? '').slice(0, 800),
      url: extra.url ?? '/reminders',
      tag: extra.tag ?? 'subtrack-reminder',
      dueDate: message.dueDate ?? null,
      daysLeft: message.daysLeft ?? null,
    }),
  );
}

/**
 * Pushes one message to every registered browser.
 *
 * Expired endpoints (404/410) are pruned as we go. Returns a summary rather
 * than throwing so the reminder engine can record a non-fatal failure.
 */
export async function sendPush(db, settings, message, { env = {}, url, tag } = {}) {
  const subscriptions = await listPushSubscriptions(db);
  if (!subscriptions.length) return { delivered: 0, total: 0, error: '还没有设备订阅浏览器推送' };

  const keys = await getVapidKeys(db, env);
  const subject = envValue(env.VAPID_SUBJECT) || 'mailto:admin@subtrack.local';
  const payload = payloadFor(message, { url, tag });

  let delivered = 0;
  const errors = [];

  for (const subscription of subscriptions) {
    try {
      const body = await encryptPayload(payload, subscription.p256dh, subscription.auth);
      const response = await fetch(subscription.endpoint, {
        method: 'POST',
        headers: {
          authorization: await vapidAuthorization(subscription.endpoint, keys, subject),
          'content-encoding': 'aes128gcm',
          'content-type': 'application/octet-stream',
          ttl: '86400',
          urgency: 'normal',
        },
        body,
      });
      if (response.status === 404 || response.status === 410) {
        await deletePushSubscription(db, subscription.endpoint);
        errors.push(`已清理失效设备（${response.status}）`);
        continue;
      }
      if (!response.ok) {
        errors.push(`推送服务返回 ${response.status}`);
        continue;
      }
      delivered += 1;
    } catch (error) {
      errors.push(String(error?.message ?? error).slice(0, 120));
    }
  }

  return {
    delivered,
    total: subscriptions.length,
    error: delivered === 0 ? errors[0] ?? '推送失败' : null,
  };
}
