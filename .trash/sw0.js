// TeamPulse Service Worker v3
// جایگزین فایل قدیمی sw.js با همین محتوا کنید

const CACHE = 'teampulse-v3';
const CORE = ['./index.html', './manifest.json'];

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE).catch(() => {}))
  );
  self.skipWaiting();
});

// ── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  if (!e.request.url.startsWith(self.location.origin)) return;
  if (e.request.url.includes('/api/')) return; // API calls: never cache
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      if (res.ok && e.request.method === 'GET') {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});

// ── پیام از صفحه اصلی برای schedule کردن نوتیفیکیشن ─────────────────────────
self.addEventListener('message', e => {
  if (!e.data) return;

  if (e.data.type === 'SCHEDULE_REMINDER') {
    const { id, title, body, delay } = e.data;
    if (typeof delay === 'number' && delay > 0 && delay < 12 * 3600 * 1000) {
      setTimeout(() => {
        self.registration.showNotification('⏰ ' + title, {
          body: body || 'وقت انجام کار رسید — TeamPulse',
          icon: './favicon.png',
          badge: './favicon.png',
          tag: 'todo-' + id,
          requireInteraction: true,
          vibrate: [200, 100, 200],
        }).catch(() => {});
      }, delay);
    }
  }
});

// ── کلیک روی notification ────────────────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if ('focus' in client) { client.focus(); return; }
      }
      return self.clients.openWindow('./');
    })
  );
});
