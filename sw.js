const CACHE = 'team-pulse-static-v95';
const CORE_ASSETS = [
  '/app',
  '/app.css?v=tp95',
  '/app.js?v=tp95',
  '/tp-inline-bind.js?v=tp95',
  '/manifest.json',
  '/favicon.png',
  '/app-icon-192-v3.png',
  '/notification-badge.svg',
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

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (cacheableResponse(response)) cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
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
    // event.respondWith() must always resolve to an actual Response. When the
    // browser is offline and this asset has never been cached, `cached` is
    // undefined; returning it makes Chrome report:
    // "Failed to convert value to 'Response'".
    .catch(() => cached || new Response('', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    }));
  return cached || fresh;
}

function isVersionedAppBundle(url) {
  return url.pathname === '/app.js' || url.pathname === '/app-extra.js' || url.pathname === '/app.css' || url.pathname === '/tp-inline-bind.js';
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (shouldSkip(request)) return;
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    // Small HTML shell: paint cached markup immediately and refresh in the
    // background. JS/CSS are versioned and served cache-first separately.
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
  const url = new URL(request.url);
  if (isVersionedAppBundle(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});

const _t = new Map();
const NOTIFICATION_ICON = '/app-icon-192-v3.png';
const NOTIFICATION_BADGE = '/notification-badge.svg';
function notificationActionsFor(data) {
  return data?.kind === 'todo' && data?.todoId
    ? [
        { action: 'done', title: '✅ انجام شد' },
        { action: 'open', title: '📋 مشاهده' },
      ]
    : [
        { action: 'open', title: '📋 مشاهده' },
      ];
}

self.addEventListener('message', event => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (event.data.type === 'SHOW_NOTIFICATION') {
    const data = event.data.data || {};
    event.waitUntil(self.registration.showNotification(event.data.title, {
      body: event.data.body || '',
      icon: NOTIFICATION_ICON,
      badge: NOTIFICATION_BADGE,
      tag: event.data.tag || 'tp',
      data,
      requireInteraction: true,
      renotify: true,
      silent: false,
      dir: 'rtl',
      vibrate: [200, 100, 200],
      actions: notificationActionsFor(data),
    }));
  }
  if (event.data.type === 'SCHEDULE_NOTIFICATIONS') {
    _t.forEach(timer => clearTimeout(timer));
    _t.clear();
    (event.data.notifications || []).forEach(notification => {
      if (notification.delayMs > 0 && notification.delayMs < 86400000) {
        _t.set(notification.id, setTimeout(() => {
          self.registration.showNotification(notification.title, {
            body: notification.body || '',
            icon: NOTIFICATION_ICON,
            badge: NOTIFICATION_BADGE,
            tag: notification.tag,
            data: notification.data || { todoId: notification.id, kind: 'todo' },
            requireInteraction: true,
            renotify: true,
            silent: false,
            dir: 'rtl',
            vibrate: [300, 100, 300],
            actions: notificationActionsFor(notification.data || { todoId: notification.id, kind: 'todo' }),
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
  const notificationData = {
    todoId: data.todoId || null,
    kind: data.kind || '',
    url: data.url || '/app#todolist',
  };
  event.waitUntil(
    self.registration.showNotification(data.title || '⏰ یادآور TeamPulse', {
      body: data.body || '',
      icon: data.icon || NOTIFICATION_ICON,
      badge: data.badge || NOTIFICATION_BADGE,
      tag: data.tag || 'push-' + Date.now(),
      data: notificationData,
      requireInteraction: true,
      renotify: true,
      silent: false,
      dir: 'rtl',
      vibrate: [300, 100, 300],
      actions: notificationActionsFor(notificationData),
    })
  );
});

async function focusOrOpenApp(targetUrl = '/app', navigateExisting = true) {
  const absoluteUrl = new URL(targetUrl, self.location.origin).href;
  const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clientList) {
    if (client.url.includes('/app') && 'focus' in client) {
      if (navigateExisting && 'navigate' in client && client.url !== absoluteUrl) await client.navigate(absoluteUrl);
      await client.focus();
      return client;
    }
  }
  return clients.openWindow(absoluteUrl);
}

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  const tag = event.notification.tag || '';
  const todoId = data.todoId || (tag.startsWith('todo-') ? tag.slice(5) : null);
  const targetUrl = data.url || (data.kind === 'todo' ? '/app#todolist' : '/app');
  event.waitUntil(
    focusOrOpenApp(targetUrl, data.kind !== 'todo').then(client => {
      if (!client || !client.postMessage) return;
      if (data.kind === 'todo' && event.action === 'done' && todoId) {
        client.postMessage({ type: 'TODO_NOTIFICATION_DONE', todoId });
        return;
      }
      if (data.kind === 'todo') client.postMessage({ type: 'TODO_NOTIFICATION_VIEW', todoId });
    })
  );
});
