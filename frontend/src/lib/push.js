/**
 * Browser-side Web Push.
 *
 * Push needs *two* things switched on: the `channelPushEnabled` setting (does
 * the server push at all) and a per-device subscription created here, which
 * requires the visitor's permission. Everything is best-effort: unsupported
 * browsers simply report that they cannot subscribe.
 */
import { registerServiceWorker, serviceWorkerSupported } from './pwa.js';

export function pushSupported() {
  if (typeof window === 'undefined') return false;
  if (window.isSecureContext === false) return false;
  if (typeof window.Notification === 'undefined') return false;
  if (!serviceWorkerSupported()) return false;
  return 'PushManager' in window;
}

export function notificationPermission() {
  if (typeof window === 'undefined' || typeof window.Notification === 'undefined') return 'unsupported';
  return window.Notification.permission;
}

/** The subscription this browser already has (if any). */
export async function currentSubscription() {
  if (!pushSupported()) return null;
  try {
    const registration = await registerServiceWorker();
    if (!registration?.pushManager) return null;
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * `PushManager.subscribe()` has no timeout of its own: when the browser has no
 * reachable push service (a Chromium build without one, a proxy that eats the
 * request) the promise simply never settles. Racing it keeps the settings sheet
 * from sitting on "保存中…" forever.
 */
const SUBSCRIBE_TIMEOUT = 15000;

function withTimeout(promise, ms, message) {
  // The loser of the race must not surface as an unhandled rejection.
  promise.catch(() => {});
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function sameKey(a, b) {
  return Boolean(a) && a.length === b.length && a.every((byte, index) => byte === b[index]);
}

/**
 * `PushManager` reports raw DOMExceptions, which say nothing useful to a user:
 * "Registration failed - push service error", for example, usually means the
 * browser has no push service at all.
 */
const PUSH_ERROR_HINTS = [
  [/push service/i, '当前浏览器没有可用的推送服务。请改用 Chrome / Edge / Firefox / Safari；iOS 需先将应用添加到主屏幕。'],
  [/permission|denied|notallowed/i, '浏览器拒绝了通知权限，请在站点设置中允许通知后重试。'],
  [/insecure|secure context|not allowed/i, '浏览器推送需要 HTTPS（localhost 除外），请用 HTTPS 地址打开。'],
  [/service worker|no active registration/i, 'Service Worker 尚未就绪，刷新页面后重试。'],
];

export function describePushError(error) {
  const message = String(error?.message ?? error ?? '').trim();
  for (const [pattern, hint] of PUSH_ERROR_HINTS) {
    if (pattern.test(message)) return hint;
  }
  return message || '浏览器推送开启失败，请稍后重试。';
}

/** `applicationServerKey` wants raw bytes, the key arrives base64url-encoded. */
export function applicationServerKey(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

/**
 * Asks for permission (if needed) and registers this browser with the service.
 *
 * Resolves to `{ subscription, replacedEndpoint }`; the second entry is set when
 * an existing subscription had to be dropped because the server's VAPID key
 * changed (fresh D1, rotated env vars) — the caller should delete it server-side
 * too, otherwise the device count lies.
 */
export async function subscribe(publicKey) {
  if (!publicKey) throw new Error('服务端还没有生成推送密钥，请稍后再试');
  const permission = await window.Notification.requestPermission();
  if (permission !== 'granted') throw new Error('浏览器没有授予通知权限，请在站点设置里允许通知');

  const keyBytes = applicationServerKey(publicKey);
  const registration = await registerServiceWorker();
  if (!registration?.pushManager) throw new Error('Service Worker 没有就绪，刷新页面后重试');

  const existing = await registration.pushManager.getSubscription();
  let replacedEndpoint = null;
  if (existing) {
    // A subscription is bound to the key that created it.
    const current = existing.options?.applicationServerKey;
    if (!current || sameKey(new Uint8Array(current), keyBytes)) {
      return { subscription: existing, replacedEndpoint: null };
    }
    replacedEndpoint = existing.endpoint;
    await existing.unsubscribe();
  }

  const subscription = await withTimeout(
    registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes }),
    SUBSCRIBE_TIMEOUT,
    'Registration failed - push service error（推送服务 15 秒无响应）',
  );
  return { subscription, replacedEndpoint };
}

/** Drops this browser's subscription; returns the endpoint that was removed. */
export async function unsubscribe() {
  const existing = await currentSubscription();
  if (!existing) return null;
  const { endpoint } = existing;
  try {
    await withTimeout(existing.unsubscribe(), 8000, 'Registration failed - push service error（取消订阅无响应）');
  } catch {
    /* The server row is deleted either way; a dead endpoint is pruned on the
       next push. Never block the user on a browser-side hang. */
  }
  return endpoint;
}
