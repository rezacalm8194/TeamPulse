const CACHE = 'team-pulse-static-v45';
const CORE_ASSETS = [
  '/app',
  '/manifest.json',
  '/favicon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/logo.png',
  '/sw.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE_ASSETS))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isSameOrigin(request) {
  return new URL(request.url).origin === self.location.origin;
}

function shouldSkip(request) {
  const url = new URL(request.url);
  return request.method !== 'GET' ||
    !isSameOrigin(request) ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/share/');
}

function cacheableResponse(response) {
  return response && response.ok && response.type === 'basic';
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (cacheableResponse(response)) cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || (await cache.match('/app'));
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const fresh = fetch(request)
    .then(response => {
      if (cacheableResponse(response)) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || fresh;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (shouldSkip(request)) return;
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});

const _t = new Map();
self.addEventListener('message', event => {
  if (!event.data) return;
  if (event.data.type === 'SHOW_NOTIFICATION') {
    self.registration.showNotification(event.data.title, {
      body: event.data.body || '',
      icon: '/logo.png',
      tag: event.data.tag || 'tp',
      requireInteraction: true,
      dir: 'rtl',
      vibrate: [200, 100, 200],
    });
  }
  if (event.data.type === 'SCHEDULE_NOTIFICATIONS') {
    _t.forEach(timer => clearTimeout(timer));
    _t.clear();
    (event.data.notifications || []).forEach(notification => {
      if (notification.delayMs > 0 && notification.delayMs < 86400000) {
        _t.set(notification.id, setTimeout(() => {
          self.registration.showNotification(notification.title, {
            body: notification.body || '',
            icon: '/logo.png',
            tag: notification.tag,
            requireInteraction: true,
            dir: 'rtl',
            vibrate: [300, 100, 300],
            actions: [
              { action: 'done', title: '✅ انجام شد' },
              { action: 'snooze', title: '⏰ ۱۰ دقیقه دیگه' },
            ],
          });
          _t.delete(notification.id);
        }, notification.delayMs));
      }
    });
  }
});

self.addEventListener('push', event => {
  if (!event.data) return;
  let data;
  try { data = event.data.json(); } catch { data = { title: '⏰ یادآور', body: event.data.text() }; }
  event.waitUntil(
    self.registration.showNotification(data.title || '⏰ یادآور TeamPulse', {
      body: data.body || '',
      icon: data.icon || '/logo.png',
      tag: data.tag || 'push-' + Date.now(),
      requireInteraction: true,
      dir: 'rtl',
      vibrate: [300, 100, 300],
      actions: [
        { action: 'open', title: '📋 مشاهده' },
        { action: 'dismiss', title: '✅ فهمیدم' },
      ],
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'snooze') {
    const notification = event.notification;
    setTimeout(() => self.registration.showNotification(notification.title, {
      body: notification.body,
      icon: '/logo.png',
      tag: notification.tag + '-s',
      requireInteraction: true,
      dir: 'rtl',
    }), 600000);
    return;
  }
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        for (const client of clientList) {
          if (client.url.includes('/app') && 'focus' in client) return client.focus();
        }
        return clients.openWindow('/app');
      })
  );
});
