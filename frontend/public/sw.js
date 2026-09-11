/**
 * Service worker for the subscription manager.
 *
 * Deliberately build-agnostic: it never precaches a generated asset list (the
 * hashed filenames change on every deploy), it just caches what the app
 * actually requests.
 *
 *   - navigations    → network first, falling back to the cached app shell
 *   - static assets  → stale-while-revalidate (hashed URLs make this safe)
 *   - /api/*         → never touched; the data must always be live
 *
 * It also renders Web Push reminders, which is why the app registers it even
 * when the mobile shell is switched off.
 */
const VERSION = 'v1';
const SHELL_CACHE = `subtrack-shell-${VERSION}`;
const ASSET_CACHE = `subtrack-assets-${VERSION}`;
const SHELL_URL = '/index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.add(new Request(SHELL_URL, { cache: 'reload' })))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
      for (const key of await caches.keys()) {
        if (key.startsWith('subtrack-') && !keep.has(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(SHELL_CACHE);
    cache.put(SHELL_URL, response.clone());
    return response;
  } catch {
    const cached = await caches.match(SHELL_URL, { cacheName: SHELL_CACHE });
    return cached ?? Response.error();
  }
}

async function handleAsset(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok && response.type === 'basic') cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached ?? (await network) ?? Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname.endsWith('.webmanifest')) {
    event.respondWith(handleAsset(request));
  }
});

/* --------------------------------------------------------------- web push */

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text?.() ?? '' };
  }

  const title = payload.title || '订阅提醒';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: payload.tag || 'subtrack-reminder',
      renotify: true,
      requireInteraction: false,
      data: { url: payload.url || '/reminders' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/dashboard', self.location.origin).href;

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        if (client.url === target && 'focus' in client) return client.focus();
      }
      for (const client of clients) {
        if ('focus' in client) {
          await client.focus();
          return client.navigate?.(target);
        }
      }
      return self.clients.openWindow(target);
    })(),
  );
});
